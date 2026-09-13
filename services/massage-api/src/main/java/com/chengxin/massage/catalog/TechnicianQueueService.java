package com.chengxin.massage.catalog;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.chengxin.massage.operations.BusinessClockService;

/** Maintains the actual queue for one store business day while preserving the default technician order. */
@Service
public class TechnicianQueueService {
  /** Positions at or above this threshold were written by the retired offset algorithm. */
  private static final int LEGACY_POSITION_THRESHOLD = 10_000;
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final BusinessClockService businessClock;

  TechnicianQueueService(JdbcClient jdbc, BusinessClockService businessClock) {
    this.jdbc = jdbc;
    this.businessClock = businessClock;
  }

  @Transactional
  public QueueSnapshot currentQueue(UUID storeId) {
    LocalDate businessDate = businessClock.currentBusinessDate(storeId);
    QueueDay day = ensureDay(storeId, businessDate);
    lockDay(day);
    normalizeLegacyPositions(day);
    ensureEligibleTechnicians(day);
    return new QueueSnapshot(businessDate, positions(day));
  }

  @Transactional(readOnly = true)
  public List<QueueEvent> events(UUID storeId, int limit) {
    LocalDate businessDate = businessClock.currentBusinessDate(storeId);
    return jdbc.sql("select event.id,event.business_date,event.technician_id,technician.code technician_code,technician.name technician_name,event.service_session_id,event.event_type,event.from_position,event.to_position,event.reason,event.actor_name_snapshot,event.occurred_at from technician_queue_event event left join technician on technician.id=event.technician_id where event.store_id=:store and event.business_date=:date order by event.occurred_at desc,event.id desc limit :limit")
      .param("store", storeId).param("date", businessDate).param("limit", Math.max(1, Math.min(limit, 200))).query(QueueEvent.class).list();
  }

  @Transactional
  public void reorder(UUID storeId, List<QueueOrder> requested, UUID actorUserId, String actorName) {
    QueueDay day = ensureDay(storeId, businessClock.currentBusinessDate(storeId));
    lockDay(day);
    normalizeLegacyPositions(day);
    ensureEligibleTechnicians(day);
    List<QueuePosition> current = positions(day);
    if (requested == null || requested.size() != current.size()) throw new IllegalArgumentException("Queue order must include all available technicians");
    Set<UUID> expected = new HashSet<>(current.stream().map(QueuePosition::technicianId).toList());
    Set<UUID> received = new HashSet<>();
    for (QueueOrder item : requested) {
      if (item.technicianId() == null || !expected.contains(item.technicianId()) || !received.add(item.technicianId())) {
        throw new IllegalArgumentException("Queue order contains an invalid technician");
      }
    }
    Map<UUID, Integer> before = new HashMap<>();
    current.forEach(item -> before.put(item.technicianId(), item.queuePosition()));
    rewritePositions(day, requested.stream().map(QueueOrder::technicianId).toList());
    for (int index = 0; index < requested.size(); index++) {
      QueueOrder item = requested.get(index);
      int position = index + 1;
      jdbc.sql("update technician set queue_order=:position,updated_at=now(),version=version+1 where id=:technician and store_id=:store")
        .param("position", position).param("technician", item.technicianId()).param("store", storeId).update();
      if (before.get(item.technicianId()) != position) record(day, item.technicianId(), null, "MANUAL_REORDER", before.get(item.technicianId()), position,
        "Manager adjusted today's queue", actorUserId, actorName);
    }
  }

  @Transactional
  public void rotateAfterServiceStart(UUID storeId, LocalDate businessDate, UUID serviceSessionId, String clockType,
                                      List<UUID> technicianIds, UUID actorUserId, String actorName) {
    if (!"QUEUE".equals(clockType) && !"BOOKED_QUEUE".equals(clockType)) return;
    if (technicianIds == null || technicianIds.isEmpty()) return;
    QueueDay day = ensureDay(storeId, businessDate);
    lockDay(day);
    boolean alreadyRotated = jdbc.sql("select exists(select 1 from technician_queue_event where service_session_id=:session and event_type='SERVICE_ROTATED')")
      .param("session", serviceSessionId).query(Boolean.class).single();
    if (alreadyRotated) return;
    normalizeLegacyPositions(day);
    ensureEligibleTechnicians(day);
    List<QueuePosition> current = positions(day);
    Set<UUID> selected = new HashSet<>(technicianIds);
    List<QueuePosition> moved = current.stream().filter(item -> selected.contains(item.technicianId())).toList();
    if (moved.isEmpty()) return;
    List<QueuePosition> next = new ArrayList<>(current.stream().filter(item -> !selected.contains(item.technicianId())).toList());
    next.addAll(moved);
    rewritePositions(day, next.stream().map(QueuePosition::technicianId).toList());
    for (int index = 0; index < next.size(); index++) {
      QueuePosition item = next.get(index);
      int position = index + 1;
      if (selected.contains(item.technicianId())) record(day, item.technicianId(), serviceSessionId, "SERVICE_ROTATED", item.queuePosition(), position,
        "Queue service started", actorUserId, actorName);
    }
  }

  static <T> List<T> rotatedOrder(List<T> current, Set<T> moved) {
    List<T> next = new ArrayList<>(current.stream().filter(item -> !moved.contains(item)).toList());
    next.addAll(current.stream().filter(moved::contains).toList());
    return next;
  }

  private QueueDay ensureDay(UUID storeId, LocalDate businessDate) {
    UUID candidate = UUID.randomUUID();
    UUID created = jdbc.sql("insert into technician_queue_day(id,tenant_id,store_id,business_date) values(:id,:tenant,:store,:date) on conflict(store_id,business_date) do nothing returning id")
      .param("id", candidate).param("tenant", TENANT_ID).param("store", storeId).param("date", businessDate).query(UUID.class).optional().orElse(null);
    QueueDay day = created == null
      ? jdbc.sql("select id,store_id,business_date from technician_queue_day where store_id=:store and business_date=:date")
        .param("store", storeId).param("date", businessDate).query(QueueDay.class).single()
      : new QueueDay(created, storeId, businessDate);
    if (created != null) initializeDay(day);
    return day;
  }

  private void lockDay(QueueDay day) {
    jdbc.sql("select id from technician_queue_day where id=:day for update")
      .param("day", day.id()).query(UUID.class).single();
  }

  private void normalizeLegacyPositions(QueueDay day) {
    List<StoredQueuePosition> stored = storedPositions(day);
    if (stored.stream().noneMatch(item -> item.queuePosition() >= LEGACY_POSITION_THRESHOLD)) return;
    rewritePositions(day, stored.stream().filter(StoredQueuePosition::eligible).map(StoredQueuePosition::technicianId).toList());
  }

  /**
   * Rebuilds the locked business-day queue from its final order. Deleting before inserting
   * avoids transient collisions on the immediate unique position constraint.
   */
  private void rewritePositions(QueueDay day, List<UUID> eligibleOrder) {
    List<StoredQueuePosition> stored = storedPositions(day);
    if (stored.isEmpty()) return;
    Map<UUID, StoredQueuePosition> byTechnician = new HashMap<>();
    stored.forEach(item -> byTechnician.put(item.technicianId(), item));
    Set<UUID> included = new HashSet<>();
    List<StoredQueuePosition> finalOrder = new ArrayList<>();
    for (UUID technicianId : eligibleOrder) {
      StoredQueuePosition item = byTechnician.get(technicianId);
      if (item == null || !item.eligible() || !included.add(technicianId)) {
        throw new IllegalArgumentException("Queue order contains an invalid technician");
      }
      finalOrder.add(item);
    }
    stored.stream().filter(StoredQueuePosition::eligible)
      .filter(item -> !included.contains(item.technicianId())).forEach(finalOrder::add);

    // The unique(queue_day_id, queue_position) constraint is immediate in PostgreSQL.
    // Rebuilding the locked day's rows avoids transient duplicate positions entirely.
    jdbc.sql("delete from technician_queue_position where queue_day_id=:day")
      .param("day", day.id()).update();
    for (int index = 0; index < finalOrder.size(); index++) {
      StoredQueuePosition item = finalOrder.get(index);
      jdbc.sql("insert into technician_queue_position(id,tenant_id,store_id,queue_day_id,technician_id,queue_position,default_queue_order) "
          + "select :id,:tenant,:store,:day,t.id,:position,coalesce(nullif(t.queue_order,0),:position) from technician t where t.id=:technician and t.store_id=:store")
        .param("id", UUID.randomUUID())
        .param("tenant", TENANT_ID)
        .param("store", day.storeId())
        .param("day", day.id())
        .param("technician", item.technicianId())
        .param("position", index + 1)
        .param("defaultOrder", index + 1)
        .update();
    }
  }

  private void initializeDay(QueueDay day) {
    List<TechnicianSeed> technicians = eligibleTechnicians(day.storeId(), day.businessDate());
    for (int index = 0; index < technicians.size(); index++) {
      TechnicianSeed technician = technicians.get(index);
      insertPosition(day, technician, index + 1);
      record(day, technician.id(), null, "DAY_INITIALIZED", null, index + 1, "Business day queue initialized", null, "System");
    }
  }

  private void ensureEligibleTechnicians(QueueDay day) {
    int nextPosition = jdbc.sql("select coalesce(max(queue_position),0)+1 from technician_queue_position where queue_day_id=:day")
      .param("day", day.id()).query(Integer.class).single();
    for (TechnicianSeed technician : eligibleTechnicians(day.storeId(), day.businessDate())) {
      boolean present = jdbc.sql("select exists(select 1 from technician_queue_position where queue_day_id=:day and technician_id=:technician)")
        .param("day", day.id()).param("technician", technician.id()).query(Boolean.class).single();
      if (!present) {
        insertPosition(day, technician, nextPosition);
        record(day, technician.id(), null, "TECHNICIAN_JOINED", null, nextPosition, "Technician became available during business day", null, "System");
        nextPosition++;
      }
    }
  }

  private List<TechnicianSeed> eligibleTechnicians(UUID storeId, LocalDate businessDate) {
    LocalDate previousDate = businessDate.minusDays(1);
    return jdbc.sql("""
      select technician.id,technician.code,technician.name,technician.queue_order,
             coalesce(previous.call_count,0)::integer call_count,
             coalesce(previous.queue_count,0)::integer queue_count
      from technician
      left join (
        select technician_id,
               count(*) filter (where clock_type in ('CALL','BOOKED_CALL')) call_count,
               count(*) filter (where clock_type in ('QUEUE','BOOKED_QUEUE')) queue_count
        from service_session
        where store_id=:store and business_date=:previousDate
          and status not in ('CANCELLED','REJECTED','EXPIRED')
        group by technician_id
      ) previous on previous.technician_id=technician.id
      left join technician_clock_in attendance
        on attendance.technician_id=technician.id
       and attendance.store_id=technician.store_id
       and attendance.business_date=:date
      where technician.store_id=:store and technician.active=true and technician.queue_enabled=true
        and attendance.clock_in_time is not null and attendance.clock_out_time is null
      order by coalesce(previous.call_count,0),coalesce(previous.queue_count,0),technician.queue_order,technician.code
      """)
      .param("store", storeId).param("previousDate", previousDate).param("date", businessDate)
      .query(TechnicianSeed.class).list();
  }

  private List<QueuePosition> positions(QueueDay day) {
    return jdbc.sql("select position.technician_id,technician.code technician_code,technician.name technician_name,position.queue_position,position.default_queue_order from technician_queue_position position join technician on technician.id=position.technician_id left join technician_clock_in attendance on attendance.technician_id=technician.id and attendance.store_id=technician.store_id and attendance.business_date=:date where position.queue_day_id=:day and technician.store_id=:store and technician.active=true and technician.queue_enabled=true and attendance.clock_in_time is not null and attendance.clock_out_time is null order by position.queue_position,technician.code")
      .param("day", day.id()).param("store", day.storeId()).param("date", day.businessDate()).query(QueuePosition.class).list();
  }

  private List<StoredQueuePosition> storedPositions(QueueDay day) {
    return jdbc.sql("select position.technician_id,position.queue_position,technician.active technician_active,technician.queue_enabled queue_enabled,(attendance.clock_in_time is not null and attendance.clock_out_time is null) attendance_eligible from technician_queue_position position join technician on technician.id=position.technician_id left join technician_clock_in attendance on attendance.technician_id=technician.id and attendance.store_id=technician.store_id and attendance.business_date=:date where position.queue_day_id=:day and technician.store_id=:store order by position.queue_position,technician.code")
      .param("day", day.id()).param("store", day.storeId()).param("date", day.businessDate()).query(StoredQueuePosition.class).list();
  }

  private void insertPosition(QueueDay day, TechnicianSeed technician, int position) {
    jdbc.sql("insert into technician_queue_position(id,tenant_id,store_id,queue_day_id,technician_id,queue_position,default_queue_order) values(:id,:tenant,:store,:day,:technician,:position,:defaultOrder)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", day.storeId()).param("day", day.id())
      .param("technician", technician.id()).param("position", position).param("defaultOrder", technician.queueOrder()).update();
  }

  private void record(QueueDay day, UUID technicianId, UUID sessionId, String type, Integer from, Integer to,
                      String reason, UUID actorUserId, String actorName) {
    jdbc.sql("insert into technician_queue_event(id,tenant_id,store_id,queue_day_id,business_date,technician_id,service_session_id,event_type,from_position,to_position,reason,actor_user_id,actor_name_snapshot) values(:id,:tenant,:store,:day,:date,:technician,:session,:type,:from,:to,:reason,:actor,:name)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", day.storeId()).param("day", day.id()).param("date", day.businessDate())
      .param("technician", technicianId).param("session", sessionId).param("type", type).param("from", from).param("to", to)
      .param("reason", reason).param("actor", actorUserId).param("name", actorName).update();
  }

  record QueueDay(UUID id, UUID storeId, LocalDate businessDate) {}
  record TechnicianSeed(UUID id, String code, String name, Integer queueOrder, Integer callCount, Integer queueCount) {}
  public record QueueOrder(UUID technicianId) {}
  public record QueuePosition(UUID technicianId, String technicianCode, String technicianName, Integer queuePosition, Integer defaultQueueOrder) {}
  private record StoredQueuePosition(UUID technicianId, Integer queuePosition, boolean technicianActive, boolean queueEnabled,
                                     boolean attendanceEligible) {
    boolean eligible() {
      return technicianActive && queueEnabled && attendanceEligible;
    }
  }
  public record QueueSnapshot(LocalDate businessDate, List<QueuePosition> technicians) {}
  public record QueueEvent(UUID id, LocalDate businessDate, UUID technicianId, String technicianCode, String technicianName,
                           UUID serviceSessionId, String eventType, Integer fromPosition, Integer toPosition, String reason,
                           String actorNameSnapshot, java.time.OffsetDateTime occurredAt) {}
}
