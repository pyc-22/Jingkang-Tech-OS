package com.chengxin.massage.catalog;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.BusinessClockService;
import com.chengxin.massage.catalog.ServiceItemVersionService.ResolvedServiceItem;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/service-reservations")
@CrossOrigin(origins = "*")
public class ServiceReservationController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final AuditService audits;
  private final BusinessClockService businessClock;
  private final ServiceItemVersionService itemVersions;
  private final ServiceDispatchEventService dispatchEvents;
  private final TechnicianSchedulePolicy schedulePolicy;

  @Value("${massage.dispatch.acceptance-timeout-seconds:300}")
  private int acceptanceTimeoutSeconds;

  ServiceReservationController(JdbcClient jdbc, StoreContextService storeContext, AdminSessionService adminSessions, AuditService audits, BusinessClockService businessClock, ServiceItemVersionService itemVersions, ServiceDispatchEventService dispatchEvents, TechnicianSchedulePolicy schedulePolicy) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.audits = audits;
    this.businessClock = businessClock;
    this.itemVersions = itemVersions;
    this.dispatchEvents = dispatchEvents;
    this.schedulePolicy = schedulePolicy;
  }

  @GetMapping
  List<Reservation> list(@RequestParam(defaultValue = "WAITING") String status,
                         @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                         @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql(sql("where sr.store_id=:store and sr.status=:status"))
      .param("store", storeId).param("status", status).query(Reservation.class).list();
  }

  @PostMapping
  @Transactional
  Reservation create(@Valid @RequestBody ReservationInput input,
                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    validateType(input.reservationType());
    ResolvedServiceItem service = service(storeId, input.serviceItemId());
    ensureActive(storeId, "technician", input.technicianId(), "Technician is unavailable");
    schedulePolicy.requireClockInEligibility(storeId, input.technicianId());
    ensureActive(storeId, "room", input.roomId(), "Room is unavailable");
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into service_reservation(id,tenant_id,store_id,room_id,technician_id,service_item_id,reservation_type,service_name_snapshot,service_price_cents,planned_duration_minutes,note,created_by_user_id,created_by_name_snapshot,price_version_id,counts_as_clock_snapshot) values(:id,:tenant,:store,:room,:technician,:service,:type,:name,:price,:duration,:note,:user,:userName,:priceVersion,:countsAsClock)")
      .param("id", id).param("tenant", TENANT_ID).param("store", storeId).param("room", input.roomId()).param("technician", input.technicianId())
      .param("service", service.id()).param("type", input.reservationType()).param("name", service.name()).param("price", service.priceCents())
      .param("duration", input.plannedDurationMinutes()).param("note", input.note()).param("user", actor.userId()).param("userName", actor.displayName()).param("priceVersion", service.priceVersionId()).param("countsAsClock", service.countsAsClock()).update();
    recordRoomStatus(storeId, input.roomId(), "RESERVED", "Service reservation: " + service.name());
    Reservation created = reservation(storeId, id);
    audits.record(authorization, storeId, "SERVICE", "SERVICE_RESERVATION_CREATED", "service_reservation", id, "Created service reservation", null, created);
    return created;
  }

  @PostMapping("/{id}/dispatch")
  @Transactional
  ServiceSession dispatch(@PathVariable UUID id, @Valid @RequestBody DispatchInput input,
                          @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                          @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    ReservationLock reservation = reservationForUpdate(storeId, id);
    if (!"WAITING".equals(reservation.status())) throw conflict("Reservation is no longer waiting");
    ResolvedServiceItem service = service(storeId, input.serviceItemId());
    ensureActive(storeId, "technician", input.technicianId(), "Technician is unavailable");
    schedulePolicy.requireClockInEligibility(storeId, input.technicianId());
    if (shouldRejectBusyTechnician(hasActiveSession(storeId, input.technicianId()), reservation.reservationType())) {
      throw conflict("Technician is still serving; dispatch after clock-out");
    }
    if (hasActiveSession(storeId, reservation.roomId())) throw conflict("Reservation room already has an active service");
    String roomStatus = latestRoomStatus(storeId, reservation.roomId());
    if ("PENDING_PAYMENT".equals(roomStatus)) throw conflict("当前服务已下钟，待前台完成收款后再执行预约");
    if ("CLEANING".equals(roomStatus)) throw conflict("预约房间正在清洁，请完成清洁后再执行预约");
    if ("MAINTENANCE".equals(roomStatus)) throw conflict("预约房间正在维修");
    UUID sessionId = UUID.randomUUID();
    OffsetDateTime acceptanceDeadline = OffsetDateTime.now().plusSeconds(acceptanceTimeoutSeconds);
    String clockType = "BOOKED_CALL".equals(reservation.reservationType()) ? "BOOKED_CALL" : "BOOKED_QUEUE";
    jdbc.sql("insert into service_session(id,tenant_id,store_id,technician_id,room_id,service_item_id,service_name_snapshot,service_price_cents,planned_duration_minutes,started_at,expected_end_at,status,note,clock_type,price_version_id,counts_as_clock_snapshot,acceptance_deadline_at) values(:id,:tenant,:store,:technician,:room,:service,:name,:price,:duration,null,null,'PENDING_ACCEPTANCE',:note,:clockType,:priceVersion,:countsAsClock,:deadline)")
      .param("id", sessionId).param("tenant", TENANT_ID).param("store", storeId).param("technician", input.technicianId()).param("room", reservation.roomId())
      .param("service", service.id()).param("name", service.name()).param("price", service.priceCents()).param("duration", input.plannedDurationMinutes())
      .param("note", reservation.note()).param("clockType", clockType).param("priceVersion", service.priceVersionId()).param("countsAsClock", service.countsAsClock()).param("deadline", acceptanceDeadline).update();
    UUID participantId = UUID.randomUUID();
    jdbc.sql("insert into service_session_participant(id,tenant_id,store_id,service_session_id,technician_id,slot_no,sequence_no,participation_type,allocation_bp,status,acceptance_deadline_at) values(:id,:tenant,:store,:session,:technician,1,1,'PRIMARY',10000,'PENDING_ACCEPTANCE',:deadline)")
      .param("id", participantId).param("tenant", TENANT_ID).param("store", storeId).param("session", sessionId).param("technician", input.technicianId()).param("deadline", acceptanceDeadline).update();
    jdbc.sql("update service_reservation set status='DISPATCHED',dispatched_at=now(),updated_at=now(),version=version+1 where id=:id and store_id=:store and status='WAITING'")
      .param("id", id).param("store", storeId).update();
    dispatchEvents.record(storeId, sessionId, participantId, "ASSIGNED", null, input.technicianId(), acceptanceDeadline,
      "Reserved service dispatched", actor.userId(), actor.displayName());
    audits.record(authorization, storeId, "SERVICE", "SERVICE_RESERVATION_DISPATCHED", "service_reservation", id, "Dispatched reserved service", reservation, sessionId);
    return new ServiceSession(sessionId, reservation.roomId(), service.name(), input.technicianId(), clockType);
  }

  private Reservation reservation(UUID storeId, UUID id) { return jdbc.sql(sql("where sr.store_id=:store and sr.id=:id")).param("store", storeId).param("id", id).query(Reservation.class).single(); }
  private ReservationLock reservationForUpdate(UUID storeId, UUID id) { return jdbc.sql("select id,room_id,technician_id,service_item_id,reservation_type,status,note from service_reservation where id=:id and store_id=:store for update").param("id", id).param("store", storeId).query(ReservationLock.class).single(); }
  private ResolvedServiceItem service(UUID storeId, UUID id) { return itemVersions.activeItem(storeId, id, businessClock.currentBusinessDate(storeId)).orElseThrow(() -> badRequest("Service item is unavailable")); }
  private void ensureActive(UUID storeId, String table, UUID id, String message) { if (!jdbc.sql("select exists(select 1 from " + table + " where id=:id and store_id=:store and active=true)").param("id", id).param("store", storeId).query(Boolean.class).single()) throw badRequest(message); }
  private boolean hasActiveSession(UUID storeId, UUID id) { return jdbc.sql("select exists(select 1 from service_session session where session.store_id=:store and ((session.room_id=:id and session.status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','IN_SERVICE')) or (session.technician_id=:id and session.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE'))))").param("store", storeId).param("id", id).query(Boolean.class).single(); }

  static boolean shouldRejectBusyTechnician(boolean busy, String reservationType) {
    return busy && !List.of("BOOKED_QUEUE", "BOOKED_CALL").contains(reservationType);
  }
  private String latestRoomStatus(UUID storeId, UUID id) { return jdbc.sql("select status from room_status_event where store_id=:store and room_id=:room order by occurred_at desc,id desc limit 1").param("store", storeId).param("room", id).query(String.class).optional().orElse("IDLE"); }
  private void recordRoomStatus(UUID storeId, UUID roomId, String status, String reason) {
    boolean active = jdbc.sql("select exists(select 1 from service_session where store_id=:store and room_id=:room and status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE'))")
      .param("store", storeId).param("room", roomId).query(Boolean.class).single();
    String effective = active && "RESERVED".equals(status) ? "IN_SERVICE" : status;
    jdbc.sql("insert into room_status_event(id,tenant_id,store_id,room_id,status,reason,source) values(:id,:tenant,:store,:room,:status,:reason,'SERVICE_RESERVATION')")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("room", roomId).param("status", effective).param("reason", reason).update();
  }
  private void validateType(String type) { if (!"BOOKED_CALL".equals(type) && !"BOOKED_QUEUE".equals(type)) throw badRequest("Unsupported reservation type"); }
  private String sql(String where) { return "select sr.id,sr.room_id,r.code room_code,sr.technician_id,t.name technician_name,sr.service_item_id,sr.reservation_type,sr.status,sr.service_name_snapshot,sr.service_price_cents,sr.planned_duration_minutes,sr.note,sr.created_at,sr.dispatched_at from service_reservation sr join room r on r.id=sr.room_id left join technician t on t.id=sr.technician_id " + where + " order by sr.created_at"; }
  private ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }

  record ReservationInput(@NotNull UUID roomId, @NotNull UUID technicianId, @NotNull UUID serviceItemId, @NotNull @Size(max = 20) String reservationType, @NotNull @Min(15) @Max(360) Short plannedDurationMinutes, @Size(max = 240) String note) {}
  record DispatchInput(@NotNull UUID technicianId, @NotNull UUID serviceItemId, @NotNull @Min(15) @Max(360) Short plannedDurationMinutes) {}
  record ReservationLock(UUID id, UUID roomId, UUID technicianId, UUID serviceItemId, String reservationType, String status, String note) {}
  record Reservation(UUID id, UUID roomId, String roomCode, UUID technicianId, String technicianName, UUID serviceItemId, String reservationType, String status, String serviceNameSnapshot, Integer servicePriceCents, Short plannedDurationMinutes, String note, OffsetDateTime createdAt, OffsetDateTime dispatchedAt) {}
  record ServiceSession(UUID id, UUID roomId, String serviceNameSnapshot, UUID technicianId, String clockType) {}
}
