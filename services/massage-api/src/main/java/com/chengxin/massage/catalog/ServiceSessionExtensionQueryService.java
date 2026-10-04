package com.chengxin.massage.catalog;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class ServiceSessionExtensionQueryService {
  private final JdbcClient jdbc;

  public ServiceSessionExtensionQueryService(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  public Map<UUID, List<Extension>> forSessions(UUID storeId, List<UUID> sessionIds) {
    if (sessionIds.isEmpty()) return Map.of();
    List<Extension> rows = jdbc.sql(extensionSql()).param("store", storeId).param("sessions", sessionIds)
        .query(Extension.class).list();
    Map<UUID, List<Extension>> result = new LinkedHashMap<>();
    for (Extension row : rows) {
      result.computeIfAbsent(row.serviceSessionId(), ignored -> new ArrayList<>()).add(row);
    }
    return result;
  }

  static String extensionSql() {
    return """
      select extension.id,extension.service_session_id,extension.technician_id,
             technician.code technician_code,technician.name technician_name,
             extension.service_item_id,extension.service_name_snapshot,
             extension.service_price_cents,extension.planned_duration_minutes,extension.added_at
        from service_session_extension extension
        join service_session session on session.id=extension.service_session_id
          and session.store_id=extension.store_id and session.tenant_id=extension.tenant_id
        join technician on technician.id=extension.technician_id
          and technician.store_id=extension.store_id and technician.tenant_id=extension.tenant_id
       where session.store_id=:store and extension.store_id=:store
         and session.id in (:sessions)
       order by extension.service_session_id,extension.added_at,extension.id
      """;
  }

  public record Extension(UUID id, UUID serviceSessionId, UUID technicianId, String technicianCode,
                          String technicianName, UUID serviceItemId, String serviceNameSnapshot,
                          Integer servicePriceCents, Short plannedDurationMinutes, OffsetDateTime addedAt) {}
}
