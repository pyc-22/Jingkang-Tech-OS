package com.chengxin.massage.catalog;

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
@RequestMapping("/api/v1/service-sessions/{sessionId}/participants")
@CrossOrigin(origins = "*")
public class ServiceParticipantController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final TechnicianSchedulePolicy schedulePolicy;
  private final AuditService audits;

  ServiceParticipantController(JdbcClient jdbc, StoreContextService storeContext, TechnicianSchedulePolicy schedulePolicy, AuditService audits) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.schedulePolicy = schedulePolicy;
    this.audits = audits;
  }

  @GetMapping
  List<ParticipantView> participants(@PathVariable UUID sessionId,
                                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    ensureSession(storeId, sessionId, false);
    return participantViews(storeId, sessionId);
  }

  @PostMapping("/transfer")
  @Transactional
  List<ParticipantView> transfer(@PathVariable UUID sessionId, @Valid @RequestBody TransferInput input,
                                 @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                 @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    if (input.fromTechnicianId().equals(input.toTechnicianId())) throw bad("Replacement technician must be different");
    SessionRow session = ensureSession(storeId, sessionId, true);
    if (!"IN_SERVICE".equals(session.status())) throw conflict("Technicians can only be replaced during an active service");
    // Lock the replacement technician row before checking occupancy.  This
    // serializes concurrent replacements targeting the same technician and
    // avoids both requests passing the availability check before either
    // inserts the new participant.
    jdbc.sql("select id from technician where id=:technician and store_id=:store and active=true and queue_enabled=true for update")
      .param("technician", input.toTechnicianId()).param("store", storeId).query(UUID.class).optional()
      .orElseThrow(() -> bad("Replacement technician is unavailable"));
    schedulePolicy.requireClockInEligibility(storeId, input.toTechnicianId());
    boolean targetBusy = jdbc.sql("select exists(select 1 from service_session_participant where store_id=:store and technician_id=:technician and status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE'))")
      .param("store", storeId).param("technician", input.toTechnicianId()).query(Boolean.class).single();
    if (targetBusy) throw conflict("Replacement technician already has a pending or active service");

    ParticipantRow current = jdbc.sql("select id,slot_no,sequence_no,allocation_bp,service_started_at from service_session_participant where service_session_id=:session and store_id=:store and technician_id=:technician and status='IN_SERVICE' for update")
      .param("session", sessionId).param("store", storeId).param("technician", input.fromTechnicianId()).query(ParticipantRow.class).optional()
      .orElseThrow(() -> conflict("The original technician is no longer serving this session"));
    List<UUID> activeSlotParticipants = jdbc.sql("select id from service_session_participant where service_session_id=:session and store_id=:store and slot_no=:slot and status='IN_SERVICE' for update")
      .param("session", sessionId).param("store", storeId).param("slot", current.slotNo()).query(UUID.class).list();
    if (activeSlotParticipants.size() != 1 || !activeSlotParticipants.getFirst().equals(current.id())) {
      throw conflict("该服务技师位状态异常，请刷新后重试");
    }
    List<ParticipantView> before = participantViews(storeId, sessionId);
    OffsetDateTime changedAt = OffsetDateTime.now();
    jdbc.sql("update service_session_participant set status='COMPLETED',service_ended_at=:ended,change_reason=:reason where id=:id and status='IN_SERVICE'")
      .param("ended", changedAt).param("reason", input.reason().trim()).param("id", current.id()).update();
    short nextSequence = jdbc.sql("select (coalesce(max(sequence_no),0)+1)::smallint from service_session_participant where service_session_id=:session and slot_no=:slot")
      .param("session", sessionId).param("slot", current.slotNo()).query(Short.class).single();
    UUID participantId = UUID.randomUUID();
    jdbc.sql("insert into service_session_participant(id,tenant_id,store_id,service_session_id,technician_id,slot_no,sequence_no,participation_type,allocation_bp,status,joined_at,accepted_at,service_started_at,replaced_participant_id,change_reason) values(:id,:tenant,:store,:session,:technician,:slot,:sequence,'REPLACEMENT',:allocation,'IN_SERVICE',:changed,:changed,:changed,:replaced,:reason)")
      .param("id", participantId).param("tenant", TENANT_ID).param("store", storeId).param("session", sessionId).param("technician", input.toTechnicianId())
      .param("slot", current.slotNo()).param("sequence", nextSequence).param("allocation", current.allocationBp()).param("changed", changedAt)
      .param("replaced", current.id()).param("reason", input.reason().trim()).update();
    long activeSlotCount = jdbc.sql("select count(*) from service_session_participant where service_session_id=:session and store_id=:store and slot_no=:slot and status='IN_SERVICE'")
      .param("session", sessionId).param("store", storeId).param("slot", current.slotNo()).query(Long.class).single();
    if (activeSlotCount != 1) throw conflict("更换技师后服务技师位状态异常，操作已回滚");
    if (session.technicianId().equals(input.fromTechnicianId())) {
      jdbc.sql("update service_session set technician_id=:technician,updated_at=now(),version=version+1 where id=:session and store_id=:store")
        .param("technician", input.toTechnicianId()).param("session", sessionId).param("store", storeId).update();
    }
    List<ParticipantView> after = participantViews(storeId, sessionId);
    audits.record(authorization, storeId, "SERVICE", "SERVICE_TECHNICIAN_REPLACED", "service_session", sessionId,
      input.reason().trim(), before, after);
    return after;
  }

  private SessionRow ensureSession(UUID storeId, UUID sessionId, boolean lock) {
    String suffix = lock ? " for update" : "";
    return jdbc.sql("select id,technician_id,status from service_session where id=:session and store_id=:store" + suffix)
      .param("session", sessionId).param("store", storeId).query(SessionRow.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service session not found"));
  }

  private List<ParticipantView> participantViews(UUID storeId, UUID sessionId) {
    return jdbc.sql("select participant.id,participant.technician_id,technician.code technician_code,technician.name technician_name,participant.slot_no,participant.sequence_no,participant.participation_type,participant.allocation_bp,participant.status,participant.accepted_at,participant.service_started_at,participant.service_ended_at,participant.change_reason,participant.replaced_participant_id from service_session_participant participant join technician technician on technician.id=participant.technician_id where participant.service_session_id=:session and participant.store_id=:store order by participant.slot_no,participant.sequence_no")
      .param("session", sessionId).param("store", storeId).query(ParticipantView.class).list();
  }

  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }

  record SessionRow(UUID id, UUID technicianId, String status) {}
  record ParticipantRow(UUID id, Short slotNo, Short sequenceNo, Integer allocationBp, OffsetDateTime serviceStartedAt) {}
  record ParticipantView(UUID id, UUID technicianId, String technicianCode, String technicianName, Short slotNo, Short sequenceNo,
                         String participationType, Integer allocationBp, String status, OffsetDateTime acceptedAt,
                         OffsetDateTime serviceStartedAt, OffsetDateTime serviceEndedAt, String changeReason, UUID replacedParticipantId) {}
  record TransferInput(@NotNull UUID fromTechnicianId, @NotNull UUID toTechnicianId, @NotBlank @Size(max = 240) String reason) {}
}
