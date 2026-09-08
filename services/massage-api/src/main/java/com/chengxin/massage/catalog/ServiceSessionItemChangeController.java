package com.chengxin.massage.catalog;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.catalog.ServiceItemVersionService.CommissionRuleVersion;
import com.chengxin.massage.catalog.ServiceItemVersionService.ResolvedServiceItem;
import com.chengxin.massage.operations.BusinessClockService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Changes the main project snapshot of an active service without touching extensions. */
@RestController
@RequestMapping("/api/v1/service-sessions")
@CrossOrigin(origins = "*")
public class ServiceSessionItemChangeController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final ServiceItemVersionService itemVersions;
  private final ServiceDurationPolicyService policies;
  private final BusinessClockService businessClock;
  private final AuditService audits;

  ServiceSessionItemChangeController(JdbcClient jdbc, StoreContextService storeContext,
      AdminSessionService adminSessions, ServiceItemVersionService itemVersions,
      ServiceDurationPolicyService policies, BusinessClockService businessClock, AuditService audits) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.itemVersions = itemVersions;
    this.policies = policies;
    this.businessClock = businessClock;
    this.audits = audits;
  }

  @PutMapping("/{sessionId}/service-item")
  @Transactional
  ChangeResponse change(@PathVariable UUID sessionId, @Valid @RequestBody ChangeInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    LockedSession current = jdbc.sql("select id,service_item_id,service_name_snapshot,service_price_cents,planned_duration_minutes,started_at,expected_end_at,price_version_id,commission_rule_version_id,counts_as_clock_snapshot,business_date,status,version from service_session where id=:id and store_id=:store for update")
      .param("id", sessionId).param("store", storeId).query(LockedSession.class).optional()
      .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Service session not found"));
    if (!"IN_SERVICE".equals(current.status())) throw error(HttpStatus.CONFLICT, "Only an in-service session can change project");
    if (current.serviceItemId().equals(input.serviceItemId())) throw error(HttpStatus.BAD_REQUEST, "New project must be different from current project");

    ResolvedServiceItem next = itemVersions.activeItem(storeId, input.serviceItemId(),
        current.businessDate() == null ? businessClock.currentBusinessDate(storeId) : current.businessDate())
      .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "Service item is unavailable"));
    CommissionRuleVersion commission = itemVersions.commissionRule(storeId, next.id(),
        current.businessDate() == null ? businessClock.currentBusinessDate(storeId) : current.businessDate());
    int extensionMinutes = jdbc.sql("select coalesce(sum(planned_duration_minutes),0)::integer from service_session_extension where store_id=:store and service_session_id=:session")
      .param("store", storeId).param("session", sessionId).query(Integer.class).single();
    int oldBaseDuration = current.plannedDurationMinutes() - extensionMinutes;
    if (oldBaseDuration < 1) throw error(HttpStatus.CONFLICT, "Current service duration is invalid");
    int newTotalDuration = next.defaultDurationMinutes() + extensionMinutes;
    policies.requireTotalWithinLimit(policies.policy(storeId), newTotalDuration);
    OffsetDateTime newExpectedEnd = current.startedAt().plusMinutes(newTotalDuration);
    if (!newExpectedEnd.isAfter(OffsetDateTime.now())) throw error(HttpStatus.BAD_REQUEST, "New project would already be expired");

    int updated = jdbc.sql("update service_session set service_item_id=:item,service_name_snapshot=:name,service_price_cents=:price,planned_duration_minutes=:duration,expected_end_at=:expected,price_version_id=:priceVersion,commission_rule_version_id=:commissionVersion,counts_as_clock_snapshot=:countsAsClock,updated_at=now(),version=version+1 where id=:id and store_id=:store and status='IN_SERVICE' and version=:version")
      .param("item", next.id()).param("name", next.name()).param("price", next.priceCents()).param("duration", newTotalDuration)
      .param("expected", newExpectedEnd).param("priceVersion", next.priceVersionId()).param("commissionVersion", commission.id())
      .param("countsAsClock", next.countsAsClock()).param("id", sessionId).param("store", storeId).param("version", current.version()).update();
    if (updated == 0) throw error(HttpStatus.CONFLICT, "Service state has changed; refresh and retry");
    UUID logId = UUID.randomUUID();
    jdbc.sql("insert into service_session_item_change_log(id,tenant_id,store_id,service_session_id,previous_service_item_id,previous_service_name_snapshot,previous_price_cents,previous_duration_minutes,previous_expected_end_at,new_service_item_id,new_service_name_snapshot,new_price_cents,new_duration_minutes,new_expected_end_at,previous_price_version_id,new_price_version_id,previous_commission_rule_version_id,new_commission_rule_version_id,actor_user_id,actor_name_snapshot,reason) values(:id,:tenant,:store,:session,:oldItem,:oldName,:oldPrice,:oldDuration,:oldExpected,:newItem,:newName,:newPrice,:newDuration,:newExpected,:oldPriceVersion,:newPriceVersion,:oldCommission,:newCommission,:actor,:actorName,:reason)")
      .param("id", logId).param("tenant", TENANT_ID).param("store", storeId).param("session", sessionId)
      .param("oldItem", current.serviceItemId()).param("oldName", current.serviceNameSnapshot()).param("oldPrice", current.servicePriceCents())
      .param("oldDuration", current.plannedDurationMinutes()).param("oldExpected", current.expectedEndAt()).param("newItem", next.id())
      .param("newName", next.name()).param("newPrice", next.priceCents()).param("newDuration", newTotalDuration).param("newExpected", newExpectedEnd)
      .param("oldPriceVersion", current.priceVersionId()).param("newPriceVersion", next.priceVersionId()).param("oldCommission", current.commissionRuleVersionId())
      .param("newCommission", commission.id()).param("actor", actor.userId()).param("actorName", actor.displayName()).param("reason", input.reason().trim()).update();
    ChangeResponse result = new ChangeResponse(sessionId, current.serviceItemId(), current.serviceNameSnapshot(), next.id(), next.name(),
      current.servicePriceCents(), next.priceCents(), current.plannedDurationMinutes(), newTotalDuration, current.expectedEndAt(), newExpectedEnd,
      extensionMinutes, input.reason().trim(), actor.displayName(), OffsetDateTime.now());
    audits.record(authorization, storeId, "SERVICE", "SERVICE_ITEM_CHANGED", "service_session", sessionId, input.reason().trim(), current, result);
    return result;
  }

  private ResponseStatusException error(HttpStatus status, String message) { return new ResponseStatusException(status, message); }

  record ChangeInput(@NotNull UUID serviceItemId, @NotBlank @Size(max = 240) String reason) {}
  record LockedSession(UUID id, UUID serviceItemId, String serviceNameSnapshot, Integer servicePriceCents,
      Integer plannedDurationMinutes, OffsetDateTime startedAt, OffsetDateTime expectedEndAt, UUID priceVersionId,
      UUID commissionRuleVersionId, Boolean countsAsClockSnapshot, java.time.LocalDate businessDate, String status, Integer version) {}
  record ChangeResponse(UUID serviceSessionId, UUID previousServiceItemId, String previousServiceName,
      UUID serviceItemId, String serviceName, Integer previousPriceCents, Integer priceCents,
      Integer previousDurationMinutes, Integer durationMinutes, OffsetDateTime previousExpectedEndAt,
      OffsetDateTime expectedEndAt, Integer extensionMinutes, String reason, String actorName, OffsetDateTime changedAt) {}
}
