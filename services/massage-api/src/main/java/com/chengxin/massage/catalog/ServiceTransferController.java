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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/service-transfer-requests")
@CrossOrigin(origins = "*")
public class ServiceTransferController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final TechnicianSchedulePolicy schedulePolicy;
  private final ServiceDispatchEventService events;
  private final AuditService audits;

  @Value("${massage.dispatch.acceptance-timeout-seconds:300}")
  private int acceptanceTimeoutSeconds;

  ServiceTransferController(JdbcClient jdbc, StoreContextService storeContext, AdminSessionService adminSessions,
                            TechnicianSchedulePolicy schedulePolicy, ServiceDispatchEventService events, AuditService audits) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.schedulePolicy = schedulePolicy;
    this.events = events;
    this.audits = audits;
  }

  @GetMapping
  List<TransferRequestView> list(@RequestParam(defaultValue = "REQUESTED") String status,
                                 @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                 @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    if (!List.of("REQUESTED", "APPROVED", "REJECTED", "ALL").contains(status)) throw bad("Unsupported transfer status");
    return jdbc.sql("select request.id,request.service_session_id,request.from_participant_id,request.from_technician_id,request.to_technician_id,request.reason,request.status,request.review_note,request.requested_at,request.reviewed_at,ss.service_name_snapshot,r.code room_code,from_technician.name from_technician_name,to_technician.name to_technician_name from service_transfer_request request join service_session ss on ss.id=request.service_session_id join room r on r.id=ss.room_id join technician from_technician on from_technician.id=request.from_technician_id join technician to_technician on to_technician.id=request.to_technician_id where request.store_id=:store and (:status='ALL' or request.status=:status) order by request.requested_at desc limit 100")
      .param("store", storeId).param("status", status).query(TransferRequestView.class).list();
  }

  @PostMapping("/{requestId}/approve")
  @Transactional
  TransferReviewResult approve(@PathVariable UUID requestId, @Valid @RequestBody TransferReviewInput input,
                               @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                               @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    TransferSource request = lockRequest(storeId, requestId);
    if (!"REQUESTED".equals(request.status())) throw conflict("该转单申请已经处理");
    ParticipantRow previous = jdbc.sql("select id,technician_id,slot_no,sequence_no,allocation_bp,status from service_session_participant where id=:id and service_session_id=:session for update")
      .param("id", request.fromParticipantId()).param("session", request.serviceSessionId()).query(ParticipantRow.class).single();
    if (!List.of("PENDING_ACCEPTANCE", "ACCEPTED").contains(previous.status())) throw conflict("原技师已经开始或结束服务");
    boolean available = jdbc.sql("select exists(select 1 from technician target where target.id=:target and target.store_id=:store and target.active=true and target.queue_enabled=true and not exists(select 1 from service_session_participant busy where busy.store_id=:store and busy.technician_id=target.id and busy.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')))")
      .param("target", request.toTechnicianId()).param("store", storeId).query(Boolean.class).single();
    if (!available) throw conflict("目标技师当前已经被其他服务占用");
    schedulePolicy.requireClockInEligibility(storeId, request.toTechnicianId());
    jdbc.sql("update service_session_participant set status='REJECTED',declined_at=now(),decline_reason=:reason where id=:id and status in ('PENDING_ACCEPTANCE','ACCEPTED')")
      .param("id", previous.id()).param("reason", "前台同意转单：" + request.reason()).update();
    short nextSequence = jdbc.sql("select (coalesce(max(sequence_no),0)+1)::smallint from service_session_participant where service_session_id=:session and slot_no=:slot")
      .param("session", request.serviceSessionId()).param("slot", previous.slotNo()).query(Short.class).single();
    OffsetDateTime deadline = OffsetDateTime.now().plusSeconds(acceptanceTimeoutSeconds);
    UUID replacementId = UUID.randomUUID();
    jdbc.sql("insert into service_session_participant(id,tenant_id,store_id,service_session_id,technician_id,slot_no,sequence_no,participation_type,allocation_bp,status,replaced_participant_id,change_reason,acceptance_deadline_at) values(:id,:tenant,:store,:session,:technician,:slot,:sequence,'REPLACEMENT',:allocation,'PENDING_ACCEPTANCE',:replaced,:reason,:deadline)")
      .param("id", replacementId).param("tenant", TENANT_ID).param("store", storeId).param("session", request.serviceSessionId()).param("technician", request.toTechnicianId()).param("slot", previous.slotNo()).param("sequence", nextSequence).param("allocation", previous.allocationBp()).param("replaced", previous.id()).param("reason", request.reason()).param("deadline", deadline).update();
    jdbc.sql("update service_session set status='PENDING_ACCEPTANCE',technician_id=:technician,acceptance_deadline_at=:deadline,updated_at=now(),version=version+1 where id=:session and store_id=:store")
      .param("technician", request.toTechnicianId()).param("deadline", deadline).param("session", request.serviceSessionId()).param("store", storeId).update();
    String note = input.note() == null ? "" : input.note().trim();
    jdbc.sql("update service_transfer_request set status='APPROVED',review_note=:note,reviewed_at=now(),reviewed_by_user_id=:actor,reviewed_by_name_snapshot=:actorName where id=:id")
      .param("note", note.isBlank() ? null : note).param("actor", actor.userId()).param("actorName", actor.displayName()).param("id", requestId).update();
    events.record(storeId, request.serviceSessionId(), replacementId, "TRANSFER_APPROVED", request.fromTechnicianId(), request.toTechnicianId(), deadline, note, actor.userId(), actor.displayName());
    audits.record(authorization, storeId, "SERVICE", "SERVICE_TRANSFER_APPROVED", "service_transfer_request", requestId, note, request, replacementId);
    return new TransferReviewResult(requestId, request.serviceSessionId(), "APPROVED", request.toTechnicianId());
  }

  @PostMapping("/{requestId}/reject")
  @Transactional
  TransferReviewResult reject(@PathVariable UUID requestId, @Valid @RequestBody TransferReviewInput input,
                              @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                              @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    TransferSource request = lockRequest(storeId, requestId);
    if (!"REQUESTED".equals(request.status())) throw conflict("该转单申请已经处理");
    String note = input.note() == null ? "" : input.note().trim();
    if (note.isBlank()) throw bad("驳回转单必须填写说明");
    jdbc.sql("update service_transfer_request set status='REJECTED',review_note=:note,reviewed_at=now(),reviewed_by_user_id=:actor,reviewed_by_name_snapshot=:actorName where id=:id")
      .param("note", note).param("actor", actor.userId()).param("actorName", actor.displayName()).param("id", requestId).update();
    events.record(storeId, request.serviceSessionId(), request.fromParticipantId(), "TRANSFER_REJECTED", request.toTechnicianId(), request.fromTechnicianId(), null, note, actor.userId(), actor.displayName());
    audits.record(authorization, storeId, "SERVICE", "SERVICE_TRANSFER_REJECTED", "service_transfer_request", requestId, note, request, null);
    return new TransferReviewResult(requestId, request.serviceSessionId(), "REJECTED", request.toTechnicianId());
  }

  private TransferSource lockRequest(UUID storeId, UUID requestId) {
    return jdbc.sql("select id,service_session_id,from_participant_id,from_technician_id,to_technician_id,status,reason from service_transfer_request where id=:id and store_id=:store for update")
      .param("id", requestId).param("store", storeId).query(TransferSource.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Transfer request not found"));
  }

  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }

  record TransferRequestView(UUID id, UUID serviceSessionId, UUID fromParticipantId, UUID fromTechnicianId, UUID toTechnicianId, String reason, String status, String reviewNote, OffsetDateTime requestedAt, OffsetDateTime reviewedAt, String serviceNameSnapshot, String roomCode, String fromTechnicianName, String toTechnicianName) {}
  record TransferSource(UUID id, UUID serviceSessionId, UUID fromParticipantId, UUID fromTechnicianId, UUID toTechnicianId, String status, String reason) {}
  record ParticipantRow(UUID id, UUID technicianId, Short slotNo, Short sequenceNo, Integer allocationBp, String status) {}
  record TransferReviewInput(@Size(max = 240) String note) {}
  record TransferReviewResult(UUID requestId, UUID serviceSessionId, String status, UUID toTechnicianId) {}
}
