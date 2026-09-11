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
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

/** Changes one extension snapshot without changing the main service item. */
@RestController
@RequestMapping("/api/v1/service-sessions")
@CrossOrigin(origins = "*")
public class ServiceSessionExtensionItemChangeController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final Logger LOGGER = LoggerFactory.getLogger(ServiceSessionExtensionItemChangeController.class);
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final ServiceItemVersionService itemVersions;
  private final ServiceDurationPolicyService durationPolicies;
  private final BusinessClockService businessClock;
  private final AuditService audits;

  ServiceSessionExtensionItemChangeController(JdbcClient jdbc, StoreContextService storeContext,
      AdminSessionService adminSessions, ServiceItemVersionService itemVersions,
      ServiceDurationPolicyService durationPolicies, BusinessClockService businessClock, AuditService audits) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.itemVersions = itemVersions;
    this.durationPolicies = durationPolicies;
    this.businessClock = businessClock;
    this.audits = audits;
  }

  @PutMapping("/{sessionId}/extensions/{extensionId}/service-item")
  @Transactional
  ChangeResponse change(@PathVariable UUID sessionId, @PathVariable UUID extensionId,
      @Valid @RequestBody ChangeInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    try {
      ServiceDurationPolicyService.SessionState locked = durationPolicies.lockSession(storeId, sessionId);
      if (!"IN_SERVICE".equals(locked.status())) {
        throw error(HttpStatus.CONFLICT, "Only an in-service session can change an extension project");
      }
      boolean settled = jdbc.sql("select exists(select 1 from sales_order_service_session where service_session_id=:session)")
        .param("session", sessionId).query(Boolean.class).single();
      if (settled) throw error(HttpStatus.CONFLICT, "Settled services cannot change an extension");

      ExtensionDetails current = jdbc.sql("select id,service_session_id,technician_id,service_item_id,service_name_snapshot,service_price_cents,planned_duration_minutes,price_version_id,commission_rule_version_id,counts_as_clock_snapshot from service_session_extension where id=:id and store_id=:store and service_session_id=:session for update")
        .param("id", extensionId).param("store", storeId).param("session", sessionId).query(ExtensionDetails.class).optional()
        .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Extension not found or already cancelled"));
      if (current.serviceItemId().equals(input.serviceItemId())) {
        throw error(HttpStatus.BAD_REQUEST, "New extension project must be different from current project");
      }
      LocalDate businessDate = jdbc.sql("select business_date from service_session where id=:id and store_id=:store")
        .param("id", sessionId).param("store", storeId).query(LocalDate.class).single();
      if (businessDate == null) businessDate = businessClock.currentBusinessDate(storeId);
      ResolvedServiceItem next = itemVersions.activeItem(storeId, input.serviceItemId(), businessDate)
        .filter(ResolvedServiceItem::allowsExtension)
        .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "Service item is unavailable for extension"));
      CommissionRuleVersion commission = itemVersions.commissionRule(storeId, next.id(), businessDate);
      int deltaMinutes = next.defaultDurationMinutes() - current.plannedDurationMinutes();
      int currentExtensionMinutes = durationPolicies.extensionMinutes(storeId, sessionId);
      int newExtensionMinutes = currentExtensionMinutes + deltaMinutes;
      int newTotalDuration = locked.plannedDurationMinutes() + deltaMinutes;
      if (newTotalDuration < 15) throw error(HttpStatus.BAD_REQUEST, "The service must retain at least 15 minutes");
      if (newExtensionMinutes < 0) throw error(HttpStatus.CONFLICT, "Current extension duration is invalid");
      durationPolicies.requireExtensionWithinLimit(durationPolicies.policy(storeId),
        currentExtensionMinutes, deltaMinutes, newTotalDuration);
      OffsetDateTime newExpectedEnd = locked.expectedEndAt().plusMinutes(deltaMinutes);

      int updated = jdbc.sql("update service_session set planned_duration_minutes=:duration,expected_end_at=:expected,updated_at=now(),version=version+1 where id=:id and store_id=:store and status='IN_SERVICE' and version=:version")
        .param("duration", newTotalDuration).param("expected", newExpectedEnd).param("id", sessionId)
        .param("store", storeId).param("version", locked.version()).update();
      if (updated == 0) throw error(HttpStatus.CONFLICT, "Service state has changed; refresh and retry");
      jdbc.sql("update service_session_extension set service_item_id=:item,service_name_snapshot=:name,service_price_cents=:price,planned_duration_minutes=:duration,price_version_id=:priceVersion,commission_rule_version_id=:commissionVersion,counts_as_clock_snapshot=:countsAsClock where id=:id and store_id=:store and service_session_id=:session")
        .param("item", next.id()).param("name", next.name()).param("price", next.priceCents()).param("duration", next.defaultDurationMinutes())
        .param("priceVersion", next.priceVersionId()).param("commissionVersion", commission.id()).param("countsAsClock", next.countsAsClock())
        .param("id", extensionId).param("store", storeId).param("session", sessionId).update();
      jdbc.sql("insert into service_session_extension_change_log(id,tenant_id,store_id,service_session_id,extension_id,technician_id,previous_service_item_id,previous_service_name_snapshot,previous_price_cents,previous_duration_minutes,new_service_item_id,new_service_name_snapshot,new_price_cents,new_duration_minutes,previous_price_version_id,new_price_version_id,previous_commission_rule_version_id,new_commission_rule_version_id,previous_counts_as_clock_snapshot,new_counts_as_clock_snapshot,actor_user_id,actor_name_snapshot,reason) values(:id,:tenant,:store,:session,:extension,:technician,:oldItem,:oldName,:oldPrice,:oldDuration,:newItem,:newName,:newPrice,:newDuration,:oldPriceVersion,:newPriceVersion,:oldCommission,:newCommission,:oldCountsAsClock,:newCountsAsClock,:actor,:actorName,:reason)")
        .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("session", sessionId).param("extension", extensionId)
        .param("technician", current.technicianId()).param("oldItem", current.serviceItemId()).param("oldName", current.serviceNameSnapshot())
        .param("oldPrice", current.servicePriceCents()).param("oldDuration", current.plannedDurationMinutes()).param("newItem", next.id())
        .param("newName", next.name()).param("newPrice", next.priceCents()).param("newDuration", next.defaultDurationMinutes())
        .param("oldPriceVersion", current.priceVersionId()).param("newPriceVersion", next.priceVersionId())
        .param("oldCommission", current.commissionRuleVersionId()).param("newCommission", commission.id())
        .param("oldCountsAsClock", current.countsAsClockSnapshot()).param("newCountsAsClock", next.countsAsClock())
        .param("actor", actor.userId()).param("actorName", actor.displayName()).param("reason", input.reason().trim()).update();
      if (deltaMinutes != 0) {
        durationPolicies.recordChange(TENANT_ID, storeId, sessionId, current.technicianId(), extensionId, actor.userId(), actor.displayName(),
          "MANAGER_OVERRIDE", locked.plannedDurationMinutes(), newTotalDuration, locked.expectedEndAt(), newExpectedEnd,
          "Extension project changed: " + current.serviceNameSnapshot() + " -> " + next.name() + ". " + input.reason().trim());
      }
      ChangeResponse result = new ChangeResponse(extensionId, sessionId, current.serviceItemId(), current.serviceNameSnapshot(),
        next.id(), next.name(), current.servicePriceCents(), next.priceCents(), current.plannedDurationMinutes().intValue(), next.defaultDurationMinutes().intValue(),
        locked.plannedDurationMinutes().intValue(), newTotalDuration, locked.expectedEndAt(), newExpectedEnd, input.reason().trim(), actor.displayName(), OffsetDateTime.now());
      audits.record(authorization, storeId, "SERVICE", "SERVICE_EXTENSION_ITEM_CHANGED", "service_session_extension", extensionId,
        input.reason().trim(), current, result);
      return result;
    } catch (ResponseStatusException exception) {
      if (exception.getStatusCode().value() == 400 || exception.getStatusCode().value() == 409) {
        LOGGER.warn("Extension item change rejected: storeId={}, sessionId={}, extensionId={}, serviceItemId={}, reasonCode={}, httpStatus={}, cause={}",
          storeId, sessionId, extensionId, input.serviceItemId(), input.reason(), exception.getStatusCode().value(), exception.getReason());
      }
      throw exception;
    }
  }

  private ResponseStatusException error(HttpStatus status, String message) { return new ResponseStatusException(status, message); }

  record ChangeInput(@NotNull UUID serviceItemId, @NotBlank @Size(max = 240) String reason) {}
  record ExtensionDetails(UUID id, UUID serviceSessionId, UUID technicianId, UUID serviceItemId, String serviceNameSnapshot,
      Integer servicePriceCents, Short plannedDurationMinutes, UUID priceVersionId, UUID commissionRuleVersionId,
      Boolean countsAsClockSnapshot) {}
  record ChangeResponse(UUID extensionId, UUID serviceSessionId, UUID previousServiceItemId, String previousServiceName,
      UUID serviceItemId, String serviceName, Integer previousPriceCents, Integer priceCents,
      Integer previousDurationMinutes, Integer durationMinutes, Integer previousTotalDurationMinutes,
      Integer totalDurationMinutes, OffsetDateTime previousExpectedEndAt, OffsetDateTime expectedEndAt,
      String reason, String actorName, OffsetDateTime changedAt) {}
}
