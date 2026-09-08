package com.chengxin.massage.audit;

import com.chengxin.massage.admin.AdminSessionService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

@Service
public class AuditService {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final String REQUEST_ID_ATTRIBUTE = AuditService.class.getName() + ".requestId";
  private static final List<String> SENSITIVE_KEYS = List.of("password", "token", "authorization", "secret", "hash");
  private final JdbcClient jdbc;
  private final AdminSessionService sessions;
  private final ObjectMapper objectMapper;
  private final ApplicationEventPublisher events;

  public AuditService(JdbcClient jdbc, AdminSessionService sessions, ObjectMapper objectMapper,
                      ApplicationEventPublisher events) {
    this.jdbc = jdbc;
    this.sessions = sessions;
    this.objectMapper = objectMapper;
    this.events = events;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void record(String authorization, UUID storeId, String moduleCode, String action, String entityType,
                     UUID entityId, String summary, Object before, Object after) {
    AdminSessionService.AuthenticatedIdentity actor = sessions.authenticatedIdentity(authorization);
    RequestDetails request = requestDetails();
    UUID auditId = UUID.randomUUID();
    jdbc.sql("""
      insert into audit_log(
        id,tenant_id,store_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,
        module_code,summary,source,result,actor_name_snapshot,actor_roles_snapshot,request_id,
        ip_address,user_agent,context_data
      ) values(
        :id,:tenant,:store,:actor,:action,:entityType,:entityId,cast(:before as jsonb),cast(:after as jsonb),
        :module,:summary,:source,'SUCCESS',:actorName,cast(:actorRoles as jsonb),:requestId,
        cast(:ipAddress as inet),:userAgent,cast(:context as jsonb)
      )
      """)
      .param("id", auditId).param("tenant", TENANT_ID).param("store", storeId)
      .param("actor", actor.userId()).param("action", limit(action, 80)).param("entityType", limit(entityType, 80))
      .param("entityId", entityId).param("before", json(before)).param("after", json(after))
      .param("module", limit(moduleCode, 40)).param("summary", limit(summary, 240)).param("source", request.source())
      .param("actorName", limit(actor.displayName(), 120)).param("actorRoles", json(actor.roles()))
      .param("requestId", request.requestId()).param("ipAddress", request.ipAddress())
      .param("userAgent", limit(request.userAgent(), 500)).param("context", json(request.context())).update();
    events.publishEvent(new AuditRecordedEvent(auditId));
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void recordOutcome(HttpServletRequest servletRequest, String moduleCode, String action, String entityType,
                            UUID entityId, String summary, String result, String failureReason,
                            Object requestBody, Map<String, Object> outcomeContext) {
    AdminSessionService.AuthenticatedIdentity actor = sessions
      .authenticatedIdentityIfPresent(servletRequest.getHeader("Authorization")).orElse(null);
    RequestDetails request = requestDetails(servletRequest);
    Map<String, Object> context = new LinkedHashMap<>(request.context());
    if (outcomeContext != null) context.putAll(outcomeContext);
    if (requestBody != null) context.put("requestBody", requestBody);
    UUID storeId = outcomeStore(servletRequest, actor);
    UUID auditId = UUID.randomUUID();
    jdbc.sql("""
      insert into audit_log(
        id,tenant_id,store_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,
        module_code,summary,source,result,failure_reason,actor_name_snapshot,actor_roles_snapshot,
        request_id,ip_address,user_agent,context_data
      ) values(
        :id,:tenant,:store,:actor,:action,:entityType,:entityId,null,null,
        :module,:summary,:source,:result,:failureReason,:actorName,cast(:actorRoles as jsonb),
        :requestId,cast(:ipAddress as inet),:userAgent,cast(:context as jsonb)
      )
      """)
      .param("id", auditId).param("tenant", TENANT_ID).param("store", storeId)
      .param("actor", actor == null ? null : actor.userId()).param("action", limit(action, 80))
      .param("entityType", limit(entityType, 80)).param("entityId", entityId)
      .param("module", limit(moduleCode, 40)).param("summary", limit(summary, 240))
      .param("source", request.source()).param("result", result).param("failureReason", limit(failureReason, 500))
      .param("actorName", actor == null ? null : limit(actor.displayName(), 120))
      .param("actorRoles", json(actor == null ? List.of() : actor.roles()))
      .param("requestId", request.requestId()).param("ipAddress", request.ipAddress())
      .param("userAgent", limit(request.userAgent(), 500)).param("context", json(context)).update();
    events.publishEvent(new AuditRecordedEvent(auditId));
  }

  private RequestDetails requestDetails() {
    ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
    if (attributes == null) return new RequestDetails(UUID.randomUUID().toString(), null, null, "SYSTEM", Map.of());
    HttpServletRequest request = attributes.getRequest();
    return requestDetails(request);
  }

  private RequestDetails requestDetails(HttpServletRequest request) {
    String requestId = (String) request.getAttribute(REQUEST_ID_ATTRIBUTE);
    if (requestId == null) {
      requestId = limit(request.getHeader("X-Request-Id"), 80);
      if (requestId == null || requestId.isBlank()) requestId = UUID.randomUUID().toString();
      request.setAttribute(REQUEST_ID_ATTRIBUTE, requestId);
    }
    String path = request.getRequestURI();
    String source = path.startsWith("/api/v1/mobile/technician") ? "TECHNICIAN_MOBILE" : "ADMIN_WEB";
    String forwarded = request.getHeader("X-Forwarded-For");
    String ipAddress = forwarded == null || forwarded.isBlank() ? request.getRemoteAddr() : forwarded.split(",", 2)[0].trim();
    return new RequestDetails(requestId, ipAddress, request.getHeader("User-Agent"), source,
      Map.of("method", request.getMethod(), "path", path));
  }

  private UUID outcomeStore(HttpServletRequest request, AdminSessionService.AuthenticatedIdentity actor) {
    if (actor == null) return null;
    String requested = request.getHeader("X-Store-Id");
    UUID requestedStore = parseUuid(requested);
    if (requestedStore != null) {
      boolean tenantAdmin = actor.roles().contains("TENANT_ADMIN");
      boolean allowed = tenantAdmin || jdbc.sql("select exists(select 1 from user_store_scope where user_id=:user and store_id=:store) or exists(select 1 from technician_account_binding where user_id=:user and store_id=:store and active=true)")
        .param("user", actor.userId()).param("store", requestedStore).query(Boolean.class).single();
      boolean exists = jdbc.sql("select exists(select 1 from store where id=:store and tenant_id=:tenant)")
        .param("store", requestedStore).param("tenant", TENANT_ID).query(Boolean.class).single();
      if (allowed && exists) return requestedStore;
    }
    UUID technicianStore = jdbc.sql("select store_id from technician_account_binding where user_id=:user and tenant_id=:tenant and active=true order by created_at limit 1")
      .param("user", actor.userId()).param("tenant", TENANT_ID).query(UUID.class).optional().orElse(null);
    if (technicianStore != null) return technicianStore;
    List<UUID> stores = jdbc.sql("select store_id from user_store_scope where user_id=:user order by store_id")
      .param("user", actor.userId()).query(UUID.class).list();
    return stores.size() == 1 ? stores.getFirst() : null;
  }

  private UUID parseUuid(String value) {
    if (value == null || value.isBlank()) return null;
    try { return UUID.fromString(value); } catch (IllegalArgumentException ignored) { return null; }
  }

  private String json(Object value) {
    if (value == null) return null;
    try {
      JsonNode tree = objectMapper.valueToTree(value);
      sanitize(tree);
      return objectMapper.writeValueAsString(tree);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("Unable to serialize audit data", exception);
    }
  }

  private void sanitize(JsonNode node) {
    if (node == null) return;
    if (node.isObject()) {
      ObjectNode object = (ObjectNode) node;
      Iterator<Map.Entry<String, JsonNode>> fields = object.fields();
      List<String> sensitive = new ArrayList<>();
      while (fields.hasNext()) {
        Map.Entry<String, JsonNode> field = fields.next();
        String key = field.getKey().toLowerCase(Locale.ROOT);
        if (SENSITIVE_KEYS.stream().anyMatch(key::contains)) sensitive.add(field.getKey());
        else sanitize(field.getValue());
      }
      sensitive.forEach(key -> object.put(key, "[REDACTED]"));
    } else if (node.isArray()) {
      node.forEach(this::sanitize);
    }
  }

  private String limit(String value, int length) {
    if (value == null) return null;
    return value.length() <= length ? value : value.substring(0, length);
  }

  private record RequestDetails(String requestId, String ipAddress, String userAgent, String source,
                                Map<String, String> context) {}
}
