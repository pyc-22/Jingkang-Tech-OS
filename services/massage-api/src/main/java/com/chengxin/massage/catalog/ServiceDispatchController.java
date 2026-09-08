package com.chengxin.massage.catalog;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
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
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/service-sessions/{sessionId}")
@CrossOrigin(origins = "*")
public class ServiceDispatchController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final TechnicianSchedulePolicy schedulePolicy;
  private final ServiceDispatchEventService events;
  private final AuditService audits;

  @Value("${massage.dispatch.acceptance-timeout-seconds:300}")
  private int acceptanceTimeoutSeconds;

  ServiceDispatchController(JdbcClient jdbc, StoreContextService storeContext, AdminSessionService adminSessions,
                            TechnicianSchedulePolicy schedulePolicy, ServiceDispatchEventService events, AuditService audits) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.schedulePolicy = schedulePolicy;
    this.events = events;
    this.audits = audits;
  }

  @GetMapping("/dispatch-events")
  List<DispatchEvent> events(@PathVariable UUID sessionId,
                             @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                             @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    ensureSession(storeId, sessionId, false);
    return jdbc.sql("select event.id,event.participant_id,event.event_type,event.from_technician_id,event.to_technician_id,event.acceptance_deadline_at,event.reason,event.actor_name_snapshot,event.occurred_at from service_dispatch_event event where event.store_id=:store and event.service_session_id=:session order by event.occurred_at,event.id")
      .param("store", storeId).param("session", sessionId).query(DispatchEvent.class).list();
  }

  @PostMapping("/reassign")
  @Transactional
  ReassignmentResult reassign(@PathVariable UUID sessionId, @Valid @RequestBody ReassignInput input,
                              @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                              @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    SessionRow session = ensureSession(storeId, sessionId, true);
    if (!ServiceDispatchLifecycle.canBeReassigned(session.status())) throw conflict("Service does not require reassignment");
    ParticipantRow previous = jdbc.sql("select id,technician_id,slot_no,sequence_no,allocation_bp,status from service_session_participant where service_session_id=:session and store_id=:store and slot_no=:slot and status in ('REJECTED','EXPIRED') order by sequence_no desc limit 1 for update")
      .param("session", sessionId).param("store", storeId).param("slot", input.slotNo()).query(ParticipantRow.class).optional()
      .orElseThrow(() -> conflict("The technician position is not awaiting reassignment"));
    boolean available = jdbc.sql("select exists(select 1 from technician where id=:technician and store_id=:store and active=true)")
      .param("technician", input.technicianId()).param("store", storeId).query(Boolean.class).single();
    if (!available) throw bad("Replacement technician is unavailable");
    schedulePolicy.requireClockInEligibility(storeId, input.technicianId());
    boolean busy = jdbc.sql("select exists(select 1 from service_session_participant where store_id=:store and technician_id=:technician and status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE'))")
      .param("store", storeId).param("technician", input.technicianId()).query(Boolean.class).single();
    if (busy) throw conflict("Replacement technician already has a pending or active service");
    short nextSequence = jdbc.sql("select (coalesce(max(sequence_no),0)+1)::smallint from service_session_participant where service_session_id=:session and slot_no=:slot")
      .param("session", sessionId).param("slot", previous.slotNo()).query(Short.class).single();
    UUID replacementId = UUID.randomUUID();
    OffsetDateTime deadline = OffsetDateTime.now().plusSeconds(acceptanceTimeoutSeconds);
    jdbc.sql("insert into service_session_participant(id,tenant_id,store_id,service_session_id,technician_id,slot_no,sequence_no,participation_type,allocation_bp,status,replaced_participant_id,change_reason,acceptance_deadline_at) values(:id,:tenant,:store,:session,:technician,:slot,:sequence,'REPLACEMENT',:allocation,'PENDING_ACCEPTANCE',:replaced,:reason,:deadline)")
      .param("id", replacementId).param("tenant", TENANT_ID).param("store", storeId).param("session", sessionId).param("technician", input.technicianId())
      .param("slot", previous.slotNo()).param("sequence", nextSequence).param("allocation", previous.allocationBp()).param("replaced", previous.id()).param("reason", input.reason().trim()).param("deadline", deadline).update();
    jdbc.sql("update service_session set status=case when exists(select 1 from service_session_participant unresolved where unresolved.service_session_id=:session and unresolved.status in ('REJECTED','EXPIRED') and not exists(select 1 from service_session_participant replacement where replacement.replaced_participant_id=unresolved.id)) then 'REASSIGNMENT_REQUIRED' else 'PENDING_ACCEPTANCE' end,technician_id=case when technician_id=:from then :to else technician_id end,acceptance_deadline_at=:deadline,updated_at=now(),version=version+1 where id=:session and store_id=:store and status in ('REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED')")
      .param("from", previous.technicianId()).param("to", input.technicianId()).param("deadline", deadline).param("session", sessionId).param("store", storeId).update();
    events.record(storeId, sessionId, replacementId, "REASSIGNED", previous.technicianId(), input.technicianId(), deadline,
      input.reason().trim(), actor.userId(), actor.displayName());
    ReassignmentResult result = new ReassignmentResult(sessionId, replacementId, previous.slotNo(), input.technicianId(), deadline, "PENDING_ACCEPTANCE");
    audits.record(authorization, storeId, "SERVICE", "SERVICE_TECHNICIAN_REASSIGNED", "service_session", sessionId,
      input.reason().trim(), previous, result);
    return result;
  }

  @PostMapping("/cancel-dispatch")
  @Transactional
  DispatchCancellationResult cancelDispatch(@PathVariable UUID sessionId, @Valid @RequestBody CancelDispatchInput input,
                                             @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                             @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    SessionRow session = ensureSession(storeId, sessionId, true);
    if (!ServiceDispatchLifecycle.canCancelDispatch(session.status())) throw conflict("Service dispatch cannot be cancelled in its current state");
    String reason = input.reason().trim();
    jdbc.sql("update service_session_participant set status='CANCELLED',acceptance_deadline_at=null,change_reason=:reason where service_session_id=:session and store_id=:store and status in ('PENDING_ACCEPTANCE','ACCEPTED')")
      .param("reason", reason).param("session", sessionId).param("store", storeId).update();
    int updated = jdbc.sql("update service_session set status='DISPATCH_CANCELLED',acceptance_deadline_at=null,updated_at=now(),version=version+1 where id=:session and store_id=:store and status='REASSIGNMENT_REQUIRED'")
      .param("session", sessionId).param("store", storeId).update();
    if (updated == 0) throw conflict("Service dispatch state has changed");
    events.record(storeId, sessionId, null, "DISPATCH_CANCELLED", null, null, null, reason,
      actor.userId(), actor.displayName());
    DispatchCancellationResult result = new DispatchCancellationResult(sessionId, "DISPATCH_CANCELLED", reason);
    audits.record(authorization, storeId, "SERVICE", "SERVICE_DISPATCH_CANCELLED", "service_session", sessionId,
      reason, session, result);
    return result;
  }

  private SessionRow ensureSession(UUID storeId, UUID sessionId, boolean lock) {
    return jdbc.sql("select id,status from service_session where id=:id and store_id=:store" + (lock ? " for update" : ""))
      .param("id", sessionId).param("store", storeId).query(SessionRow.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service session not found"));
  }
  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }

  record SessionRow(UUID id, String status) {}
  record ParticipantRow(UUID id, UUID technicianId, Short slotNo, Short sequenceNo, Integer allocationBp, String status) {}
  record ReassignInput(@NotNull Short slotNo, @NotNull UUID technicianId, @NotBlank @Size(max = 240) String reason) {}
  record CancelDispatchInput(@NotBlank @Size(max = 240) String reason) {}
  record ReassignmentResult(UUID sessionId, UUID participantId, Short slotNo, UUID technicianId, OffsetDateTime acceptanceDeadlineAt, String status) {}
  record DispatchCancellationResult(UUID sessionId, String status, String reason) {}
  record DispatchEvent(UUID id, UUID participantId, String eventType, UUID fromTechnicianId, UUID toTechnicianId,
                       OffsetDateTime acceptanceDeadlineAt, String reason, String actorNameSnapshot, OffsetDateTime occurredAt) {}
}
