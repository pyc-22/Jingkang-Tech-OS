package com.chengxin.massage.catalog;

import com.chengxin.massage.admin.StoreContextService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/service-sessions")
@CrossOrigin(origins = "*")
public class ServiceSessionChangeHistoryController {
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;

  ServiceSessionChangeHistoryController(JdbcClient jdbc, StoreContextService storeContext) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
  }

  @GetMapping("/{sessionId}/change-history")
  List<ChangeEvent> history(@PathVariable UUID sessionId,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql("""
      select id,event_type,actor_name,reason,detail,changed_at from (
        select id,'SERVICE_ITEM_CHANGED' event_type,actor_name_snapshot actor_name,reason,
          previous_service_name_snapshot || ' -> ' || new_service_name_snapshot || '；¥' ||
          (previous_price_cents / 100.0)::numeric(12,2) || ' -> ¥' || (new_price_cents / 100.0)::numeric(12,2) detail,
          changed_at from service_session_item_change_log where store_id=:store and service_session_id=:session
        union all
        select id,case when source='TECHNICIAN_EXTENSION' or service_session_extension_id is not null then 'EXTENSION_ADDED' else 'DURATION_CHANGED' end,
          actor_name_snapshot,reason,previous_duration_minutes || ' -> ' || new_duration_minutes || ' 分钟',changed_at
          from service_session_duration_change_log where store_id=:store and service_session_id=:session
          and not (added_duration_minutes < 0 and reason like 'Extension cancelled:%')
        union all
        select id,'EXTENSION_CANCELLED',actor_name_snapshot,reason,service_name_snapshot || ' · ¥' || (service_price_cents / 100.0)::numeric(12,2) || ' · ' || planned_duration_minutes || ' 分钟',cancelled_at
          from service_session_extension_cancel_log where store_id=:store and service_session_id=:session
        union all
        select id,'ROOM_TRANSFER',coalesce(approved_by_name_snapshot,requested_by_name_snapshot,'系统'),reason,
          (select code from room where id=from_room_id) || ' 房 -> ' || (select code from room where id=to_room_id) || ' · ' || status,coalesce(approved_at,requested_at)
          from service_room_transfer where store_id=:store and service_session_id=:session
        union all
        select participant.id,'TECHNICIAN_CHANGED',coalesce((select audit.actor_name_snapshot from audit_log audit
            where audit.store_id=participant.store_id and audit.entity_id=participant.service_session_id
              and audit.action='SERVICE_TECHNICIAN_REPLACED'
            order by abs(extract(epoch from (audit.created_at-participant.joined_at))) limit 1),'系统'),participant.change_reason,
          previous_technician.name || ' -> ' || technician.name,coalesce(participant.service_started_at,participant.joined_at)
          from service_session_participant participant join technician technician on technician.id=participant.technician_id
          join service_session_participant previous_participant on previous_participant.id=participant.replaced_participant_id
          join technician previous_technician on previous_technician.id=previous_participant.technician_id
          where participant.store_id=:store and participant.service_session_id=:session and participant.replaced_participant_id is not null
        union all
        select audit.id,'CLOCK_TYPE_CHANGED',audit.actor_name_snapshot,audit.summary,
          coalesce(audit.before_data->>'clockType','排钟') || ' -> ' || coalesce(audit.after_data->>'clockType','排钟'),audit.created_at
          from audit_log audit
         where audit.store_id=:store and audit.entity_type='service_session'
           and audit.entity_id=:session and audit.action='SERVICE_CLOCK_TYPE_CHANGED'
      ) events order by changed_at desc, id desc
      """).param("store", storeId).param("session", sessionId).query(ChangeEvent.class).list();
  }

  record ChangeEvent(UUID id, String eventType, String actorName, String reason, String detail, OffsetDateTime changedAt) {}
}
