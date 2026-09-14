package com.chengxin.massage.catalog;

import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

/** Centralizes store duration limits so technician and manager changes use the same rules. */
@Service
public class ServiceDurationPolicyService {
  private final JdbcClient jdbc;

  ServiceDurationPolicyService(JdbcClient jdbc) { this.jdbc = jdbc; }

  public Policy policy(UUID storeId) {
    return jdbc.sql("select service_duration_max_minutes,technician_extension_max_minutes from store where id=:store")
      .param("store", storeId).query(Policy.class).optional().orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Store not found"));
  }

  public SessionState lockSession(UUID storeId, UUID sessionId) {
    return jdbc.sql("select id,technician_id,status,planned_duration_minutes,started_at,expected_end_at,version from service_session where id=:id and store_id=:store for update")
      .param("id", sessionId).param("store", storeId).query(SessionState.class).optional()
      .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Service session not found"));
  }

  public int extensionMinutes(UUID storeId, UUID sessionId) {
    return jdbc.sql("select coalesce(sum(planned_duration_minutes),0)::integer from service_session_extension where store_id=:store and service_session_id=:session")
      .param("store", storeId).param("session", sessionId).query(Integer.class).single();
  }

  public void requireTotalWithinLimit(Policy limits, int totalMinutes) {
    if (totalMinutes > limits.serviceDurationMaxMinutes()) {
      throw error(HttpStatus.BAD_REQUEST, "Total service duration cannot exceed " + limits.serviceDurationMaxMinutes() + " minutes");
    }
  }

  public void requireExtensionWithinLimit(Policy limits, int currentExtensionMinutes, int additionMinutes, int totalMinutes) {
    // technician_extension_max_minutes is retained for schema/API compatibility;
    // extension records are now limited only by the total service duration.
    requireTotalWithinLimit(limits, totalMinutes);
  }

  public int remainingExtensionMinutes(Policy limits, int currentExtensionMinutes, int totalMinutes) {
    int serviceRemaining = limits.serviceDurationMaxMinutes() - totalMinutes;
    return Math.max(0, serviceRemaining);
  }

  public void recordChange(UUID tenantId, UUID storeId, UUID sessionId, UUID technicianId, UUID extensionId,
                           UUID actorUserId, String actorName, String source, int previousDuration, int newDuration,
                           OffsetDateTime previousEnd, OffsetDateTime newEnd, String reason) {
    jdbc.sql("insert into service_session_duration_change_log(id,tenant_id,store_id,service_session_id,technician_id,service_session_extension_id,actor_user_id,actor_name_snapshot,source,previous_duration_minutes,new_duration_minutes,added_duration_minutes,previous_expected_end_at,new_expected_end_at,reason) values(:id,:tenant,:store,:session,:technician,:extension,:actor,:actorName,:source,:previousDuration,:newDuration,:added,:previousEnd,:newEnd,:reason)")
      .param("id", UUID.randomUUID()).param("tenant", tenantId).param("store", storeId).param("session", sessionId)
      .param("technician", technicianId).param("extension", extensionId).param("actor", actorUserId).param("actorName", actorName)
      .param("source", source).param("previousDuration", previousDuration).param("newDuration", newDuration)
      .param("added", newDuration - previousDuration).param("previousEnd", previousEnd).param("newEnd", newEnd)
      .param("reason", reason).update();
  }

  private ResponseStatusException error(HttpStatus status, String message) { return new ResponseStatusException(status, message); }

  public record Policy(Short serviceDurationMaxMinutes, Short technicianExtensionMaxMinutes) {}
  public record SessionState(UUID id, UUID technicianId, String status, Short plannedDurationMinutes,
                             OffsetDateTime startedAt, OffsetDateTime expectedEndAt, Long version) {}
}
