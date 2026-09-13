package com.chengxin.massage.catalog;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.BusinessClockService;
import com.chengxin.massage.catalog.ServiceItemVersionService.ResolvedServiceItem;

@RestController
@RequestMapping("/api/v1/service-sessions")
@CrossOrigin(origins = "*")
public class ServiceSessionController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final Logger LOGGER = LoggerFactory.getLogger(ServiceSessionController.class);
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final TechnicianSchedulePolicy schedulePolicy;
  private final AuditService audits;
  private final BusinessClockService businessClock;
  private final ServiceItemVersionService itemVersions;
  private final ServiceDispatchEventService dispatchEvents;
  private final TechnicianQueueService technicianQueue;

  @Value("${massage.dispatch.acceptance-timeout-seconds:300}")
  private int acceptanceTimeoutSeconds;

  ServiceSessionController(JdbcClient jdbc, StoreContextService storeContext, AdminSessionService adminSessions, TechnicianSchedulePolicy schedulePolicy, AuditService audits, BusinessClockService businessClock, ServiceItemVersionService itemVersions, ServiceDispatchEventService dispatchEvents, TechnicianQueueService technicianQueue) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.schedulePolicy = schedulePolicy;
    this.audits = audits;
    this.businessClock = businessClock;
    this.itemVersions = itemVersions;
    this.dispatchEvents = dispatchEvents;
    this.technicianQueue = technicianQueue;
  }

  @GetMapping
  List<ServiceSession> sessions(@RequestParam(required = false) String status,
                                @RequestParam(required = false) OffsetDateTime from,
                                @RequestParam(required = false) OffsetDateTime to,
                                @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    StringBuilder where = new StringBuilder("where ss.store_id=:store");
    if (status != null && !status.isBlank()) where.append(" and ss.status=:status");
    if (from != null) where.append(" and ss.started_at>=:fromTime");
    if (to != null) where.append(" and ss.started_at<=:toTime");
    String sql = sessionListSql(where.toString());
    JdbcClient.StatementSpec statement = jdbc.sql(sql).param("store", storeId);
    if (status != null && !status.isBlank()) statement = statement.param("status", status);
    if (from != null) statement = statement.param("fromTime", from);
    if (to != null) statement = statement.param("toTime", to);
    return statement.query(ServiceSession.class).list();
  }

  @PostMapping("/clock-in")
  @Transactional
  ServiceSession clockIn(@Valid @RequestBody ClockInInput input,
                         @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                         @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    try {
    List<ParticipantInput> participants = normalizeParticipants(input);
    for (UUID technicianId : participants.stream().map(ParticipantInput::technicianId).sorted().toList()) {
      lockActiveTechnician(storeId, technicianId);
    }
    for (ParticipantInput participant : participants) {
      schedulePolicy.requireClockInEligibility(storeId, participant.technicianId());
      if (hasActiveTechnician(storeId, participant.technicianId())) throw conflict("Technician already has a pending or active service");
    }
    ensureActive(storeId, "room", input.roomId(), "Room is unavailable");
    ResolvedServiceItem service = itemVersions.activeItem(storeId, input.serviceItemId(), businessClock.currentBusinessDate(storeId))
      .orElseThrow(() -> badRequest("Service item is unavailable"));
    UUID bedId = resolveBed(storeId, input.roomId(), input.bedId());

    String clockType = normalizeClockType(input.clockType());
    UUID id = UUID.randomUUID();
    OffsetDateTime acceptanceDeadline = OffsetDateTime.now().plusSeconds(acceptanceTimeoutSeconds);
    UUID primaryTechnicianId = participants.getFirst().technicianId();
    jdbc.sql("insert into service_session(id,tenant_id,store_id,technician_id,room_id,bed_id,service_item_id,service_name_snapshot,service_price_cents,planned_duration_minutes,started_at,expected_end_at,status,note,clock_type,price_version_id,counts_as_clock_snapshot,acceptance_deadline_at) values(:id,:tenant,:store,:technician,:room,:bed,:service,:name,:price,:duration,null,null,'PENDING_ACCEPTANCE',:note,:clockType,:priceVersion,:countsAsClock,:deadline)")
      .param("id", id).param("tenant", TENANT_ID).param("store", storeId).param("technician", primaryTechnicianId)
      .param("room", input.roomId()).param("bed", bedId).param("service", service.id()).param("name", service.name()).param("price", service.priceCents())
      .param("duration", input.plannedDurationMinutes()).param("note", input.note()).param("clockType", clockType).param("priceVersion", service.priceVersionId()).param("countsAsClock", service.countsAsClock()).param("deadline", acceptanceDeadline).update();
    for (int index = 0; index < participants.size(); index++) {
      ParticipantInput participant = participants.get(index);
      UUID participantId = UUID.randomUUID();
      jdbc.sql("insert into service_session_participant(id,tenant_id,store_id,service_session_id,technician_id,slot_no,sequence_no,participation_type,allocation_bp,status,acceptance_deadline_at) values(:id,:tenant,:store,:session,:technician,:slot,1,:type,:allocation,'PENDING_ACCEPTANCE',:deadline)")
        .param("id", participantId).param("tenant", TENANT_ID).param("store", storeId).param("session", id).param("technician", participant.technicianId())
        .param("slot", index + 1).param("type", index == 0 ? "PRIMARY" : "ADDITIONAL").param("allocation", participant.allocationBp()).param("deadline", acceptanceDeadline).update();
      dispatchEvents.record(storeId, id, participantId, "ASSIGNED", null, participant.technicianId(), acceptanceDeadline,
        null, actor.userId(), actor.displayName());
    }
    recordRoomStatus(storeId, input.roomId(), "RESERVED", "Awaiting " + participants.size() + " technician acceptance(s): " + service.name());
    ServiceSession created = session(storeId, id);
    audits.record(authorization, storeId, "SERVICE", "SERVICE_ASSIGNED", "service_session", id, "Front desk assigned service; awaiting technician acceptance", null, created);
    return created;
    } catch (ResponseStatusException exception) {
      if (exception.getStatusCode().value() == 400 || exception.getStatusCode().value() == 409) {
        LOGGER.warn("Clock-in rejected: storeId={}, roomId={}, requestedBedId={}, technicianId={}, participants={}, serviceItemId={}, durationMinutes={}, clockType={}, httpStatus={}, cause={}",
          storeId, input.roomId(), input.bedId(), input.technicianId(), input.participants(), input.serviceItemId(),
          input.plannedDurationMinutes(), input.clockType(), exception.getStatusCode().value(), exception.getReason());
      }
      throw exception;
    } catch (DataIntegrityViolationException exception) {
      String detail = exception.getMostSpecificCause().getMessage();
      LOGGER.warn("Clock-in database conflict: storeId={}, roomId={}, requestedBedId={}, technicianId={}, participants={}, constraintDetail={}",
        storeId, input.roomId(), input.bedId(), input.technicianId(), input.participants(), detail);
      if (detail != null && detail.contains("uk_participant_technician_active")) {
        throw conflict("Technician already has a pending or active service");
      }
      if (detail != null && detail.contains("service_session_active_bed_idx")) {
        throw conflict("该房间没有可用床位");
      }
      throw exception;
    }
  }

  /**
   * Creates one service session per technician for a multi-technician room.
   * The legacy clock-in route intentionally keeps its single-session contract;
   * this route gives each technician an independent item, clock type and
   * duration while reusing the same eligibility, bed and dispatch safeguards.
   */
  @PostMapping("/clock-in-batch")
  @Transactional
  List<ServiceSession> clockInBatch(@Valid @RequestBody ClockInBatchInput input,
                                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    try {
      List<BatchParticipantInput> participants = normalizeBatchParticipants(input);
      for (UUID technicianId : participants.stream().map(BatchParticipantInput::technicianId).sorted().toList()) {
        lockActiveTechnician(storeId, technicianId);
      }
      for (BatchParticipantInput participant : participants) {
        schedulePolicy.requireClockInEligibility(storeId, participant.technicianId());
        if (hasActiveTechnician(storeId, participant.technicianId())) {
          throw conflict("Technician already has a pending or active service");
        }
      }
      ensureActive(storeId, "room", input.roomId(), "Room is unavailable");
      // Serialize multi-technician assignments for one room before selecting beds.
      // Without the room lock, concurrent requests can both observe the same free bed.
      lockRoom(storeId, input.roomId());
      List<UUID> bedIds = resolveBeds(storeId, input.roomId(), participants.size());
      LocalDate businessDate = businessClock.currentBusinessDate(storeId);
      List<ResolvedBatchParticipant> resolved = new ArrayList<>();
      for (BatchParticipantInput participant : participants) {
        ResolvedServiceItem service = itemVersions.activeItem(storeId, participant.serviceItemId(), businessDate)
          .orElseThrow(() -> badRequest("Service item is unavailable"));
        String clockType = normalizeClockType(participant.clockType());
        int allocationBp = participant.allocationBp() == null ? 10000 : participant.allocationBp();
        if (allocationBp != 10000) throw badRequest("Each technician allocation must total 100 percent");
        resolved.add(new ResolvedBatchParticipant(participant, service, clockType, allocationBp));
      }

      OffsetDateTime acceptanceDeadline = OffsetDateTime.now().plusSeconds(acceptanceTimeoutSeconds);
      List<ServiceSession> created = new ArrayList<>();
      for (int index = 0; index < resolved.size(); index++) {
        ResolvedBatchParticipant item = resolved.get(index);
        UUID sessionId = UUID.randomUUID();
        jdbc.sql("insert into service_session(id,tenant_id,store_id,technician_id,room_id,bed_id,service_item_id,service_name_snapshot,service_price_cents,planned_duration_minutes,started_at,expected_end_at,status,note,clock_type,price_version_id,counts_as_clock_snapshot,acceptance_deadline_at) values(:id,:tenant,:store,:technician,:room,:bed,:service,:name,:price,:duration,null,null,'PENDING_ACCEPTANCE',:note,:clockType,:priceVersion,:countsAsClock,:deadline)")
          .param("id", sessionId).param("tenant", TENANT_ID).param("store", storeId)
          .param("technician", item.input().technicianId()).param("room", input.roomId()).param("bed", bedIds.get(index))
          .param("service", item.service().id()).param("name", item.service().name()).param("price", item.service().priceCents())
          .param("duration", item.input().plannedDurationMinutes()).param("note", item.input().note())
          .param("clockType", item.clockType()).param("priceVersion", item.service().priceVersionId())
          .param("countsAsClock", item.service().countsAsClock()).param("deadline", acceptanceDeadline).update();
        UUID participantId = UUID.randomUUID();
        jdbc.sql("insert into service_session_participant(id,tenant_id,store_id,service_session_id,technician_id,slot_no,sequence_no,participation_type,allocation_bp,status,acceptance_deadline_at) values(:id,:tenant,:store,:session,:technician,1,1,'PRIMARY',:allocation,'PENDING_ACCEPTANCE',:deadline)")
          .param("id", participantId).param("tenant", TENANT_ID).param("store", storeId).param("session", sessionId)
          .param("technician", item.input().technicianId()).param("allocation", item.allocationBp()).param("deadline", acceptanceDeadline).update();
        dispatchEvents.record(storeId, sessionId, participantId, "ASSIGNED", null, item.input().technicianId(), acceptanceDeadline,
          "批量派单：每位技师独立项目与钟类", actor.userId(), actor.displayName());
        ServiceSession session = session(storeId, sessionId);
        audits.record(authorization, storeId, "SERVICE", "SERVICE_ASSIGNED", "service_session", sessionId,
          "批量派单；技师项目、钟类和时长独立配置，等待技师接单", null, session);
        created.add(session);
      }
      recordRoomStatus(storeId, input.roomId(), "RESERVED", "Awaiting " + created.size() + " technician acceptance(s)");
      return created;
    } catch (ResponseStatusException exception) {
      if (exception.getStatusCode().value() == 400 || exception.getStatusCode().value() == 409) {
        LOGGER.warn("Batch clock-in rejected: storeId={}, roomId={}, participants={}, httpStatus={}, cause={}",
          storeId, input.roomId(), input.participants(), exception.getStatusCode().value(), exception.getReason());
      }
      throw exception;
    } catch (DataIntegrityViolationException exception) {
      String detail = exception.getMostSpecificCause().getMessage();
      LOGGER.warn("Batch clock-in database conflict: storeId={}, roomId={}, participants={}, constraintDetail={}",
        storeId, input.roomId(), input.participants(), detail);
      if (detail != null && detail.contains("uk_participant_technician_active")) {
        throw conflict("Technician already has a pending or active service");
      }
      if (detail != null && detail.contains("service_session_active_bed_idx")) {
        throw conflict("该房间没有足够的可用床位");
      }
      throw exception;
    }
  }

  @PostMapping("/{id}/clock-out")
  @Transactional
  ServiceSession clockOut(@PathVariable UUID id,
                          @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                          @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    jdbc.sql("select id from service_session where id=:id and store_id=:store for update")
      .param("id", id).param("store", storeId).query(UUID.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service session not found"));
    ServiceSession current = session(storeId, id);
    if (!"IN_SERVICE".equals(current.status())) throw conflict("Service is already finished");
    OffsetDateTime endedAt = OffsetDateTime.now();
    jdbc.sql("update service_session set status='COMPLETED',ended_at=:ended,updated_at=now(),version=version+1 where id=:id and store_id=:store and status='IN_SERVICE'")
      .param("id", id).param("store", storeId).param("ended", endedAt).update();
    jdbc.sql("update service_session_participant set status='COMPLETED',service_ended_at=:ended where service_session_id=:session and store_id=:store and status='IN_SERVICE'")
      .param("ended", endedAt).param("session", id).param("store", storeId).update();
    promoteNextReservation(storeId, current.technicianId(), authorization, actor.displayName(), actor.userId());
    recordRoomStatus(storeId, current.roomId(), "PENDING_PAYMENT", "Service clock-out; awaiting payment");
    ServiceSession completed = session(storeId, id);
    audits.record(authorization, storeId, "SERVICE", "SERVICE_CLOCKED_OUT", "service_session", id, "前台确认技师下钟", current, completed);
    return completed;
  }

  private void promoteNextReservation(UUID storeId, UUID technicianId, String authorization, String actorName, UUID actorId) {
    boolean pendingDispatch = jdbc.sql("select exists(select 1 from service_session_participant where store_id=:store and technician_id=:technician and status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE'))")
      .param("store", storeId).param("technician", technicianId).query(Boolean.class).single();
    if (pendingDispatch) return;
    QueuedReservation reservation = jdbc.sql("select sr.id,sr.room_id,sr.service_item_id,sr.reservation_type,sr.service_name_snapshot,sr.service_price_cents,sr.planned_duration_minutes,sr.note,sr.price_version_id,sr.counts_as_clock_snapshot from service_reservation sr where sr.store_id=:store and sr.technician_id=:technician and sr.status='WAITING' order by sr.created_at,sr.id limit 1 for update")
      .param("store", storeId).param("technician", technicianId).query(QueuedReservation.class).optional().orElse(null);
    if (reservation == null) return;
    UUID sessionId = UUID.randomUUID();
    OffsetDateTime deadline = OffsetDateTime.now().plusSeconds(acceptanceTimeoutSeconds);
    String clockType = "BOOKED_CALL".equals(reservation.reservationType()) ? "BOOKED_CALL" : "BOOKED_QUEUE";
    jdbc.sql("insert into service_session(id,tenant_id,store_id,technician_id,room_id,service_item_id,service_name_snapshot,service_price_cents,planned_duration_minutes,started_at,expected_end_at,status,note,clock_type,price_version_id,counts_as_clock_snapshot,acceptance_deadline_at) values(:id,:tenant,:store,:technician,:room,:service,:name,:price,:duration,null,null,'PENDING_ACCEPTANCE',:note,:clockType,:priceVersion,:countsAsClock,:deadline)")
      .param("id", sessionId).param("tenant", TENANT_ID).param("store", storeId).param("technician", technicianId).param("room", reservation.roomId())
      .param("service", reservation.serviceItemId()).param("name", reservation.serviceNameSnapshot()).param("price", reservation.servicePriceCents()).param("duration", reservation.plannedDurationMinutes())
      .param("note", reservation.note()).param("clockType", clockType).param("priceVersion", reservation.priceVersionId()).param("countsAsClock", reservation.countsAsClockSnapshot()).param("deadline", deadline).update();
    UUID participantId = UUID.randomUUID();
    jdbc.sql("insert into service_session_participant(id,tenant_id,store_id,service_session_id,technician_id,slot_no,sequence_no,participation_type,allocation_bp,status,acceptance_deadline_at) values(:id,:tenant,:store,:session,:technician,1,1,'PRIMARY',10000,'PENDING_ACCEPTANCE',:deadline)")
      .param("id", participantId).param("tenant", TENANT_ID).param("store", storeId).param("session", sessionId).param("technician", technicianId).param("deadline", deadline).update();
    jdbc.sql("update service_reservation set status='DISPATCHED',dispatched_at=now(),updated_at=now(),version=version+1 where id=:id and store_id=:store and status='WAITING'")
      .param("id", reservation.id()).param("store", storeId).update();
    dispatchEvents.record(storeId, sessionId, participantId, "ASSIGNED", null, technicianId, deadline, "Reserved service promoted after front desk clock-out", actorId, actorName);
    audits.record(authorization, storeId, "SERVICE", "SERVICE_RESERVATION_PROMOTED", "service_reservation", reservation.id(), "前台下钟后自动推进预约", reservation, sessionId);
  }

  @PostMapping("/{id}/start-service")
  @Transactional
  ServiceSession startServiceFromFrontdesk(@PathVariable UUID id,
                                           @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                           @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    jdbc.sql("select id from service_session where id=:id and store_id=:store for update")
      .param("id", id).param("store", storeId).query(UUID.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service session not found"));
    ServiceSession accepted = session(storeId, id);
    if (!Set.of("PENDING_ACCEPTANCE", "ACCEPTED").contains(accepted.status())) {
      throw conflict("Only a pending or accepted service can be started by front desk");
    }
    OffsetDateTime startedAt = OffsetDateTime.now();
    OffsetDateTime expectedEndAt = startedAt.plusMinutes(accepted.plannedDurationMinutes());
    LocalDate businessDate = businessClock.businessDate(storeId, startedAt);
    UUID commissionVersionId = itemVersions.commissionRule(storeId, accepted.serviceItemId(), businessDate).id();
    int updated = jdbc.sql("update service_session set status='IN_SERVICE',started_at=:started,expected_end_at=:expected,business_date=:businessDate,commission_rule_version_id=:commissionVersion,acceptance_deadline_at=null,updated_at=now(),version=version+1 where id=:id and store_id=:store and status in ('PENDING_ACCEPTANCE','ACCEPTED')")
      .param("started", startedAt).param("expected", expectedEndAt).param("businessDate", businessDate).param("commissionVersion", commissionVersionId).param("id", id).param("store", storeId).update();
    if (updated == 0) throw conflict("Service state has changed");
    jdbc.sql("update service_session_participant set status='IN_SERVICE',service_started_at=:started,acceptance_deadline_at=null where service_session_id=:session and store_id=:store and status in ('PENDING_ACCEPTANCE','ACCEPTED')")
      .param("started", startedAt).param("session", id).param("store", storeId).update();
    List<UUID> participants = jdbc.sql("select technician_id from service_session_participant where service_session_id=:session and store_id=:store and status='IN_SERVICE' order by slot_no,sequence_no")
      .param("session", id).param("store", storeId).query(UUID.class).list();
    technicianQueue.rotateAfterServiceStart(storeId, businessDate, id, accepted.clockType(), participants, actor.userId(), actor.displayName());
    recordRoomStatus(storeId, accepted.roomId(), "IN_SERVICE", "Front desk started service");
    ServiceSession started = session(storeId, id);
    audits.record(authorization, storeId, "SERVICE", "FRONTDESK_SERVICE_STARTED", "service_session", id, "前台代技师开始服务", accepted, started);
    return started;
  }

  @PostMapping("/{id}/void")
  @Transactional
  ServiceSession voidSession(@PathVariable UUID id,
                             @Valid @RequestBody VoidInput input,
                             @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                             @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    jdbc.sql("select id from service_session where id=:id and store_id=:store for update")
      .param("id", id).param("store", storeId).query(UUID.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service session not found"));
    ServiceSession current = session(storeId, id);
    Set<String> voidableStatuses = Set.of("PENDING_ACCEPTANCE", "ACCEPTED", "REASSIGNMENT_REQUIRED", "DISPATCH_CANCELLED", "COMPLETED");
    if (!voidableStatuses.contains(current.status())) {
      if ("IN_SERVICE".equals(current.status())) throw conflict("服务进行中，请先完成服务或使用换房、加钟等受控操作");
      if ("VOIDED".equals(current.status())) throw conflict("该服务已经作废");
      throw conflict("当前服务状态不允许作废");
    }
    boolean settled = jdbc.sql("""
      select exists(
        select 1
          from sales_order_service_session link
          join sales_order linked_order on linked_order.id=link.order_id
         where link.service_session_id=:session
           and linked_order.status <> 'CANCELLED'
           and linked_order.refund_status <> 'FULL'
      )
      """)
      .param("session", id).query(Boolean.class).single();
    if (settled) throw conflict("该服务已经生成结算单，请使用退款或红冲处理");

    String reason = input.reason().trim();
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    OffsetDateTime voidedAt = OffsetDateTime.now();
    List<VoidParticipant> participants = jdbc.sql("select id,status,service_started_at,service_ended_at from service_session_participant where service_session_id=:session and store_id=:store for update")
      .param("session", id).param("store", storeId).query(VoidParticipant.class).list();
    for (VoidParticipant participant : participants) {
      if (Set.of("REJECTED", "EXPIRED", "VOIDED").contains(participant.status())) continue;
      jdbc.sql("update service_session_participant set status='VOIDED',service_ended_at=:ended,change_reason=:reason where id=:id and store_id=:store and status=:status")
        .param("ended", voidedParticipantEndedAt(participant.serviceStartedAt(), participant.serviceEndedAt(), voidedAt))
        .param("reason", reason).param("id", participant.id()).param("store", storeId).param("status", participant.status()).update();
    }
    jdbc.sql("update service_session set status='VOIDED',void_reason=:reason,voided_at=:voidedAt,voided_by=:actor,updated_at=now(),version=version+1 where id=:id and store_id=:store")
      .param("reason", reason).param("voidedAt", voidedAt).param("actor", actor.userId()).param("id", id).param("store", storeId).update();

    boolean completedService = "COMPLETED".equals(current.status());
    recordRoomStatus(storeId, current.roomId(), completedService ? "CLEANING" : "IDLE",
      completedService ? "Unsettled completed service voided; room requires cleaning" : "Unstarted service voided");
    ServiceSession voided = session(storeId, id);
    audits.record(authorization, storeId, "SERVICE", "SERVICE_VOIDED", "service_session", id,
      "未结算服务已作废；原因：" + reason, current, voided);
    return voided;
  }

  @PutMapping("/{id}/clock-type")
  @Transactional
  ServiceSession changeClockType(@PathVariable UUID id,
                                 @Valid @RequestBody ClockTypeChangeInput input,
                                 @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                 @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    String clockType = normalizeEditableClockType(input.clockType());
    jdbc.sql("select id from service_session where id=:id and store_id=:store for update")
      .param("id", id).param("store", storeId).query(UUID.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service session not found"));
    ServiceSession current = session(storeId, id);
    if (!canChangeClockType(current.status())) {
      throw conflict("Only a pending, accepted, or in-service session can change clock type");
    }
    if (clockType.equals(current.clockType())) return current;
    int updated = jdbc.sql("update service_session set clock_type=:clockType,updated_at=now(),version=version+1 where id=:id and store_id=:store and status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE') and version=:version")
      .param("clockType", clockType).param("id", id).param("store", storeId).param("version", current.version()).update();
    if (updated == 0) throw conflict("Service state has changed; refresh and retry");
    ServiceSession changed = session(storeId, id);
    String reason = input.reason() == null ? "前台更换服务钟类" : input.reason().trim();
    audits.record(authorization, storeId, "SERVICE", "SERVICE_CLOCK_TYPE_CHANGED", "service_session", id,
      reason.isBlank() ? "前台更换服务钟类" : reason, current, changed);
    return changed;
  }

  static OffsetDateTime voidedParticipantEndedAt(OffsetDateTime serviceStartedAt, OffsetDateTime serviceEndedAt, OffsetDateTime voidedAt) {
    return serviceStartedAt != null && serviceEndedAt == null ? voidedAt : serviceEndedAt;
  }

  private void ensureActive(UUID storeId, String table, UUID id, String message) {
    boolean exists = jdbc.sql("select exists(select 1 from " + table + " where id=:id and store_id=:store and active=true)")
      .param("id", id).param("store", storeId).query(Boolean.class).single();
    if (!exists) throw badRequest(message);
  }

  private void lockActiveTechnician(UUID storeId, UUID technicianId) {
    Boolean active = jdbc.sql("select active from technician where id=:id and store_id=:store for update")
      .param("id", technicianId).param("store", storeId).query(Boolean.class).optional().orElse(false);
    if (!Boolean.TRUE.equals(active)) throw badRequest("Technician is unavailable");
  }

  private boolean hasActiveSession(UUID storeId, String column, UUID id) {
    return jdbc.sql("select exists(select 1 from service_session where store_id=:store and " + column + "=:id and status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE'))")
      .param("store", storeId).param("id", id).query(Boolean.class).single();
  }

  private UUID resolveBed(UUID storeId, UUID roomId, UUID requestedBedId) {
    // Rooms created after the bed-occupancy migration may not have generated
    // room_bed rows yet.  Front-desk assignment requires a concrete bed so the
    // active-bed uniqueness constraint can protect concurrent assignments;
    // provision the configured default beds lazily for those legacy rooms.
    ensureRoomBeds(storeId, roomId);
    String sql = "select b.id from room_bed b where b.store_id=:store and b.room_id=:room and b.active=true "
      + (requestedBedId == null ? "" : "and b.id=:bed ")
      + "and not exists(select 1 from service_session ss where ss.store_id=:store and ss.bed_id=b.id and ss.status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE')) order by b.sort_order limit 1 for update";
    var statement = jdbc.sql(sql).param("store", storeId).param("room", roomId);
    if (requestedBedId != null) statement = statement.param("bed", requestedBedId);
    return statement.query(UUID.class).optional().orElseThrow(() -> conflict("该房间没有可用床位"));
  }

  private List<UUID> resolveBeds(UUID storeId, UUID roomId, int requiredCount) {
    ensureRoomBeds(storeId, roomId);
    List<UUID> beds = jdbc.sql("select b.id from room_bed b where b.store_id=:store and b.room_id=:room and b.active=true "
        + "and not exists(select 1 from service_session ss where ss.store_id=:store and ss.bed_id=b.id "
        + "and ss.status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE')) "
        + "order by b.sort_order limit :requiredCount for update")
      .param("store", storeId).param("room", roomId).param("requiredCount", requiredCount)
      .query(UUID.class).list();
    if (beds.size() < requiredCount) throw conflict("该房间没有足够的可用床位");
    return beds;
  }

  /**
   * Backfills only missing bed slots and serializes the operation on the room
   * row.  Existing disabled/customized beds are left untouched.  This keeps
   * the fix compatible with rooms created before and after V75 without adding
   * a migration or changing room capacity semantics.
   */
  private void ensureRoomBeds(UUID storeId, UUID roomId) {
    RoomCapacity room = jdbc.sql("select id,tenant_id,store_id,code,name,bed_count,active from room where id=:room and store_id=:store for update")
      .param("room", roomId).param("store", storeId).query(RoomCapacity.class).optional()
      .orElseThrow(() -> badRequest("Room is unavailable"));
    if (!Boolean.TRUE.equals(room.active())) throw badRequest("Room is unavailable");
    String roomStatus = jdbc.sql("select status from room_status_event where store_id=:store and room_id=:room order by occurred_at desc,id desc limit 1")
      .param("store", storeId).param("room", roomId).query(String.class).optional().orElse("IDLE");
    if (Set.of("PENDING_PAYMENT", "CLEANING", "MAINTENANCE").contains(roomStatus)) {
      throw conflict("Room status does not allow service assignment: " + roomStatus);
    }
    jdbc.sql("""
      insert into room_bed(id,tenant_id,store_id,room_id,code,name,sort_order)
      select gen_random_uuid(),r.tenant_id,r.store_id,r.id,
             left(r.code || '-' || n::text,40),
             left(r.name || ' 床位 ' || n::text,80),
             n
        from room r
        cross join lateral generate_series(1,r.bed_count) n
       where r.id=:room and r.store_id=:store
         and not exists(
           select 1 from room_bed existing
            where existing.room_id=r.id and existing.sort_order=n
         )
      on conflict (room_id,code) do nothing
      """)
      .param("room", room.id()).param("store", room.storeId()).update();
  }

  private boolean hasActiveTechnician(UUID storeId, UUID technicianId) {
    return jdbc.sql("select exists(select 1 from service_session_participant where store_id=:store and technician_id=:technician and status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE'))")
      .param("store", storeId).param("technician", technicianId).query(Boolean.class).single();
  }

  private ServiceSession session(UUID storeId, UUID id) {
    return jdbc.sql(sessionListSql("where ss.id=:id and ss.store_id=:store"))
      .param("id", id).param("store", storeId).query(ServiceSession.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service session not found"));
  }

  static String sessionListSql(String whereClause) {
    return """
      select ss.id,
             ss.technician_id,
             coalesce(
               (select string_agg(tech.name, '、' order by participant.slot_no, participant.sequence_no)
                  from service_session_participant participant
                  join technician tech on tech.id=participant.technician_id
                 where participant.service_session_id=ss.id
                   and participant.status not in ('CANCELLED','REJECTED','EXPIRED')),
               case when ss.status='REASSIGNMENT_REQUIRED' then '待重新派单'
                    when ss.status='DISPATCH_CANCELLED' then '待与客沟通'
                    else t.name end) technician_name,
             ss.room_id,
             r.code room_code,
             ss.service_item_id,
             ss.service_name_snapshot,
             ss.service_price_cents,
             ss.planned_duration_minutes,
             ss.started_at,
             ss.expected_end_at,
             ss.ended_at,
             ss.business_date,
             ss.status,
             ss.note,
             ss.clock_type,
             ss.version,
             coalesce((select sum(extension.service_price_cents)
                         from service_session_extension extension
                        where extension.service_session_id=ss.id), 0) extension_total_cents,
             coalesce((select sum(extension.planned_duration_minutes)
                         from service_session_extension extension
                        where extension.service_session_id=ss.id), 0) extension_total_minutes,
             coalesce((select count(*)::integer
                         from service_session_extension extension
                        where extension.service_session_id=ss.id), 0) extension_count,
             coalesce((select string_agg(extension.technician_id::text, ',' order by extension.added_at, extension.id)
                         from service_session_extension extension
                        where extension.service_session_id=ss.id), '') extension_technician_ids,
             coalesce((select string_agg(extension.service_name_snapshot || ' ' || extension.planned_duration_minutes || '分钟', '、' order by extension.added_at)
                         from service_session_extension extension
                        where extension.service_session_id=ss.id), '') extension_summary,
             coalesce((select string_agg(participant.technician_id::text, ',' order by participant.slot_no, participant.sequence_no)
                         from service_session_participant participant
                        where participant.service_session_id=ss.id
                          and participant.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE','COMPLETED')),
                      ss.technician_id::text) participant_technician_ids,
             coalesce((select string_agg(participant.technician_id::text, ',' order by participant.slot_no, participant.sequence_no)
                         from service_session_participant participant
                        where participant.service_session_id=ss.id
                          and participant.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')),
                      case when ss.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')
                           then ss.technician_id::text end) active_participant_technician_ids,
             coalesce((select string_agg(tech.name, '、' order by participant.slot_no, participant.sequence_no)
                         from service_session_participant participant
                         join technician tech on tech.id=participant.technician_id
                        where participant.service_session_id=ss.id
                          and participant.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')),
                      case when ss.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')
                           then t.name end) active_technician_name,
             coalesce((select count(distinct participant.slot_no)
                         from service_session_participant participant
                        where participant.service_session_id=ss.id
                          and participant.status not in ('CANCELLED','REJECTED','EXPIRED')), 1) participant_count,
             upper('FW-' || substr(replace(ss.id::text, '-', ''), 1, 12)) service_no,
             sales_order.order_no,
             sales_order.settlement_no,
             sales_order.receivable_cents,
             sales_order.paid_cents,
             coalesce((select string_agg(payment.payment_method_name_snapshot || ' ' || to_char(payment.amount_cents/100.0, 'FM999999990.00'), '、' order by payment.created_at)
                         from payment_record payment
                        where payment.order_id=sales_order.id), '') payment_methods,
             coalesce((select sum(commission.commission_cents)
                         from technician_commission_record commission
                        where commission.service_session_id=ss.id), 0) commission_cents
        from service_session ss
        join technician t on t.id=ss.technician_id
        join room r on r.id=ss.room_id
        left join lateral (
          select linked_order.id,
                 linked_order.order_no,
                 linked_order.settlement_no,
                 linked_order.receivable_cents,
                 linked_order.paid_cents
            from sales_order_service_session order_link
            join sales_order linked_order on linked_order.id=order_link.order_id
           where order_link.service_session_id=ss.id
           order by (linked_order.status <> 'CANCELLED' and linked_order.refund_status <> 'FULL') desc,
                    linked_order.settled_at desc nulls last,
                    order_link.created_at desc
           limit 1
        ) sales_order on true
      """ + whereClause + " order by ss.started_at desc";
  }

  private List<ParticipantInput> normalizeParticipants(ClockInInput input) {
    List<ParticipantInput> requested = input.participants() == null || input.participants().isEmpty()
      ? List.of(new ParticipantInput(input.technicianId(), 10000)) : input.participants();
    if (requested.size() > 4) throw badRequest("A service supports at most four technicians");
    Set<UUID> unique = new HashSet<>();
    for (ParticipantInput participant : requested) {
      if (participant.technicianId() == null || !unique.add(participant.technicianId())) throw badRequest("Technicians must be distinct");
    }
    boolean missingAllocation = requested.stream().anyMatch(item -> item.allocationBp() == null);
    if (missingAllocation) {
      int base = 10000 / requested.size();
      int remainder = 10000 - base * requested.size();
      List<ParticipantInput> equal = new ArrayList<>();
      for (int index = 0; index < requested.size(); index++) equal.add(new ParticipantInput(requested.get(index).technicianId(), base + (index == 0 ? remainder : 0)));
      return equal;
    }
    int total = requested.stream().mapToInt(ParticipantInput::allocationBp).sum();
    if (total != 10000) throw badRequest("Technician allocation percentages must total 100 percent");
    return requested;
  }

  private List<BatchParticipantInput> normalizeBatchParticipants(ClockInBatchInput input) {
    if (input.participants() == null || input.participants().isEmpty()) {
      throw badRequest("At least one technician is required");
    }
    Set<UUID> unique = new HashSet<>();
    for (BatchParticipantInput participant : input.participants()) {
      if (participant.technicianId() == null || !unique.add(participant.technicianId())) {
        throw badRequest("Technicians must be distinct");
      }
      if (participant.serviceItemId() == null) throw badRequest("Service item is required");
      if (participant.plannedDurationMinutes() == null || participant.plannedDurationMinutes() < 15 || participant.plannedDurationMinutes() > 360) {
        throw badRequest("Service duration must be between 15 and 360 minutes");
      }
      if (participant.allocationBp() != null && participant.allocationBp() != 10000) {
        throw badRequest("Each technician allocation must total 100 percent");
      }
    }
    return input.participants();
  }

  private String normalizeClockType(String clockType) {
    if (clockType == null || clockType.isBlank()) return "QUEUE";
    if ("QUEUE".equals(clockType) || "CALL".equals(clockType) || "SELECTED".equals(clockType)
      || "BOOKED_QUEUE".equals(clockType) || "BOOKED_CALL".equals(clockType)) return clockType;
    throw badRequest("Unsupported clock type");
  }

  static boolean canChangeClockType(String status) {
    return Set.of("PENDING_ACCEPTANCE", "ACCEPTED", "IN_SERVICE").contains(status);
  }

  static String normalizeEditableClockType(String clockType) {
    if (clockType == null || clockType.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Clock type is required");
    if ("QUEUE".equals(clockType) || "CALL".equals(clockType)) return clockType;
    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only queue or call clock type can be selected");
  }

  private void recordRoomStatus(UUID storeId, UUID roomId, String status, String reason) {
    // Serialize every room-state transition with front desk, mobile, and transfer writes.
    lockRoom(storeId, roomId);
    boolean hasInService = jdbc.sql("select exists(select 1 from service_session where store_id=:store and room_id=:room and status='IN_SERVICE')")
      .param("store", storeId).param("room", roomId).query(Boolean.class).single();
    boolean hasPending = jdbc.sql("select exists(select 1 from service_session where store_id=:store and room_id=:room and status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED'))")
      .param("store", storeId).param("room", roomId).query(Boolean.class).single();
    if (hasInService && !"MAINTENANCE".equals(status)) status = "IN_SERVICE";
    else if (hasPending && Set.of("IDLE", "PENDING_PAYMENT", "CLEANING").contains(status)) status = "RESERVED";
    jdbc.sql("insert into room_status_event(id,tenant_id,store_id,room_id,status,reason,source,occurred_at) values(:id,:tenant,:store,:room,:status,:reason,'SERVICE_SESSION',clock_timestamp())")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("room", roomId)
      .param("status", status).param("reason", reason).update();
  }

  private void lockRoom(UUID storeId, UUID roomId) {
    jdbc.sql("select id from room where id=:room and store_id=:store for update")
      .param("room", roomId).param("store", storeId).query(UUID.class).optional()
      .orElseThrow(() -> badRequest("Room is unavailable"));
  }

  private ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }

  record ServiceItem(UUID id, String name, Integer priceCents) {}
  record RoomCapacity(UUID id, UUID tenantId, UUID storeId, String code, String name, Short bedCount, Boolean active) {}
  record VoidParticipant(UUID id, String status, OffsetDateTime serviceStartedAt, OffsetDateTime serviceEndedAt) {}
  record QueuedReservation(UUID id, UUID roomId, UUID serviceItemId, String reservationType, String serviceNameSnapshot, Integer servicePriceCents, Short plannedDurationMinutes, String note, UUID priceVersionId, Boolean countsAsClockSnapshot) {}
  record ServiceSession(UUID id, UUID technicianId, String technicianName, UUID roomId, String roomCode, UUID serviceItemId, String serviceNameSnapshot, Integer servicePriceCents, Short plannedDurationMinutes, OffsetDateTime startedAt, OffsetDateTime expectedEndAt, OffsetDateTime endedAt, LocalDate businessDate, String status, String note, String clockType, Long version, Integer extensionTotalCents, Integer extensionTotalMinutes, Integer extensionCount, String extensionTechnicianIds, String extensionSummary, String participantTechnicianIds, String activeParticipantTechnicianIds, String activeTechnicianName, Long participantCount, String serviceNo, String orderNo, String settlementNo, Long receivableCents, Long paidCents, String paymentMethods, Long commissionCents) {}
  record ParticipantInput(@NotNull UUID technicianId, @Min(1) @Max(10000) Integer allocationBp) {}
  record BatchParticipantInput(@NotNull UUID technicianId, @NotNull UUID serviceItemId,
                               @NotNull @Min(15) @Max(360) Short plannedDurationMinutes,
                               Integer allocationBp, String clockType, String note) {}
  record ResolvedBatchParticipant(BatchParticipantInput input, ResolvedServiceItem service,
                                 String clockType, int allocationBp) {}
  record ClockInBatchInput(@NotNull UUID roomId, @NotNull @Size(min = 1, max = 4) List<@Valid BatchParticipantInput> participants) {}
  record VoidInput(@NotBlank String reason) {}
  record ClockTypeChangeInput(@NotBlank String clockType, String reason) {}
  record ClockInInput(UUID technicianId, List<@Valid ParticipantInput> participants, @NotNull UUID roomId, UUID bedId, @NotNull UUID serviceItemId, @NotNull @Min(15) @Max(360) Short plannedDurationMinutes, String note, String clockType) {}
}
