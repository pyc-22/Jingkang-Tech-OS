package com.chengxin.massage.catalog;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.catalog.ServiceItemVersionService.ResolvedServiceItem;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Front-desk entry point for the same extension records used by technician mobile. */
@RestController
@RequestMapping("/api/v1/service-sessions")
@CrossOrigin(origins = "*")
public class ServiceSessionExtensionController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final ServiceItemVersionService itemVersions;
  private final ServiceDurationPolicyService durationPolicies;
  private final AuditService audits;

  ServiceSessionExtensionController(JdbcClient jdbc, StoreContextService storeContext,
      AdminSessionService adminSessions, ServiceItemVersionService itemVersions,
      ServiceDurationPolicyService durationPolicies, AuditService audits) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.itemVersions = itemVersions;
    this.durationPolicies = durationPolicies;
    this.audits = audits;
  }

  @PostMapping("/{sessionId}/extensions")
  @Transactional
  ExtensionResponse add(@PathVariable UUID sessionId, @Valid @RequestBody ExtensionInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    ServiceDurationPolicyService.SessionState locked = durationPolicies.lockSession(storeId, sessionId);
    if (!"IN_SERVICE".equals(locked.status())) throw error(HttpStatus.CONFLICT, "Only an in-service session can add an extension");
    LocalDate businessDate = jdbc.sql("select business_date from service_session where id=:id and store_id=:store")
      .param("id", sessionId).param("store", storeId).query(LocalDate.class).single();
    boolean participating = jdbc.sql("select exists(select 1 from service_session_participant where service_session_id=:session and store_id=:store and technician_id=:technician and status='IN_SERVICE')")
      .param("session", sessionId).param("store", storeId).param("technician", input.technicianId()).query(Boolean.class).single();
    if (!participating) throw error(HttpStatus.BAD_REQUEST, "Technician is not serving this session");
    ResolvedServiceItem service = itemVersions.activeItem(storeId, input.serviceItemId(), businessDate)
      .filter(ResolvedServiceItem::allowsExtension)
      .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "Service item is unavailable for extension"));
    int currentExtensionMinutes = durationPolicies.extensionMinutes(storeId, sessionId);
    int totalDuration = locked.plannedDurationMinutes() + service.defaultDurationMinutes();
    durationPolicies.requireExtensionWithinLimit(durationPolicies.policy(storeId), currentExtensionMinutes,
      service.defaultDurationMinutes(), totalDuration);
    OffsetDateTime expectedEndAt = locked.expectedEndAt().plusMinutes(service.defaultDurationMinutes());
    int updated = jdbc.sql("update service_session set planned_duration_minutes=:duration,expected_end_at=:expected,updated_at=now(),version=version+1 where id=:id and store_id=:store and status='IN_SERVICE' and version=:version")
      .param("duration", totalDuration).param("expected", expectedEndAt).param("id", sessionId).param("store", storeId)
      .param("version", locked.version()).update();
    if (updated == 0) throw error(HttpStatus.CONFLICT, "Service state has changed; refresh and retry");
    UUID extensionId = UUID.randomUUID();
    UUID commissionVersionId = itemVersions.commissionRule(storeId, service.id(), businessDate).id();
    jdbc.sql("insert into service_session_extension(id,tenant_id,store_id,service_session_id,technician_id,service_item_id,service_name_snapshot,service_price_cents,planned_duration_minutes,price_version_id,commission_rule_version_id,counts_as_clock_snapshot) values(:id,:tenant,:store,:session,:technician,:service,:name,:price,:duration,:priceVersion,:commissionVersion,:countsAsClock)")
      .param("id", extensionId).param("tenant", TENANT_ID).param("store", storeId).param("session", sessionId)
      .param("technician", input.technicianId()).param("service", service.id()).param("name", service.name())
      .param("price", service.priceCents()).param("duration", service.defaultDurationMinutes()).param("priceVersion", service.priceVersionId())
      .param("commissionVersion", commissionVersionId).param("countsAsClock", service.countsAsClock()).update();
    durationPolicies.recordChange(TENANT_ID, storeId, sessionId, input.technicianId(), extensionId, actor.userId(), actor.displayName(),
      "MANAGER_OVERRIDE", locked.plannedDurationMinutes(), totalDuration, locked.expectedEndAt(), expectedEndAt,
      "Front desk added extension: " + service.name());
    ExtensionResponse result = new ExtensionResponse(extensionId, sessionId, input.technicianId(), service.id(), service.name(),
      service.priceCents(), service.defaultDurationMinutes(), totalDuration, expectedEndAt, actor.displayName(), OffsetDateTime.now());
    audits.record(authorization, storeId, "SERVICE", "FRONTDESK_SERVICE_EXTENDED", "service_session", sessionId,
      "Front desk added service extension", locked, result);
    return result;
  }

  private ResponseStatusException error(HttpStatus status, String message) { return new ResponseStatusException(status, message); }

  record ExtensionInput(@NotNull UUID technicianId, @NotNull UUID serviceItemId) {}
  record ExtensionResponse(UUID id, UUID serviceSessionId, UUID technicianId, UUID serviceItemId,
      String serviceName, Integer priceCents, Short addedDurationMinutes, Integer totalDurationMinutes,
      OffsetDateTime expectedEndAt, String actorName, OffsetDateTime addedAt) {}
}
