package com.chengxin.massage.alert;

import com.chengxin.massage.audit.AuditRecordedEvent;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SecurityAlertService {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final Logger LOGGER = LoggerFactory.getLogger(SecurityAlertService.class);
  private final JdbcClient jdbc;
  private final ObjectMapper objectMapper;

  public SecurityAlertService(JdbcClient jdbc, ObjectMapper objectMapper) {
    this.jdbc = jdbc;
    this.objectMapper = objectMapper;
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void evaluate(UUID auditId) {
    AuditEvent event = jdbc.sql("""
      select a.id,a.tenant_id,a.store_id,a.actor_user_id,a.action,a.module_code,a.result,a.created_at,
        host(a.ip_address) ip_address,a.actor_name_snapshot,a.before_data::text before_data,
        a.after_data::text after_data,a.context_data::text context_data
      from audit_log a where a.id=:id and a.tenant_id=:tenant
      """).param("id", auditId).param("tenant", TENANT_ID).query(AuditEvent.class).optional().orElse(null);
    if (event == null) return;
    for (AlertRule rule : matchingRules(event)) {
      JsonNode config = parse(rule.conditionConfig());
      if (!passesCondition(event, config)) continue;
      Map<String, String> grouping = groupingValues(event, config);
      List<EvidenceEvent> evidence = matchingEvidence(rule, event, config, grouping);
      if (evidence.size() < rule.thresholdCount()) continue;
      persistAlert(rule, event, grouping, evidence);
    }
  }

  List<AlertRule> matchingRules(AuditEvent event) {
    return jdbc.sql("""
      select distinct on (code) id,store_id,code,name,category,trigger_module,trigger_action,trigger_result,
        threshold_count,window_minutes,severity,condition_config::text condition_config
      from security_alert_rule
      where tenant_id=:tenant and active=true
        and (store_id is null or store_id=:store)
        and trigger_action=:action
        and (trigger_module is null or trigger_module=:module
          or (trigger_action='ACCESS_DENIED' and trigger_module='ACCESS' and :module='AUDIT'))
        and (trigger_result is null or trigger_result=:result)
      order by code,(store_id is not null) desc
      """)
      .param("tenant", TENANT_ID).param("store", event.storeId()).param("action", event.action())
      .param("module", event.moduleCode()).param("result", event.result())
      .query(AlertRule.class).list();
  }

  List<EvidenceEvent> matchingEvidence(AlertRule rule, AuditEvent event, JsonNode config,
                                       Map<String, String> grouping) {
    StringBuilder sql = new StringBuilder("""
      select a.id,a.store_id,a.created_at,a.context_data::text context_data,
        a.before_data::text before_data,a.after_data::text after_data
      from audit_log a
      where a.tenant_id=:tenant and a.action=:action and a.created_at>:windowStart and a.created_at<=:occurredAt
      """);
    Map<String, Object> params = new HashMap<>();
    params.put("tenant", TENANT_ID);
    params.put("action", event.action());
    params.put("windowStart", event.createdAt().minusMinutes(rule.windowMinutes()));
    params.put("occurredAt", event.createdAt());
    if (rule.triggerModule() != null) {
      // ACCESS_DENIED is audited by the endpoint module (for example AUDIT),
      // while the alert rule groups all authorization failures under ACCESS.
      if ("ACCESS".equals(rule.triggerModule()) && "ACCESS_DENIED".equals(rule.triggerAction())) {
        sql.append(" and (a.module_code=:module or a.module_code='AUDIT')");
      } else {
        sql.append(" and a.module_code=:module");
      }
      params.put("module", rule.triggerModule());
    }
    if (rule.triggerResult() != null) { sql.append(" and a.result=:result"); params.put("result", rule.triggerResult()); }
    if (rule.storeId() != null) { sql.append(" and a.store_id=:ruleStore"); params.put("ruleStore", rule.storeId()); }
    appendGrouping(sql, params, grouping);
    sql.append(" order by a.created_at asc,a.id asc");
    return jdbc.sql(sql.toString()).params(params).query(EvidenceEvent.class).list().stream()
      .filter(candidate -> passesCondition(candidate, config, event.action())).toList();
  }

  private void appendGrouping(StringBuilder sql, Map<String, Object> params, Map<String, String> grouping) {
    if (grouping.containsKey("loginName")) {
      sql.append(" and coalesce(a.context_data #>> '{requestBody,loginName}','')=:loginName");
      params.put("loginName", grouping.get("loginName"));
    }
    if (grouping.containsKey("ipAddress")) {
      sql.append(" and coalesce(host(a.ip_address),'')=:ipAddress");
      params.put("ipAddress", grouping.get("ipAddress"));
    }
    if (grouping.containsKey("actorUserId")) {
      if (grouping.get("actorUserId") == null) sql.append(" and a.actor_user_id is null");
      else { sql.append(" and a.actor_user_id=:actorUserId"); params.put("actorUserId", UUID.fromString(grouping.get("actorUserId"))); }
    }
    if (grouping.containsKey("storeId")) {
      if (grouping.get("storeId") == null) sql.append(" and a.store_id is null");
      else { sql.append(" and a.store_id=:groupStoreId"); params.put("groupStoreId", UUID.fromString(grouping.get("storeId"))); }
    }
  }

  private void persistAlert(AlertRule rule, AuditEvent event, Map<String, String> grouping,
                            List<EvidenceEvent> evidence) {
    String fingerprint = fingerprint(rule, grouping);
    OffsetDateTime first = evidence.stream().map(EvidenceEvent::createdAt).min(Comparator.naturalOrder()).orElse(event.createdAt());
    OffsetDateTime last = evidence.stream().map(EvidenceEvent::createdAt).max(Comparator.naturalOrder()).orElse(event.createdAt());
    Map<String, Object> context = new LinkedHashMap<>();
    context.put("ruleCode", rule.code());
    context.put("thresholdCount", rule.thresholdCount());
    context.put("windowMinutes", rule.windowMinutes());
    context.put("grouping", grouping);
    String contextJson = json(context);
    UUID alertId = jdbc.sql("""
      insert into security_alert(
        id,tenant_id,store_id,rule_id,source_audit_id,fingerprint,title,description,severity,status,
        occurrence_count,risk_score,context_data,first_occurred_at,last_occurred_at
      ) values(
        :id,:tenant,:store,:rule,:source,:fingerprint,:title,:description,:severity,'PENDING',
        :count,:risk,cast(:context as jsonb),:first,:last
      )
      on conflict (tenant_id,fingerprint) where status in ('PENDING','PROCESSING') do update set
        source_audit_id=excluded.source_audit_id,
        description=excluded.description,
        last_occurred_at=greatest(security_alert.last_occurred_at,excluded.last_occurred_at),
        context_data=excluded.context_data,
        updated_at=now(),version=security_alert.version+1
      returning id
      """)
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", event.storeId())
      .param("rule", rule.id()).param("source", event.id()).param("fingerprint", fingerprint)
      .param("title", rule.name()).param("description", rule.name() + "：" + evidence.size() + " 次触发")
      .param("severity", rule.severity()).param("count", evidence.size()).param("risk", riskScore(rule.severity()))
      .param("context", contextJson).param("first", first).param("last", last)
      .query(UUID.class).single();
    for (EvidenceEvent item : evidence) {
      jdbc.sql("""
        insert into security_alert_evidence(alert_id,audit_log_id,tenant_id,store_id,occurred_at,context_data)
        values(:alert,:audit,:tenant,:store,:occurred,cast(:context as jsonb))
        on conflict (alert_id,audit_log_id) do nothing
        """)
        .param("alert", alertId).param("audit", item.id()).param("tenant", TENANT_ID)
        .param("store", item.storeId()).param("occurred", item.createdAt()).param("context", "{}")
        .update();
    }
    jdbc.sql("""
      update security_alert a set occurrence_count=(select count(*) from security_alert_evidence e where e.alert_id=a.id),
        first_occurred_at=(select min(e.occurred_at) from security_alert_evidence e where e.alert_id=a.id),
        last_occurred_at=(select max(e.occurred_at) from security_alert_evidence e where e.alert_id=a.id),
        updated_at=now() where a.id=:id
      """).param("id", alertId).update();
    jdbc.sql("""
      insert into security_alert_history(id,alert_id,tenant_id,store_id,action,to_status,note,context_data)
      select :id,:alert,:tenant,:store,'CREATED','PENDING',:note,cast(:context as jsonb)
      where not exists (select 1 from security_alert_history where alert_id=:alert and action='CREATED')
      """).param("id", UUID.randomUUID()).param("alert", alertId).param("tenant", TENANT_ID)
      .param("store", event.storeId()).param("note", rule.name()).param("context", contextJson).update();
  }

  Map<String, String> groupingValues(AuditEvent event, JsonNode config) {
    Map<String, String> values = new LinkedHashMap<>();
    JsonNode groupBy = config.path("groupBy");
    if (groupBy.isArray()) for (JsonNode field : groupBy) {
      String name = field.asText();
      values.put(name, switch (name) {
        case "loginName" -> text(parse(event.contextData()).at("/requestBody/loginName"));
        case "ipAddress" -> event.ipAddress();
        case "actorUserId" -> event.actorUserId() == null ? null : event.actorUserId().toString();
        case "storeId" -> event.storeId() == null ? null : event.storeId().toString();
        default -> null;
      });
    }
    return values;
  }

  String fingerprint(AlertRule rule, Map<String, String> grouping) {
    String raw = rule.code() + "|" + grouping.entrySet().stream().map(entry -> entry.getKey() + "=" + entry.getValue()).reduce("", (left, right) -> left + "|" + right);
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));
      StringBuilder hex = new StringBuilder(rule.code()).append(':');
      for (byte value : digest) hex.append(String.format("%02x", value));
      return hex.toString();
    } catch (Exception exception) { throw new IllegalStateException("Unable to build alert fingerprint", exception); }
  }

  private boolean passesCondition(AuditEvent event, JsonNode config) { return passesCondition(event.afterData(), event.contextData(), config, event.action()); }
  private boolean passesCondition(EvidenceEvent event, JsonNode config, String action) { return passesCondition(event.afterData(), event.contextData(), config, action); }

  private boolean passesCondition(String afterData, String contextData, JsonNode config, String action) {
    JsonNode minimum = config.get("minimumAmountCents");
    if (minimum == null || !minimum.canConvertToLong()) return true;
    JsonNode root = JsonNodeFactory.instance.objectNode();
    ((com.fasterxml.jackson.databind.node.ObjectNode) root).set("afterData", parse(afterData));
    ((com.fasterxml.jackson.databind.node.ObjectNode) root).set("contextData", parse(contextData));
    JsonNode amount = path(root, config.path("amountField").asText());
    if ((amount == null || !amount.canConvertToLong()) && "REFUND_CREATED".equals(action)) amount = path(root, "afterData.totalCents");
    return amount != null && amount.canConvertToLong() && amount.asLong() >= minimum.asLong();
  }

  private JsonNode path(JsonNode root, String dottedPath) {
    JsonNode current = root;
    for (String part : dottedPath.split("\\.")) { if (current == null) return null; current = current.get(part); }
    return current;
  }

  private JsonNode parse(String value) { if (value == null || value.isBlank()) return JsonNodeFactory.instance.objectNode(); try { return objectMapper.readTree(value); } catch (Exception ignored) { return JsonNodeFactory.instance.objectNode(); } }
  private String text(JsonNode value) { return value == null || value.isMissingNode() || value.isNull() ? null : value.asText(); }
  private int riskScore(String severity) { return switch (severity) { case "CRITICAL" -> 95; case "HIGH" -> 80; case "MEDIUM" -> 55; default -> 25; }; }
  private String json(Object value) { try { return objectMapper.writeValueAsString(value); } catch (Exception exception) { throw new IllegalStateException(exception); } }

  record AuditEvent(UUID id, UUID tenantId, UUID storeId, UUID actorUserId, String action, String moduleCode,
                    String result, OffsetDateTime createdAt, String ipAddress, String actorNameSnapshot,
                    String beforeData, String afterData, String contextData) {}
  record AlertRule(UUID id, UUID storeId, String code, String name, String category, String triggerModule,
                   String triggerAction, String triggerResult, Integer thresholdCount, Integer windowMinutes,
                   String severity, String conditionConfig) {}
  record EvidenceEvent(UUID id, UUID storeId, OffsetDateTime createdAt, String contextData,
                       String beforeData, String afterData) {}
}
