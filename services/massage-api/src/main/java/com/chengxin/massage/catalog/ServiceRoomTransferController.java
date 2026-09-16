package com.chengxin.massage.catalog;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.mobile.MobileSessionService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
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

/** Coordinates an in-service room transfer without changing the service/order lifecycle. */
@RestController
@RequestMapping("/api/v1")
@CrossOrigin(origins = "*")
public class ServiceRoomTransferController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final MobileSessionService mobileSessions;
  private final AuditService audits;
  private final RoomStateService roomStates;

  ServiceRoomTransferController(JdbcClient jdbc, StoreContextService storeContext,
                                AdminSessionService adminSessions, MobileSessionService mobileSessions,
                                AuditService audits, RoomStateService roomStates) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.mobileSessions = mobileSessions;
    this.audits = audits;
    this.roomStates = roomStates;
  }

  @PostMapping("/mobile/technician/service-room-transfers")
  @Transactional
  TransferRequest requestFromTechnician(@Valid @RequestBody TransferInput input,
                                        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Technician room transfer is disabled");
  }

  @PostMapping("/service-room-transfers")
  @Transactional
  TransferRequest requestFromFrontdesk(@Valid @RequestBody TransferInput input,
                                       @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                       @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    return createRequest(input, authorization, storeId, null, actor.userId(), actor.displayName());
  }

  @GetMapping("/service-room-transfers")
  List<TransferRequest> list(@RequestParam(required = false) String status,
                             @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                             @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    String where = status == null || status.isBlank()
      ? "where tr.store_id=:store"
      : "where tr.store_id=:store and tr.status=:status";
    JdbcClient.StatementSpec statement = jdbc.sql(transferSql(where)).param("store", storeId);
    if (status != null && !status.isBlank()) statement.param("status", status);
    return statement.query(TransferRequest.class).list();
  }

  @PostMapping("/service-room-transfers/{id}/approve")
  @Transactional
  TransferRequest approve(@PathVariable UUID id,
                          @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                          @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    TransferLock transfer = transferForUpdate(storeId, id);
    if (!"REQUESTED".equals(transfer.status())) throw conflict("Transfer request is no longer pending");
    ServiceLock service = serviceForUpdate(storeId, transfer.serviceSessionId());
    if (!canTransfer(service.status())) throw conflict("Only a pending, accepted, or in-service session can be transferred");
    if (!transfer.fromRoomId().equals(service.roomId())) throw conflict("Service room has changed; refresh the request");
    lockRooms(storeId, transfer.fromRoomId(), transfer.toRoomId());
    ensureApprovalTargetAvailable(storeId, transfer.id(), transfer.toRoomId());
    UUID targetBed = targetBedForUpdate(storeId, transfer.toRoomId());

    int updated = jdbc.sql("update service_session set room_id=:toRoom,bed_id=:bed,updated_at=now(),version=version+1 where id=:id and store_id=:store and status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE') and room_id=:fromRoom and version=:version")
      .param("id", service.id()).param("store", storeId).param("toRoom", transfer.toRoomId()).param("bed", targetBed)
      .param("fromRoom", transfer.fromRoomId()).param("version", service.version()).update();
    if (updated == 0) throw conflict("Service changed while approving transfer");
    boolean inService = "IN_SERVICE".equals(service.status());
    recordRoomStatus(storeId, transfer.fromRoomId(), inService ? "CLEANING" : "IDLE", "Service transferred to another room", "ROOM_TRANSFER");
    recordRoomStatus(storeId, transfer.toRoomId(), inService ? "IN_SERVICE" : "RESERVED", "Service transferred from another room", "ROOM_TRANSFER");
    jdbc.sql("update service_room_transfer set status='APPROVED',approved_by_user_id=:user,approved_by_name_snapshot=:name,approved_at=now(),updated_at=now(),version=version+1 where id=:id and store_id=:store and status='REQUESTED'")
      .param("id", id).param("store", storeId).param("user", actor.userId()).param("name", actor.displayName()).update();
    TransferRequest result = transfer(storeId, id);
    audits.record(authorization, storeId, "ROOM", "SERVICE_ROOM_TRANSFER_APPROVED", "service_room_transfer", id,
      "Approved service room transfer", transfer, result);
    return result;
  }

  @PostMapping("/service-room-transfers/{id}/reject")
  @Transactional
  TransferRequest reject(@PathVariable UUID id, @Valid @RequestBody RejectInput input,
                         @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                         @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    TransferLock transfer = transferForUpdate(storeId, id);
    if (!"REQUESTED".equals(transfer.status())) throw conflict("Transfer request is no longer pending");
    lockRooms(storeId, transfer.fromRoomId(), transfer.toRoomId());
    RoomStatusEvent targetStatus = latestRoomStatusEvent(storeId, transfer.toRoomId());
    if (isTransferReservation(targetStatus, transfer.id()) && !hasActiveSession(storeId, transfer.toRoomId())) {
      recordRoomStatus(storeId, transfer.toRoomId(), "IDLE", "Service room transfer rejected", "ROOM_TRANSFER");
    }
    jdbc.sql("update service_room_transfer set status='REJECTED',rejection_note=:note,approved_by_user_id=:user,approved_by_name_snapshot=:name,approved_at=now(),updated_at=now(),version=version+1 where id=:id and store_id=:store and status='REQUESTED'")
      .param("id", id).param("store", storeId).param("note", input.note()).param("user", actor.userId()).param("name", actor.displayName()).update();
    TransferRequest result = transfer(storeId, id);
    audits.record(authorization, storeId, "ROOM", "SERVICE_ROOM_TRANSFER_REJECTED", "service_room_transfer", id,
      "Rejected service room transfer", transfer, result);
    return result;
  }

  private TransferRequest createRequest(TransferInput input, String authorization, UUID storeId, UUID technicianId,
                                        UUID requesterId, String requesterName) {
    ServiceLock service = serviceForUpdate(storeId, input.serviceSessionId());
    if (technicianId != null) {
      boolean participant = jdbc.sql("select exists(select 1 from service_session_participant where service_session_id=:session and store_id=:store and technician_id=:technician and status='IN_SERVICE')")
        .param("session", input.serviceSessionId()).param("store", storeId).param("technician", technicianId).query(Boolean.class).single();
      if (!participant) throw forbidden("Service does not belong to the technician");
    }
    if (!canTransfer(service.status())) throw conflict("Only a pending, accepted, or in-service session can be transferred");
    if (service.roomId().equals(input.toRoomId())) throw badRequest("Target room must be different from current room");
    if (jdbc.sql("select exists(select 1 from service_room_transfer where store_id=:store and service_session_id=:session and status='REQUESTED')")
      .param("store", storeId).param("session", input.serviceSessionId()).query(Boolean.class).single()) {
      throw conflict("A transfer request is already pending for this service");
    }
    lockRooms(storeId, service.roomId(), input.toRoomId());
    String expectedRoomStatus = "IN_SERVICE".equals(service.status()) ? "IN_SERVICE" : "RESERVED";
    if (!expectedRoomStatus.equals(latestRoomStatus(storeId, service.roomId()))) throw conflict("Current room status does not match the service state");
    ensureTargetRoomAvailable(storeId, input.toRoomId(), service.roomId());
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into service_room_transfer(id,tenant_id,store_id,service_session_id,from_room_id,to_room_id,status,reason,requested_by_user_id,requested_by_name_snapshot) values(:id,:tenant,:store,:session,:fromRoom,:toRoom,'REQUESTED',:reason,:user,:name)")
      .param("id", id).param("tenant", TENANT_ID).param("store", storeId).param("session", input.serviceSessionId())
      .param("fromRoom", service.roomId()).param("toRoom", input.toRoomId()).param("reason", input.reason())
      .param("user", requesterId).param("name", requesterName).update();
    recordRoomStatus(storeId, input.toRoomId(), "RESERVED", "Room reserved for service transfer " + id, "ROOM_TRANSFER");
    TransferRequest created = transfer(storeId, id);
    audits.record(authorization, storeId, "ROOM", "SERVICE_ROOM_TRANSFER_REQUESTED", "service_room_transfer", id,
      "Requested service room transfer", null, created);
    return created;
  }

  private Technician technicianForUser(UUID userId) {
    return jdbc.sql("select t.id,t.name,b.store_id from technician_account_binding b join technician t on t.id=b.technician_id and t.store_id=b.store_id join store s on s.id=b.store_id where b.user_id=:user and b.tenant_id=:tenant and t.tenant_id=:tenant and s.tenant_id=:tenant and b.active=true and t.active=true and s.active=true")
      .param("user", userId).param("tenant", TENANT_ID).query(Technician.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Technician account is unavailable"));
  }

  private ServiceLock serviceForUpdate(UUID storeId, UUID id) {
    return jdbc.sql("select id,technician_id,room_id,status,version from service_session where id=:id and store_id=:store for update")
      .param("id", id).param("store", storeId).query(ServiceLock.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service session not found"));
  }

  private TransferLock transferForUpdate(UUID storeId, UUID id) {
    return jdbc.sql("select id,service_session_id,from_room_id,to_room_id,status,reason,rejection_note,version from service_room_transfer where id=:id and store_id=:store for update")
      .param("id", id).param("store", storeId).query(TransferLock.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Transfer request not found"));
  }

  private void lockRooms(UUID storeId, UUID fromRoomId, UUID toRoomId) {
    List<UUID> locked = jdbc.sql("select id from room where store_id=:store and id in (:fromRoom,:toRoom) order by id for update")
      .param("store", storeId).param("fromRoom", fromRoomId).param("toRoom", toRoomId).query(UUID.class).list();
    if (locked.size() != 2) throw badRequest("Both rooms must belong to the selected store");
  }

  private void ensureTargetRoomAvailable(UUID storeId, UUID targetRoomId, UUID currentRoomId) {
    boolean active = jdbc.sql("select active from room where id=:room and store_id=:store")
      .param("room", targetRoomId).param("store", storeId).query(Boolean.class).optional().orElse(false);
    if (!active) throw conflict("Target room is unavailable");
    if (!"IDLE".equals(latestRoomStatus(storeId, targetRoomId))) throw conflict("Target room is not idle");
    if (hasActiveSession(storeId, targetRoomId)) throw conflict("Target room already has an active service");
  }

  private void ensureApprovalTargetAvailable(UUID storeId, UUID transferId, UUID targetRoomId) {
    boolean active = jdbc.sql("select active from room where id=:room and store_id=:store")
      .param("room", targetRoomId).param("store", storeId).query(Boolean.class).optional().orElse(false);
    if (!active) throw conflict("Target room is unavailable");
    RoomStatusEvent status = latestRoomStatusEvent(storeId, targetRoomId);
    boolean reservedByThisRequest = isTransferReservation(status, transferId);
    if (!"IDLE".equals(status.status()) && !reservedByThisRequest) throw conflict("Target room is no longer idle");
    if (hasActiveSession(storeId, targetRoomId)) throw conflict("Target room already has an active service");
  }

  private boolean hasActiveSession(UUID storeId, UUID roomId) {
    return jdbc.sql("select exists(select 1 from service_session where store_id=:store and room_id=:room and status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','IN_SERVICE'))")
      .param("store", storeId).param("room", roomId).query(Boolean.class).single();
  }

  private boolean canTransfer(String status) {
    return "PENDING_ACCEPTANCE".equals(status) || "ACCEPTED".equals(status) || "IN_SERVICE".equals(status);
  }

  private String latestRoomStatus(UUID storeId, UUID roomId) {
    return latestRoomStatusEvent(storeId, roomId).status();
  }

  private RoomStatusEvent latestRoomStatusEvent(UUID storeId, UUID roomId) {
    return jdbc.sql("select status,source,reason from room_status_event where store_id=:store and room_id=:room order by occurred_at desc,id desc limit 1")
      .param("store", storeId).param("room", roomId).query(RoomStatusEvent.class).optional().orElse(new RoomStatusEvent("IDLE", null, null));
  }

  private boolean isTransferReservation(RoomStatusEvent event, UUID transferId) {
    return "RESERVED".equals(event.status()) && "ROOM_TRANSFER".equals(event.source())
      && event.reason() != null && event.reason().contains(transferId.toString());
  }

  private void recordRoomStatus(UUID storeId, UUID roomId, String status, String reason, String source) {
    roomStates.record(storeId, roomId, status, reason, source);
  }

  private UUID targetBedForUpdate(UUID storeId, UUID roomId) {
    jdbc.sql("""
      insert into room_bed(id,tenant_id,store_id,room_id,code,name,sort_order)
      select gen_random_uuid(),r.tenant_id,r.store_id,r.id,left(r.code||'-'||n,40),left(r.name||' bed '||n,80),n
      from room r cross join lateral generate_series(1,r.bed_count) n
      where r.id=:room and r.store_id=:store
        and not exists(select 1 from room_bed b where b.room_id=r.id)
      on conflict (room_id,code) do nothing
      """).param("room", roomId).param("store", storeId).update();
    return jdbc.sql("""
      select b.id from room_bed b where b.room_id=:room and b.store_id=:store and b.active=true
        and not exists(select 1 from service_session s where s.bed_id=b.id
          and s.status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE'))
      order by b.sort_order,b.id limit 1 for update of b
      """).param("room", roomId).param("store", storeId).query(UUID.class).optional()
      .orElseThrow(() -> conflict("Target room has no available bed"));
  }

  private TransferRequest transfer(UUID storeId, UUID id) {
    return jdbc.sql(transferSql("where tr.store_id=:store and tr.id=:id"))
      .param("store", storeId).param("id", id).query(TransferRequest.class).single();
  }

  private String transferSql(String where) {
    return "select tr.id,tr.store_id,tr.service_session_id,tr.from_room_id,fr.code from_room_code,tr.to_room_id,trm.code to_room_code,tr.status,tr.reason,tr.rejection_note,tr.requested_by_user_id,tr.requested_by_name_snapshot,tr.approved_by_user_id,tr.approved_by_name_snapshot,tr.requested_at,tr.approved_at,tr.updated_at,tr.version,ss.service_name_snapshot,ss.technician_id,t.name technician_name from service_room_transfer tr join room fr on fr.id=tr.from_room_id join room trm on trm.id=tr.to_room_id join service_session ss on ss.id=tr.service_session_id join technician t on t.id=ss.technician_id " + where + " order by tr.requested_at desc,tr.id desc";
  }

  private ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }
  private ResponseStatusException forbidden(String message) { return new ResponseStatusException(HttpStatus.FORBIDDEN, message); }

  record Technician(UUID id, String name, UUID storeId) {}
  record ServiceLock(UUID id, UUID technicianId, UUID roomId, String status, Long version) {}
  record TransferLock(UUID id, UUID serviceSessionId, UUID fromRoomId, UUID toRoomId, String status, String reason, String rejectionNote, Long version) {}
  record RoomStatusEvent(String status, String source, String reason) {}
  record TransferInput(@NotNull UUID serviceSessionId, @NotNull UUID toRoomId, @NotBlank @Size(max = 240) String reason) {}
  record RejectInput(@NotBlank @Size(max = 240) String note) {}
  record TransferRequest(UUID id, UUID storeId, UUID serviceSessionId, UUID fromRoomId, String fromRoomCode,
                         UUID toRoomId, String toRoomCode, String status, String reason, String rejectionNote,
                         UUID requestedByUserId, String requestedByNameSnapshot, UUID approvedByUserId,
                         String approvedByNameSnapshot, OffsetDateTime requestedAt, OffsetDateTime approvedAt,
                         OffsetDateTime updatedAt, Long version, String serviceNameSnapshot, UUID technicianId,
                         String technicianName) {}
}
