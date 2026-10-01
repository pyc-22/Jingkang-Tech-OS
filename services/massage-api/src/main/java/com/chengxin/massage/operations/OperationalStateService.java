package com.chengxin.massage.operations;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Single read model for front-desk and manager live room/technician state. */
@Service
public class OperationalStateService {
  private static final Set<String> BED_OCCUPYING = Set.of(
      "PENDING_ACCEPTANCE", "ACCEPTED", "REASSIGNMENT_REQUIRED", "DISPATCH_CANCELLED",
      "IN_SERVICE", "COMPLETED_UNSETTLED");
  private final JdbcClient jdbc;
  private final BusinessClockService businessClock;

  public OperationalStateService(JdbcClient jdbc, BusinessClockService businessClock) {
    this.jdbc = jdbc;
    this.businessClock = businessClock;
  }

  /** Completed services occupy a bed until the linked order is settled or explicitly voided. */
  public static String completedUnsettledPredicate(String sessionAlias) {
    return sessionAlias + ".status='COMPLETED' and coalesce((select case "
        + "when linked_order.status='CANCELLED' then false "
        + "when linked_order.status='SETTLED' and linked_order.refund_status='FULL' then true "
        + "when linked_order.status='SETTLED' then false "
        + "else true end "
        + "from sales_order_service_session link join sales_order linked_order on linked_order.id=link.order_id "
        + "where link.service_session_id=" + sessionAlias + ".id "
        + "order by link.created_at desc,link.id desc limit 1),true)";
  }

  /** True only when the latest linked order still represents an active settlement. */
  public static String activeSettlementPredicate(String sessionAlias) {
    return "coalesce((select case "
        + "when linked_order.status='CANCELLED' then false "
        + "when linked_order.status='SETTLED' and linked_order.refund_status='FULL' then false "
        + "else true end "
        + "from sales_order_service_session link join sales_order linked_order on linked_order.id=link.order_id "
        + "where link.service_session_id=" + sessionAlias + ".id "
        + "order by link.created_at desc,link.id desc limit 1),false)";
  }

  public static String occupyingServicePredicate(String sessionAlias) {
    return "(" + sessionAlias + ".status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE') or "
        + completedUnsettledPredicate(sessionAlias) + ")";
  }

  static boolean occupiesBed(String status) {
    return BED_OCCUPYING.contains(status);
  }

  public LiveState live(UUID storeId) {
    LocalDate businessDate = businessClock.currentBusinessDate(storeId);
    List<RoomRow> rows = jdbc.sql(roomSql()).param("store", storeId).query(RoomRow.class).list();
    List<ServiceRow> serviceRows = jdbc.sql(serviceSql()).param("store", storeId).query(ServiceRow.class).list();
    Map<UUID, List<ServiceState>> servicesByRoom = new LinkedHashMap<>();
    for (ServiceRow row : serviceRows) {
      servicesByRoom.computeIfAbsent(row.roomId(), ignored -> new ArrayList<>()).add(row.state());
    }
    List<RoomState> rooms = rows.stream().map(row -> {
      List<ServiceState> services = servicesByRoom.getOrDefault(row.roomId(), List.of());
      long occupied = services.stream().filter(item -> BED_OCCUPYING.contains(item.serviceStatus()))
          .map(item -> item.bedId() == null ? item.serviceSessionId() : item.bedId()).distinct().count();
      int bedCount = Math.max(1, row.bedCount() == null ? 1 : row.bedCount());
      return new RoomState(row.roomId(), row.roomCode(), row.roomName(), row.status(), row.reason(), row.occurredAt(),
          bedCount, Math.min(occupied, bedCount), Math.max(0, bedCount - occupied), services);
    }).toList();
    List<TechnicianState> technicians = jdbc.sql(technicianSql()).param("store", storeId).param("businessDate", businessDate)
        .query(TechnicianState.class).list();
    Attention attention = jdbc.sql(attentionSql()).param("store", storeId).query(Attention.class).single();
    return new LiveState(businessDate.toString(), attention.reassignmentRequiredCount(), attention.dispatchCancelledCount(), rooms, technicians);
  }

  static String roomSql() {
    return "select r.id room_id,r.code room_code,r.name room_name,coalesce((select nullif(count(*),0) from room_bed active_bed where active_bed.store_id=:store and active_bed.room_id=r.id and active_bed.active=true),r.bed_count) bed_count," +
        "case when exists(select 1 from service_session active where active.store_id=:store and active.room_id=r.id and active.status='IN_SERVICE') then 'IN_SERVICE' " +
        "when exists(select 1 from service_session active where active.store_id=:store and active.room_id=r.id and active.status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED')) then 'RESERVED' " +
        "when exists(select 1 from service_session completed where completed.store_id=:store and completed.room_id=r.id and " + completedUnsettledPredicate("completed") + ") then 'PENDING_PAYMENT' " +
        "else coalesce(event.status,'IDLE') end status,event.reason,event.occurred_at " +
        "from room r left join lateral(select event.status,event.reason,event.occurred_at from room_status_event event where event.store_id=:store and event.room_id=r.id order by event.occurred_at desc,event.id desc limit 1) event on true " +
        "where r.store_id=:store and r.active=true order by r.code";
  }

  static String serviceSql() {
    return "select ss.id service_session_id,ss.room_id,ss.bed_id,bed.code bed_code,bed.name bed_name,ss.service_name_snapshot,case when ss.converted then 'CONVERSION' else ss.clock_type end clock_type,ss.planned_duration_minutes," +
        "coalesce((select string_agg(extension.service_name_snapshot || ' ' || extension.planned_duration_minutes || '分钟','、' order by extension.added_at) from service_session_extension extension where extension.service_session_id=ss.id),'') extension_summary," +
        "case when ss.status='COMPLETED' then 'COMPLETED_UNSETTLED' else ss.status end service_status,ss.started_at,ss.expected_end_at," +
        "coalesce((select string_agg(participant.technician_id::text,',' order by participant.slot_no,participant.sequence_no) from service_session_participant participant where participant.service_session_id=ss.id and participant.store_id=:store and participant.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')),'') active_participant_technician_ids," +
        "case when ss.status='REASSIGNMENT_REQUIRED' then '待重新派单' when ss.status='DISPATCH_CANCELLED' then '待与顾客沟通' else coalesce((select string_agg(concat_ws(' · ',tech.code,tech.name),'、' order by participant.slot_no,participant.sequence_no) from service_session_participant participant join technician tech on tech.id=participant.technician_id where participant.service_session_id=ss.id and participant.store_id=:store and participant.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')),concat_ws(' · ',primary_tech.code,primary_tech.name)) end technician_display," +
        "case when ss.status in ('REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED') then 0 else coalesce((select count(distinct participant.technician_id) from service_session_participant participant where participant.service_session_id=ss.id and participant.store_id=:store and participant.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')),1) end technician_count " +
        "from service_session ss join technician primary_tech on primary_tech.id=ss.technician_id left join room_bed bed on bed.id=ss.bed_id " +
        "where ss.store_id=:store and " + occupyingServicePredicate("ss") + " " +
        "order by ss.room_id,bed.sort_order nulls last,ss.created_at";
  }

  static String technicianSql() {
    return "select technician.id technician_id,technician.code technician_code,technician.name technician_name," +
        "coalesce(queue_position.queue_position,nullif(technician.queue_order,0)) queue_position," +
        "coalesce(current_service.participant_status,'IDLE') status,current_service.service_session_id,current_service.room_id," +
        "room.code room_code,room.name room_name,current_service.service_name_snapshot,current_service.clock_type," +
        "coalesce(current_service.service_started_at,current_service.started_at) started_at,current_service.expected_end_at,current_service.acceptance_deadline_at " +
        "from technician " +
        "left join technician_queue_day queue_day on queue_day.store_id=technician.store_id and queue_day.business_date=:businessDate " +
        "left join technician_queue_position queue_position on queue_position.queue_day_id=queue_day.id and queue_position.technician_id=technician.id " +
        "left join lateral (select participant.status participant_status,participant.service_session_id,participant.service_started_at,participant.acceptance_deadline_at,session.room_id,session.service_name_snapshot,case when session.converted then 'CONVERSION' else session.clock_type end clock_type,session.started_at,session.expected_end_at from service_session_participant participant join service_session session on session.id=participant.service_session_id where participant.store_id=:store and participant.technician_id=technician.id and participant.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE') and session.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE') order by case participant.status when 'IN_SERVICE' then 0 when 'PENDING_ACCEPTANCE' then 1 else 2 end,participant.created_at desc limit 1) current_service on true " +
        "left join room on room.id=current_service.room_id " +
        "where technician.store_id=:store and technician.active=true " +
        "order by case coalesce(current_service.participant_status,'IDLE') when 'IN_SERVICE' then 0 when 'PENDING_ACCEPTANCE' then 1 when 'ACCEPTED' then 2 else 3 end,coalesce(queue_position.queue_position,nullif(technician.queue_order,0),2147483647),technician.code";
  }

  static String attentionSql() {
    return "select count(*) filter(where status='REASSIGNMENT_REQUIRED') reassignment_required_count,count(*) filter(where status='DISPATCH_CANCELLED') dispatch_cancelled_count from service_session where store_id=:store and status in ('REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED')";
  }

  public record LiveState(String businessDate, Long reassignmentRequiredCount, Long dispatchCancelledCount,
                          List<RoomState> rooms, List<TechnicianState> technicians) {}
  public record RoomState(UUID roomId, String roomCode, String roomName, String status, String reason,
                          OffsetDateTime occurredAt, Integer bedCount, Long occupiedBedCount,
                          Long availableBedCount, List<ServiceState> services) {}
  public record ServiceState(UUID serviceSessionId, UUID roomId, UUID bedId, String bedCode, String bedName,
                             String serviceNameSnapshot, String clockType, Short plannedDurationMinutes,
                             String extensionSummary, String serviceStatus,
                             OffsetDateTime startedAt, OffsetDateTime expectedEndAt, String activeParticipantTechnicianIds,
                             String technicianDisplay,
                             Long technicianCount) {}
  public record TechnicianState(UUID technicianId, String technicianCode, String technicianName, Integer queuePosition,
                                String status, UUID serviceSessionId, UUID roomId, String roomCode, String roomName,
                                String serviceNameSnapshot, String clockType, OffsetDateTime startedAt,
                                OffsetDateTime expectedEndAt, OffsetDateTime acceptanceDeadlineAt) {}
  record RoomRow(UUID roomId, String roomCode, String roomName, Integer bedCount, String status, String reason, OffsetDateTime occurredAt) {}
  record ServiceRow(UUID serviceSessionId, UUID roomId, UUID bedId, String bedCode, String bedName,
                    String serviceNameSnapshot, String clockType, Short plannedDurationMinutes,
                    String extensionSummary, String serviceStatus, OffsetDateTime startedAt,
                    OffsetDateTime expectedEndAt, String activeParticipantTechnicianIds,
                    String technicianDisplay, Long technicianCount) {
    ServiceState state() { return new ServiceState(serviceSessionId, roomId, bedId, bedCode, bedName, serviceNameSnapshot, clockType, plannedDurationMinutes, extensionSummary, serviceStatus, startedAt, expectedEndAt, activeParticipantTechnicianIds, technicianDisplay, technicianCount); }
  }
  record Attention(Long reassignmentRequiredCount, Long dispatchCancelledCount) {}
}
