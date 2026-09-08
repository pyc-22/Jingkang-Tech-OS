package com.chengxin.massage.catalog;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
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
@RequestMapping("/api/v1/service-sessions")
@CrossOrigin(origins = "*")
public class ServiceSessionExtensionCancellationController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final ServiceDurationPolicyService durationPolicies;
  private final AuditService audits;

  ServiceSessionExtensionCancellationController(JdbcClient jdbc, StoreContextService storeContext,
      AdminSessionService adminSessions, ServiceDurationPolicyService durationPolicies, AuditService audits) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.durationPolicies = durationPolicies;
    this.audits = audits;
  }

  @GetMapping("/{sessionId}/extensions")
  List<Extension> extensions(@PathVariable UUID sessionId,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    durationPolicies.lockSession(storeId, sessionId);
    return jdbc.sql("select id,service_session_id,technician_id,service_item_id,service_name_snapshot,service_price_cents,planned_duration_minutes,added_at from service_session_extension where store_id=:store and service_session_id=:session order by added_at desc,id desc")
      .param("store", storeId).param("session", sessionId).query(Extension.class).list();
  }

  @PostMapping("/{sessionId}/extensions/{extensionId}/cancel")
  @Transactional
  CancelResponse cancel(@PathVariable UUID sessionId, @PathVariable UUID extensionId, @Valid @RequestBody CancelInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    ServiceDurationPolicyService.SessionState locked = durationPolicies.lockSession(storeId, sessionId);
    if (!"IN_SERVICE".equals(locked.status())) throw error(HttpStatus.CONFLICT, "Only an in-service session can cancel an extension");
    boolean settled = jdbc.sql("select exists(select 1 from sales_order_service_session where service_session_id=:session)")
      .param("session", sessionId).query(Boolean.class).single();
    if (settled) throw error(HttpStatus.CONFLICT, "Settled services cannot cancel an extension");
    ExtensionDetails extension = jdbc.sql("select id,service_session_id,technician_id,service_item_id,service_name_snapshot,service_price_cents,planned_duration_minutes,price_version_id,commission_rule_version_id,counts_as_clock_snapshot from service_session_extension where id=:id and store_id=:store and service_session_id=:session for update")
      .param("id", extensionId).param("store", storeId).param("session", sessionId).query(ExtensionDetails.class).optional()
      .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Extension not found or already cancelled"));
    int newDuration = locked.plannedDurationMinutes() - extension.plannedDurationMinutes();
    if (newDuration < 15) throw error(HttpStatus.BAD_REQUEST, "The service must retain at least 15 minutes");
    OffsetDateTime newExpectedEnd = locked.expectedEndAt().minusMinutes(extension.plannedDurationMinutes());
    if (!newExpectedEnd.isAfter(OffsetDateTime.now())) throw error(HttpStatus.CONFLICT, "The remaining service time has expired");
    int updated = jdbc.sql("update service_session set planned_duration_minutes=:duration,expected_end_at=:expected,updated_at=now(),version=version+1 where id=:id and store_id=:store and status='IN_SERVICE' and version=:version")
      .param("duration", newDuration).param("expected", newExpectedEnd).param("id", sessionId).param("store", storeId).param("version", locked.version()).update();
    if (updated == 0) throw error(HttpStatus.CONFLICT, "Service state has changed; refresh and retry");
    jdbc.sql("insert into service_session_extension_cancel_log(id,tenant_id,store_id,service_session_id,extension_id,technician_id,service_item_id,service_name_snapshot,service_price_cents,planned_duration_minutes,price_version_id,commission_rule_version_id,counts_as_clock_snapshot,actor_user_id,actor_name_snapshot,reason) values(:id,:tenant,:store,:session,:extension,:technician,:service,:name,:price,:duration,:priceVersion,:commissionVersion,:countsAsClock,:actor,:actorName,:reason)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("session", sessionId).param("extension", extension.id())
      .param("technician", extension.technicianId()).param("service", extension.serviceItemId()).param("name", extension.serviceNameSnapshot())
      .param("price", extension.servicePriceCents()).param("duration", extension.plannedDurationMinutes()).param("priceVersion", extension.priceVersionId())
      .param("commissionVersion", extension.commissionRuleVersionId()).param("countsAsClock", extension.countsAsClockSnapshot())
      .param("actor", actor.userId()).param("actorName", actor.displayName()).param("reason", input.reason().trim()).update();
    jdbc.sql("delete from service_session_extension where id=:id and store_id=:store").param("id", extensionId).param("store", storeId).update();
    durationPolicies.recordChange(TENANT_ID, storeId, sessionId, extension.technicianId(), null, actor.userId(), actor.displayName(),
      "MANAGER_OVERRIDE", locked.plannedDurationMinutes(), newDuration, locked.expectedEndAt(), newExpectedEnd,
      "Extension cancelled: " + extension.serviceNameSnapshot() + ". " + input.reason().trim());
    CancelResponse result = new CancelResponse(extensionId, sessionId, extension.serviceNameSnapshot(), extension.servicePriceCents(),
      extension.plannedDurationMinutes(), newDuration, newExpectedEnd, input.reason().trim(), actor.displayName(), OffsetDateTime.now());
    audits.record(authorization, storeId, "SERVICE", "SERVICE_EXTENSION_CANCELLED", "service_session", sessionId, input.reason().trim(), locked, result);
    return result;
  }

  private ResponseStatusException error(HttpStatus status, String message) { return new ResponseStatusException(status, message); }

  record Extension(UUID id, UUID serviceSessionId, UUID technicianId, UUID serviceItemId, String serviceNameSnapshot,
      Integer servicePriceCents, Short plannedDurationMinutes, OffsetDateTime addedAt) {}
  record ExtensionDetails(UUID id, UUID serviceSessionId, UUID technicianId, UUID serviceItemId, String serviceNameSnapshot,
      Integer servicePriceCents, Short plannedDurationMinutes, UUID priceVersionId, UUID commissionRuleVersionId,
      Boolean countsAsClockSnapshot) {}
  record CancelInput(@NotBlank @Size(max = 240) String reason) {}
  record CancelResponse(UUID extensionId, UUID serviceSessionId, String serviceName, Integer priceCents,
      Short cancelledDurationMinutes, Integer remainingDurationMinutes, OffsetDateTime expectedEndAt,
      String reason, String actorName, OffsetDateTime cancelledAt) {}
}
