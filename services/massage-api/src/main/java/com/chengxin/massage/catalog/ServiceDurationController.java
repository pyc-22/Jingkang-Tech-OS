package com.chengxin.massage.catalog;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1")
@CrossOrigin(origins = "*")
public class ServiceDurationController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final ServiceDurationPolicyService policies;
  private final AuditService audits;

  ServiceDurationController(JdbcClient jdbc, StoreContextService storeContext, AdminSessionService adminSessions,
                            ServiceDurationPolicyService policies, AuditService audits) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.policies = policies;
    this.audits = audits;
  }

  @GetMapping("/service-duration-policy")
  PolicyResponse policy(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                        @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    ServiceDurationPolicyService.Policy policy = policies.policy(storeId);
    return new PolicyResponse(storeId, policy.serviceDurationMaxMinutes(), policy.technicianExtensionMaxMinutes());
  }

  @PutMapping("/service-duration-policy")
  @Transactional
  PolicyResponse updatePolicy(@Valid @RequestBody PolicyInput input,
                              @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                              @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    if (input.technicianExtensionMaxMinutes() > input.serviceDurationMaxMinutes() - 15) {
      throw error(HttpStatus.BAD_REQUEST, "Technician extension limit must leave at least 15 minutes for the base service");
    }
    ServiceDurationPolicyService.Policy before = policies.policy(storeId);
    jdbc.sql("update store set service_duration_max_minutes=:maxDuration,technician_extension_max_minutes=:maxExtension,updated_at=now(),version=version+1 where id=:store and service_duration_max_minutes>=15")
      .param("maxDuration", input.serviceDurationMaxMinutes()).param("maxExtension", input.technicianExtensionMaxMinutes()).param("store", storeId).update();
    ServiceDurationPolicyService.Policy after = policies.policy(storeId);
    audits.record(authorization, storeId, "SERVICE", "SERVICE_DURATION_POLICY_UPDATED", "store", storeId,
      "Updated service duration policy", before, after);
    return new PolicyResponse(storeId, after.serviceDurationMaxMinutes(), after.technicianExtensionMaxMinutes());
  }

  @PutMapping("/service-sessions/{sessionId}/duration")
  @Transactional
  ServiceSessionDuration updateDuration(@PathVariable UUID sessionId, @Valid @RequestBody DurationInput input,
                                         @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                         @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    ServiceDurationPolicyService.SessionState current = policies.lockSession(storeId, sessionId);
    boolean inService = "IN_SERVICE".equals(current.status());
    if (!inService && !"PENDING_ACCEPTANCE".equals(current.status()) && !"ACCEPTED".equals(current.status())) {
      throw error(HttpStatus.CONFLICT, "Only a pending, accepted, or in-service session can change duration");
    }
    ServiceDurationPolicyService.Policy limits = policies.policy(storeId);
    policies.requireTotalWithinLimit(limits, input.newDurationMinutes());
    int extensionMinutes = policies.extensionMinutes(storeId, sessionId);
    if (input.newDurationMinutes() < extensionMinutes + 15) {
      throw error(HttpStatus.BAD_REQUEST, "New duration cannot be less than recorded extension time plus the base service");
    }
    OffsetDateTime newEnd = inService ? current.startedAt().plusMinutes(input.newDurationMinutes()) : current.expectedEndAt();
    if (inService && !newEnd.isAfter(OffsetDateTime.now())) throw error(HttpStatus.BAD_REQUEST, "New end time must be after now");
    int updated = jdbc.sql("update service_session set planned_duration_minutes=:duration,expected_end_at=:expected,updated_at=now(),version=version+1 where id=:id and store_id=:store and status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE') and version=:version")
      .param("duration", input.newDurationMinutes()).param("expected", newEnd).param("id", sessionId).param("store", storeId).param("version", current.version()).update();
    if (updated == 0) throw error(HttpStatus.CONFLICT, "Service state has changed; refresh and retry");
    policies.recordChange(TENANT_ID, storeId, sessionId, current.technicianId(), null, actor.userId(), actor.displayName(),
      "MANAGER_OVERRIDE", current.plannedDurationMinutes(), input.newDurationMinutes(), current.expectedEndAt(), newEnd, input.reason().trim());
    ServiceSessionDuration result = new ServiceSessionDuration(sessionId, current.plannedDurationMinutes(), input.newDurationMinutes(), current.expectedEndAt(), newEnd, input.reason().trim(), actor.displayName(), OffsetDateTime.now());
    audits.record(authorization, storeId, "SERVICE", "SERVICE_DURATION_OVERRIDDEN", "service_session", sessionId, input.reason().trim(), current, result);
    return result;
  }

  @GetMapping("/service-sessions/{sessionId}/duration-changes")
  List<DurationChange> changes(@PathVariable UUID sessionId,
                               @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                               @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    policies.lockSession(storeId, sessionId);
    return jdbc.sql("select id,service_session_id,technician_id,service_session_extension_id,actor_user_id,actor_name_snapshot,source,previous_duration_minutes,new_duration_minutes,added_duration_minutes,previous_expected_end_at,new_expected_end_at,reason,changed_at from service_session_duration_change_log where store_id=:store and service_session_id=:session order by changed_at desc,id desc")
      .param("store", storeId).param("session", sessionId).query(DurationChange.class).list();
  }

  private ResponseStatusException error(HttpStatus status, String message) { return new ResponseStatusException(status, message); }

  record PolicyInput(@NotNull @Min(15) @Max(1440) Short serviceDurationMaxMinutes,
                     @NotNull @Min(0) @Max(720) Short technicianExtensionMaxMinutes) {}
  record DurationInput(@NotNull @Min(15) @Max(1440) Short newDurationMinutes,
                       @NotBlank @Size(max = 240) String reason) {}
  record PolicyResponse(UUID storeId, Short serviceDurationMaxMinutes, Short technicianExtensionMaxMinutes) {}
  record ServiceSessionDuration(UUID serviceSessionId, Short previousDurationMinutes, Short newDurationMinutes,
                                OffsetDateTime previousExpectedEndAt, OffsetDateTime newExpectedEndAt,
                                String reason, String actorName, OffsetDateTime changedAt) {}
  record DurationChange(UUID id, UUID serviceSessionId, UUID technicianId, UUID serviceSessionExtensionId,
                        UUID actorUserId, String actorNameSnapshot, String source, Short previousDurationMinutes,
                        Short newDurationMinutes, Short addedDurationMinutes, OffsetDateTime previousExpectedEndAt,
                        OffsetDateTime newExpectedEndAt, String reason, OffsetDateTime changedAt) {}
}
