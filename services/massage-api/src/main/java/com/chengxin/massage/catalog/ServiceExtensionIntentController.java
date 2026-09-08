package com.chengxin.massage.catalog;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.mobile.MobileSessionService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
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

@RestController
@RequestMapping("/api/v1/service-extension-intents")
@CrossOrigin(origins = "*")
public class ServiceExtensionIntentController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final MobileSessionService mobileSessions;
  private final AuditService audits;

  ServiceExtensionIntentController(JdbcClient jdbc, StoreContextService storeContext,
      AdminSessionService adminSessions, MobileSessionService mobileSessions, AuditService audits) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.mobileSessions = mobileSessions;
    this.audits = audits;
  }

  @PostMapping
  @Transactional
  IntentResponse create(@Valid @RequestBody CreateIntentInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    var technician = mobileSessions.requireUserId(authorization);
    TechnicianSnapshot current = jdbc.sql("select t.id,t.store_id,t.name,t.active from technician_account_binding b join technician t on t.id=b.technician_id and t.store_id=b.store_id where b.user_id=:user and b.active=true")
      .param("user", technician).query(TechnicianSnapshot.class).optional()
      .orElseThrow(() -> error(HttpStatus.UNAUTHORIZED, "Technician account is not active"));
    ServiceSnapshot session = jdbc.sql("select ss.id,ss.technician_id,ss.room_id,ss.service_name_snapshot service_name,ss.status,r.code room_code,coalesce(m.name,so_member.name) member_name,coalesce(m.id,so_member.id) member_id,t.name technician_name from service_session ss join room r on r.id=ss.room_id join technician t on t.id=ss.technician_id left join sales_order_service_session link on link.service_session_id=ss.id left join sales_order so on so.id=link.order_id left join member m on m.id=so.member_id left join member so_member on so_member.id=so.member_id where ss.id=:session and ss.store_id=:store and ss.technician_id=:technician and ss.status='IN_SERVICE' for update of ss")
      .param("session", input.serviceSessionId()).param("store", current.storeId()).param("technician", current.id()).query(ServiceSnapshot.class).optional()
      .orElseThrow(() -> error(HttpStatus.CONFLICT, "当前没有可提交意向加钟的服务"));
    boolean duplicate = jdbc.sql("select exists(select 1 from service_extension_intent where store_id=:store and service_session_id=:session and status='PENDING')")
      .param("store", current.storeId()).param("session", session.id()).query(Boolean.class).single();
    if (duplicate) throw error(HttpStatus.CONFLICT, "该服务已有待处理的意向加钟");
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into service_extension_intent(id,tenant_id,store_id,service_session_id,technician_id,room_id,member_id,technician_name_snapshot,room_code_snapshot,member_name_snapshot,service_name_snapshot,technician_note) values(:id,:tenant,:store,:session,:technician,:room,:member,:technicianName,:roomCode,:memberName,:serviceName,:note)")
      .param("id", id).param("tenant", TENANT_ID).param("store", current.storeId()).param("session", session.id()).param("technician", current.id())
      .param("room", session.roomId()).param("member", session.memberId()).param("technicianName", session.technicianName()).param("roomCode", session.roomCode())
      .param("memberName", session.memberName()).param("serviceName", session.serviceName()).param("note", trim(input.technicianNote())).update();
    IntentResponse result = intent(current.storeId(), id);
    audits.record(authorization, current.storeId(), "SERVICE", "SERVICE_EXTENSION_INTENT_CREATED", "service_extension_intent", id, "技师提交意向加钟提醒", null, result);
    return result;
  }

  @GetMapping
  List<IntentResponse> list(@RequestParam(required = false) String status,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    String where = "where i.store_id=:store" + (status == null || status.isBlank() ? "" : " and i.status=:status");
    JdbcClient.StatementSpec statement = jdbc.sql(intentSql(where)).param("store", storeId);
    if (status != null && !status.isBlank()) statement = statement.param("status", status);
    return statement.query(IntentResponse.class).list();
  }

  @GetMapping("/mine")
  List<IntentResponse> mine(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    UUID userId = mobileSessions.requireUserId(authorization);
    TechnicianSnapshot technician = jdbc.sql("select t.id,t.store_id,t.name,t.active from technician_account_binding b join technician t on t.id=b.technician_id and t.store_id=b.store_id where b.user_id=:user and b.active=true")
      .param("user", userId).query(TechnicianSnapshot.class).optional().orElseThrow(() -> error(HttpStatus.UNAUTHORIZED, "Technician account is not active"));
    return jdbc.sql(intentSql("where i.store_id=:store and i.technician_id=:technician")).param("store", technician.storeId()).param("technician", technician.id()).query(IntentResponse.class).list();
  }

  @PutMapping("/{id}/contacted")
  @Transactional
  IntentResponse contacted(@PathVariable UUID id, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    return handle(id, "CONTACTED", null, authorization, requestedStoreId);
  }

  @PutMapping("/{id}/reject")
  @Transactional
  IntentResponse reject(@PathVariable UUID id, @Valid @RequestBody RejectIntentInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    return handle(id, "REJECTED", trim(input.reason()), authorization, requestedStoreId);
  }

  private IntentResponse handle(UUID id, String targetStatus, String reason, String authorization, String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    IntentResponse current = intent(storeId, id);
    if (!"PENDING".equals(current.status())) throw error(HttpStatus.CONFLICT, "该意向已经处理");
    jdbc.sql("update service_extension_intent set status=:status,rejection_reason=:reason,handled_at=now(),handled_by_user_id=:actor,handled_by_name_snapshot=:actorName,version=version+1 where id=:id and store_id=:store and status='PENDING'")
      .param("status", targetStatus).param("reason", reason).param("actor", actor.userId()).param("actorName", actor.displayName()).param("id", id).param("store", storeId).update();
    IntentResponse updated = intent(storeId, id);
    audits.record(authorization, storeId, "SERVICE", "SERVICE_EXTENSION_INTENT_" + targetStatus, "service_extension_intent", id, "前台处理意向加钟提醒", current, updated);
    return updated;
  }

  private IntentResponse intent(UUID storeId, UUID id) {
    return jdbc.sql(intentSql("where i.store_id=:store and i.id=:id")).param("store", storeId).param("id", id).query(IntentResponse.class).optional().orElseThrow(() -> error(HttpStatus.NOT_FOUND, "意向加钟记录不存在"));
  }

  private String intentSql(String where) {
    return "select i.id,i.service_session_id,i.technician_id,i.technician_name_snapshot technician_name,i.room_id,i.room_code_snapshot room_code,i.member_id,i.member_name_snapshot member_name,i.service_name_snapshot service_name,i.technician_note,i.status,i.rejection_reason,i.created_at,i.handled_at,i.handled_by_name_snapshot handled_by,exists(select 1 from service_reservation sr where sr.store_id=i.store_id and sr.technician_id=i.technician_id and sr.status='WAITING') or exists(select 1 from service_session_participant p join service_session s2 on s2.id=p.service_session_id where p.store_id=i.store_id and p.technician_id=i.technician_id and p.service_session_id<>i.service_session_id and p.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')) has_upcoming_assignment from service_extension_intent i " + where + " order by i.created_at desc";
  }

  private static String trim(String value) { return value == null || value.isBlank() ? null : value.trim(); }
  private ResponseStatusException error(HttpStatus status, String message) { return new ResponseStatusException(status, message); }

  record TechnicianSnapshot(UUID id, UUID storeId, String name, Boolean active) {}
  record ServiceSnapshot(UUID id, UUID technicianId, UUID roomId, String serviceName, String status, String roomCode, String memberName, UUID memberId, String technicianName) {}
  record CreateIntentInput(@NotNull UUID serviceSessionId, @Size(max = 240) String technicianNote) {}
  record RejectIntentInput(@Size(max = 240) String reason) {}
  record IntentResponse(UUID id, UUID serviceSessionId, UUID technicianId, String technicianName, UUID roomId, String roomCode, UUID memberId, String memberName, String serviceName, String technicianNote, String status, String rejectionReason, OffsetDateTime createdAt, OffsetDateTime handledAt, String handledBy, Boolean hasUpcomingAssignment) {}
}
