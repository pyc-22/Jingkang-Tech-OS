package com.chengxin.massage.alert;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.audit.AuditService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/security-alerts")
@CrossOrigin(origins = "*")
public class SecurityAlertController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final List<String> STATUSES = List.of("PENDING", "PROCESSING", "RESOLVED");
  private static final List<String> SEVERITIES = List.of("LOW", "MEDIUM", "HIGH", "CRITICAL");
  private final JdbcClient jdbc;
  private final AdminSessionService sessions;
  private final AuditService audits;

  SecurityAlertController(JdbcClient jdbc, AdminSessionService sessions, AuditService audits) {
    this.jdbc = jdbc;
    this.sessions = sessions;
    this.audits = audits;
  }

  @GetMapping
  AlertPage list(@RequestParam(required = false) UUID storeId,
                 @RequestParam(defaultValue = "") String status,
                 @RequestParam(defaultValue = "") String severity,
                 @RequestParam(defaultValue = "") String category,
                 @RequestParam(defaultValue = "") String ruleCode,
                 @RequestParam(defaultValue = "") String query,
                 @RequestParam(defaultValue = "0") int page,
                 @RequestParam(defaultValue = "30") int size,
                 @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "ALERT_VIEW");
    validateQuery(page, size, query);
    Scope scope = scope(authorization, storeId);
    QueryParts parts = queryParts(scope, status, severity, category, ruleCode, query);
    long total = jdbc.sql("select count(*) " + from() + parts.where()).params(parts.params()).query(Long.class).single();
    Map<String, Object> params = new HashMap<>(parts.params());
    params.put("limit", size);
    params.put("offset", page * size);
    List<AlertListItem> items = jdbc.sql("""
      select a.id,a.created_at,a.store_id,s.code store_code,s.name store_name,a.rule_id,r.code rule_code,
        r.name rule_name,r.category,a.title,a.description,a.severity,a.status,a.occurrence_count,a.risk_score,
        a.first_occurred_at,a.last_occurred_at,a.assigned_to_user_id,assigned.display_name assigned_to_name,
        a.handled_by_user_id,handled.display_name handled_by_name,a.handled_at
      """ + from() + parts.where() + " order by a.last_occurred_at desc,a.id desc limit :limit offset :offset")
      .params(params).query(AlertListItem.class).list();
    long totalPages = total == 0 ? 0 : (total + size - 1) / size;
    return new AlertPage(items, page, size, total, totalPages);
  }

  @GetMapping("/options")
  AlertOptions options(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "ALERT_VIEW");
    Scope scope = scope(authorization, null);
    List<StoreOption> stores = stores(scope);
    Map<String, Object> params = new HashMap<>();
    params.put("tenant", TENANT_ID);
    String ruleScope = ruleScopeClause(scope, params);
    List<RuleOption> rules = jdbc.sql("select distinct r.code,r.name,r.category,r.severity from security_alert_rule r where r.tenant_id=:tenant" + ruleScope + " order by r.code")
      .params(params).query(RuleOption.class).list();
    return new AlertOptions(stores, rules, STATUSES, SEVERITIES);
  }

  @GetMapping("/rules")
  List<RuleView> rules(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "ALERT_CONFIG");
    Scope scope = scope(authorization, null);
    Map<String, Object> params = new HashMap<>();
    params.put("tenant", TENANT_ID);
    String scopeClause = scopeClause(scope, "r", params);
    return jdbc.sql("""
      select r.id,r.store_id,s.code store_code,s.name store_name,r.code,r.name,r.category,r.trigger_module,
        r.trigger_action,r.trigger_result,r.threshold_count,r.window_minutes,r.severity,r.condition_config::text condition_config,
        r.active,r.updated_at
      from security_alert_rule r left join store s on s.id=r.store_id
      where r.tenant_id=:tenant""" + scopeClause + " order by r.store_id nulls first,r.code")
      .params(params).query(RuleView.class).list();
  }

  @GetMapping("/{id}")
  AlertDetail detail(@PathVariable UUID id,
                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "ALERT_VIEW");
    Scope scope = scope(authorization, null);
    Map<String, Object> params = new HashMap<>();
    params.put("tenant", TENANT_ID);
    params.put("id", id);
    String scopeClause = scopeClause(scope, "a", params);
    AlertListItem alert = jdbc.sql("""
      select a.id,a.created_at,a.store_id,s.code store_code,s.name store_name,a.rule_id,r.code rule_code,
        r.name rule_name,r.category,a.title,a.description,a.severity,a.status,a.occurrence_count,a.risk_score,
        a.first_occurred_at,a.last_occurred_at,a.assigned_to_user_id,assigned.display_name assigned_to_name,
        a.handled_by_user_id,handled.display_name handled_by_name,a.handled_at
      """ + from() + " where a.tenant_id=:tenant and a.id=:id" + scopeClause)
      .params(params).query(AlertListItem.class).optional().orElseThrow(() -> notFound("Alert not found"));
    List<AlertEvidence> evidence = jdbc.sql("""
      select e.audit_log_id,e.occurred_at,a.action,a.module_code,a.result,a.summary,a.request_id,
        host(a.ip_address) ip_address,a.actor_name_snapshot
      from security_alert_evidence e join audit_log a on a.id=e.audit_log_id
      where e.alert_id=:alert order by e.occurred_at desc
      """).param("alert", id).query(AlertEvidence.class).list();
    List<AlertHistory> history = jdbc.sql("""
      select h.id,h.action,h.from_status,h.to_status,h.actor_user_id,h.actor_name_snapshot,h.note,h.created_at
      from security_alert_history h where h.alert_id=:alert order by h.created_at desc
      """).param("alert", id).query(AlertHistory.class).list();
    String context = jdbc.sql("select context_data::text from security_alert where id=:id and tenant_id=:tenant")
      .param("id", id).param("tenant", TENANT_ID).query(String.class).single();
    return new AlertDetail(alert, context, evidence, history);
  }

  @PostMapping("/{id}/status")
  @Transactional
  AlertDetail changeStatus(@PathVariable UUID id, @Valid @RequestBody StatusInput input,
                           @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "ALERT_HANDLE");
    String status = input.status() == null ? "" : input.status().trim().toUpperCase();
    if (!STATUSES.contains(status)) throw bad("Unsupported alert status");
    Scope scope = scope(authorization, null);
    Map<String, Object> params = new HashMap<>();
    params.put("tenant", TENANT_ID);
    params.put("id", id);
    String scopeClause = scopeClause(scope, "a", params);
    AlertState before = jdbc.sql("select a.id,a.store_id,a.status,a.title from security_alert a where a.tenant_id=:tenant and a.id=:id" + scopeClause + " for update")
      .params(params).query(AlertState.class).optional().orElseThrow(() -> notFound("Alert not found"));
    AdminSessionService.AuthenticatedIdentity actor = sessions.authenticatedIdentity(authorization);
    String note = input.note() == null ? null : input.note().trim();
    jdbc.sql("""
      update security_alert set status=:status,
        assigned_to_user_id=case when :status='PROCESSING' then :actor when :status='PENDING' then null else assigned_to_user_id end,
        handled_by_user_id=case when :status='RESOLVED' then :actor else null end,
        handled_at=case when :status='RESOLVED' then now() else null end,
        resolution_note=case when :status='RESOLVED' then :note else null end,
        updated_at=now(),version=version+1
      where id=:id and tenant_id=:tenant
      """).param("status", status).param("actor", actor.userId()).param("note", note)
      .param("id", id).param("tenant", TENANT_ID).update();
    jdbc.sql("""
      insert into security_alert_history(id,alert_id,tenant_id,store_id,action,from_status,to_status,actor_user_id,actor_name_snapshot,note)
      values(:history,:alert,:tenant,:store,'STATUS_CHANGED',:fromStatus,:toStatus,:actor,:actorName,:note)
      """).param("history", UUID.randomUUID()).param("alert", id).param("tenant", TENANT_ID)
      .param("store", before.storeId()).param("fromStatus", before.status()).param("toStatus", status)
      .param("actor", actor.userId()).param("actorName", actor.displayName()).param("note", note).update();
    AlertState after = jdbc.sql("select a.id,a.store_id,a.status,a.title from security_alert a where a.tenant_id=:tenant and a.id=:id")
      .param("tenant", TENANT_ID).param("id", id).query(AlertState.class).single();
    audits.record(authorization, after.storeId(), "ALERT", "SECURITY_ALERT_STATUS_CHANGED", "security_alert", id,
      "风险告警状态变更", before, after);
    return detail(id, authorization);
  }

  private QueryParts queryParts(Scope scope, String status, String severity, String category, String ruleCode, String query) {
    StringBuilder where = new StringBuilder(" where a.tenant_id=:tenant");
    Map<String, Object> params = new HashMap<>();
    params.put("tenant", TENANT_ID);
    where.append(scopeClause(scope, "a", params));
    appendExact(where, params, "status", "a.status", status);
    appendExact(where, params, "severity", "a.severity", severity);
    appendExact(where, params, "category", "r.category", category);
    appendExact(where, params, "ruleCode", "r.code", ruleCode);
    if (query != null && !query.isBlank()) {
      where.append(" and (a.title ilike :query or coalesce(a.description,'') ilike :query or r.code ilike :query or r.name ilike :query or coalesce(s.code,'') ilike :query or coalesce(s.name,'') ilike :query)");
      params.put("query", "%" + query.trim() + "%");
    }
    return new QueryParts(where.toString(), params);
  }

  private void appendExact(StringBuilder where, Map<String, Object> params, String key, String column, String value) {
    if (value != null && !value.isBlank()) { where.append(" and ").append(column).append("=:").append(key); params.put(key, value.trim().toUpperCase()); }
  }

  private Scope scope(String authorization, UUID requestedStoreId) {
    AdminSessionService.AdminSession session = sessions.session(authorization);
    boolean tenantAdmin = session.roles().contains("TENANT_ADMIN");
    if (requestedStoreId != null) {
      boolean exists = jdbc.sql("select exists(select 1 from store where id=:store and tenant_id=:tenant)")
        .param("store", requestedStoreId).param("tenant", TENANT_ID).query(Boolean.class).single();
      if (!exists) throw notFound("Store not found");
      if (!tenantAdmin && !session.storeIds().contains(requestedStoreId)) throw forbidden("Store access denied");
      return new Scope(false, List.of(), requestedStoreId);
    }
    return tenantAdmin ? new Scope(true, List.of(), null) : new Scope(false, session.storeIds(), null);
  }

  private String scopeClause(Scope scope, String alias, Map<String, Object> params) {
    if (scope.storeId() != null) { params.put("store", scope.storeId()); return " and " + alias + ".store_id=:store"; }
    if (scope.allStores()) return "";
    if (scope.storeIds().isEmpty()) return " and 1=0";
    params.put("storeIds", scope.storeIds());
    return " and " + alias + ".store_id in (:storeIds)";
  }

  private String ruleScopeClause(Scope scope, Map<String, Object> params) {
    if (scope.allStores()) return "";
    if (scope.storeIds().isEmpty()) return " and 1=0";
    params.put("storeIds", scope.storeIds());
    return " and (r.store_id is null or r.store_id in (:storeIds))";
  }

  private List<StoreOption> stores(Scope scope) {
    if (scope.allStores()) return jdbc.sql("select id,code,name,active from store where tenant_id=:tenant order by active desc,code")
      .param("tenant", TENANT_ID).query(StoreOption.class).list();
    if (scope.storeIds().isEmpty()) return List.of();
    return jdbc.sql("select id,code,name,active from store where tenant_id=:tenant and id in (:stores) order by active desc,code")
      .param("tenant", TENANT_ID).param("stores", scope.storeIds()).query(StoreOption.class).list();
  }

  private String from() {
    return "from security_alert a join security_alert_rule r on r.id=a.rule_id left join store s on s.id=a.store_id " +
      "left join app_user assigned on assigned.id=a.assigned_to_user_id left join app_user handled on handled.id=a.handled_by_user_id";
  }

  private void validateQuery(int page, int size, String query) {
    if (page < 0) throw bad("Page must be non-negative");
    if (size < 1 || size > 100) throw bad("Page size must be between 1 and 100");
    if (query != null && query.length() > 120) throw bad("Query must not exceed 120 characters");
  }
  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException forbidden(String message) { return new ResponseStatusException(HttpStatus.FORBIDDEN, message); }
  private ResponseStatusException notFound(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }

  public record AlertPage(List<AlertListItem> items, int page, int size, long totalElements, long totalPages) {}
  public record AlertOptions(List<StoreOption> stores, List<RuleOption> rules, List<String> statuses, List<String> severities) {}
  public record StoreOption(UUID id, String code, String name, Boolean active) {}
  public record RuleOption(String code, String name, String category, String severity) {}
  public record RuleView(UUID id, UUID storeId, String storeCode, String storeName, String code, String name,
                         String category, String triggerModule, String triggerAction, String triggerResult,
                         Integer thresholdCount, Integer windowMinutes, String severity, String conditionConfig,
                         Boolean active, OffsetDateTime updatedAt) {}
  public record AlertListItem(UUID id, OffsetDateTime createdAt, UUID storeId, String storeCode, String storeName,
                              UUID ruleId, String ruleCode, String ruleName, String category, String title,
                              String description, String severity, String status, Integer occurrenceCount,
                              BigDecimal riskScore, OffsetDateTime firstOccurredAt, OffsetDateTime lastOccurredAt,
                              UUID assignedToUserId, String assignedToName, UUID handledByUserId,
                              String handledByName, OffsetDateTime handledAt) {}
  public record AlertDetail(AlertListItem alert, String contextData, List<AlertEvidence> evidence,
                           List<AlertHistory> history) {}
  public record AlertEvidence(UUID auditLogId, OffsetDateTime occurredAt, String action, String moduleCode,
                              String result, String summary, String requestId, String ipAddress,
                              String actorNameSnapshot) {}
  public record AlertHistory(UUID id, String action, String fromStatus, String toStatus, UUID actorUserId,
                             String actorNameSnapshot, String note, OffsetDateTime createdAt) {}
  public record StatusInput(@jakarta.validation.constraints.NotBlank String status, @Size(max = 500) String note) {}
  private record QueryParts(String where, Map<String, Object> params) {}
  private record Scope(boolean allStores, List<UUID> storeIds, UUID storeId) {}
  private record AlertState(UUID id, UUID storeId, String status, String title) {}
}
