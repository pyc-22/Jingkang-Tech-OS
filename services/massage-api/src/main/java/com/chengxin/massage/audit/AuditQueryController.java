package com.chengxin.massage.audit;

import com.chengxin.massage.admin.AdminSessionService;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

@RestController
@RequestMapping("/api/v1/audits")
@CrossOrigin(origins = "*")
public class AuditQueryController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
  private final JdbcClient jdbc;
  private final AdminSessionService sessions;
  private final AuditService audits;

  AuditQueryController(JdbcClient jdbc, AdminSessionService sessions, AuditService audits) {
    this.jdbc = jdbc;
    this.sessions = sessions;
    this.audits = audits;
  }

  @GetMapping("/export")
  @Transactional
  ResponseEntity<byte[]> export(@RequestParam(required = false) UUID storeId,
                                @RequestParam(required = false) LocalDate from,
                                @RequestParam(required = false) LocalDate to,
                                @RequestParam(required = false) UUID actorUserId,
                                @RequestParam(defaultValue = "") String module,
                                @RequestParam(defaultValue = "") String action,
                                @RequestParam(defaultValue = "") String source,
                                @RequestParam(defaultValue = "") String result,
                                @RequestParam(defaultValue = "") String query,
                                @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "AUDIT_EXPORT");
    validateQuery(from, to, query, 0, 100);
    Scope scope = scope(authorization, storeId);
    QueryParts parts = queryParts(scope, from, to, actorUserId, module, action, source, result, query);
    long total = jdbc.sql("select count(*) " + auditFrom() + parts.where())
      .params(parts.params()).query(Long.class).single();
    if (total > 10_000) throw bad("Export cannot exceed 10000 audit records; narrow the filters first");
    List<AuditExportRow> rows = jdbc.sql("""
      select a.created_at,s.code store_code,s.name store_name,
        coalesce(a.actor_name_snapshot,u.display_name,'System') actor_name,a.actor_roles_snapshot::text actor_roles,
        a.module_code,a.action,a.summary,a.entity_type,a.entity_id,a.source,a.result,a.failure_reason,
        a.request_id,host(a.ip_address) ip_address,a.user_agent,a.before_data::text before_data,
        a.after_data::text after_data,a.context_data::text context_data
      """ + auditFrom() + parts.where() + " order by a.created_at desc,a.id desc")
      .params(parts.params()).query(AuditExportRow.class).list();
    byte[] workbook = exportWorkbook(rows);
    UUID exportId = UUID.randomUUID();
    Map<String, Object> context = new HashMap<>();
    context.put("recordCount", rows.size());
    context.put("storeId", storeId);
    context.put("from", from);
    context.put("to", to);
    context.put("actorUserId", actorUserId);
    context.put("module", blankToNull(module));
    context.put("action", blankToNull(action));
    context.put("source", blankToNull(source));
    context.put("result", blankToNull(result));
    context.put("query", blankToNull(query));
    UUID auditStore = storeId != null ? storeId : (!scope.allStores() && scope.storeIds().size() == 1 ? scope.storeIds().getFirst() : null);
    audits.record(authorization, auditStore, "AUDIT", "AUDIT_EXPORTED", "audit_export", exportId,
      "Audit records exported", null, context);
    String filename = "操作审计_%s.xlsx".formatted(LocalDate.now(BUSINESS_ZONE));
    return ResponseEntity.ok()
      .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
      .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + URLEncoder.encode(filename, StandardCharsets.UTF_8).replace("+", "%20"))
      .body(workbook);
  }

  @GetMapping
  AuditPage list(@RequestParam(required = false) UUID storeId,
                 @RequestParam(required = false) LocalDate from,
                 @RequestParam(required = false) LocalDate to,
                 @RequestParam(required = false) UUID actorUserId,
                 @RequestParam(defaultValue = "") String module,
                 @RequestParam(defaultValue = "") String action,
                 @RequestParam(defaultValue = "") String source,
                 @RequestParam(defaultValue = "") String result,
                 @RequestParam(defaultValue = "") String query,
                 @RequestParam(defaultValue = "0") int page,
                 @RequestParam(defaultValue = "30") int size,
                 @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "AUDIT_VIEW");
    validateQuery(from, to, query, page, size);
    Scope scope = scope(authorization, storeId);
    QueryParts parts = queryParts(scope, from, to, actorUserId, module, action, source, result, query);
    long total = jdbc.sql("select count(*) " + auditFrom() + parts.where())
      .params(parts.params()).query(Long.class).single();
    Map<String, Object> pageParams = new HashMap<>(parts.params());
    pageParams.put("limit", size);
    pageParams.put("offset", page * size);
    List<AuditListItem> items = jdbc.sql("""
      select a.id,a.created_at,a.store_id,s.code store_code,s.name store_name,
        a.actor_user_id,coalesce(a.actor_name_snapshot,u.display_name,'System') actor_name,
        a.actor_roles_snapshot::text actor_roles,a.module_code,a.action,a.summary,a.entity_type,a.entity_id,
        a.source,a.result,a.failure_reason,a.request_id,host(a.ip_address) ip_address
      """ + auditFrom() + parts.where() + " order by a.created_at desc,a.id desc limit :limit offset :offset")
      .params(pageParams).query(AuditListItem.class).list();
    long totalPages = total == 0 ? 0 : (total + size - 1) / size;
    return new AuditPage(items, page, size, total, totalPages);
  }

  @GetMapping("/{id}")
  AuditDetail detail(@PathVariable UUID id,
                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "AUDIT_VIEW");
    Scope scope = scope(authorization, null);
    Map<String, Object> params = new HashMap<>();
    params.put("tenant", TENANT_ID);
    params.put("id", id);
    String scopeClause = scopeClause(scope, params);
    return jdbc.sql("""
      select a.id,a.created_at,a.store_id,s.code store_code,s.name store_name,
        a.actor_user_id,coalesce(a.actor_name_snapshot,u.display_name,'System') actor_name,
        a.actor_roles_snapshot::text actor_roles,a.module_code,a.action,a.summary,a.entity_type,a.entity_id,
        a.source,a.result,a.failure_reason,a.request_id,host(a.ip_address) ip_address,a.user_agent,
        a.before_data::text before_data,a.after_data::text after_data,a.context_data::text context_data
      """ + auditFrom() + " where a.tenant_id=:tenant and a.id=:id" + scopeClause)
      .params(params).query(AuditDetail.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Audit record not found"));
  }

  @GetMapping("/options")
  AuditOptions options(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "AUDIT_VIEW");
    Scope scope = scope(authorization, null);
    Map<String, Object> params = new HashMap<>();
    params.put("tenant", TENANT_ID);
    String scopeClause = scopeClause(scope, params);
    List<StoreOption> stores = stores(scope);
    List<ActorOption> actors = jdbc.sql("""
      select distinct a.actor_user_id id,coalesce(a.actor_name_snapshot,u.display_name,'System') name
      """ + auditFrom() + " where a.tenant_id=:tenant and a.actor_user_id is not null" + scopeClause + " order by name")
      .params(params).query(ActorOption.class).list();
    List<String> modules = values("module_code", scope, params);
    List<String> actions = values("action", scope, params);
    return new AuditOptions(stores, actors, modules, actions,
      List.of("ADMIN_WEB", "TECHNICIAN_MOBILE", "SYSTEM", "API"),
      List.of("SUCCESS", "FAILED", "DENIED"));
  }

  private QueryParts queryParts(Scope scope, LocalDate from, LocalDate to, UUID actorUserId,
                                String module, String action, String source, String result, String query) {
    StringBuilder where = new StringBuilder(" where a.tenant_id=:tenant");
    Map<String, Object> params = new HashMap<>();
    params.put("tenant", TENANT_ID);
    where.append(scopeClause(scope, params));
    if (from != null) {
      where.append(" and a.created_at>=:from");
      params.put("from", from.atStartOfDay(BUSINESS_ZONE).toOffsetDateTime());
    }
    if (to != null) {
      where.append(" and a.created_at<:to");
      params.put("to", to.plusDays(1).atStartOfDay(BUSINESS_ZONE).toOffsetDateTime());
    }
    if (actorUserId != null) { where.append(" and a.actor_user_id=:actor"); params.put("actor", actorUserId); }
    appendExact(where, params, "module", "a.module_code", module);
    appendExact(where, params, "action", "a.action", action);
    appendExact(where, params, "source", "a.source", source);
    appendExact(where, params, "result", "a.result", result);
    if (!query.isBlank()) {
      where.append(" and (coalesce(a.summary,'') ilike :query or a.action ilike :query or a.entity_type ilike :query or a.entity_id::text ilike :query or coalesce(a.actor_name_snapshot,'') ilike :query or coalesce(a.request_id,'') ilike :query or coalesce(s.code,'') ilike :query or coalesce(s.name,'') ilike :query)");
      params.put("query", "%" + query.trim() + "%");
    }
    return new QueryParts(where.toString(), params);
  }

  private void appendExact(StringBuilder where, Map<String, Object> params, String key, String column, String value) {
    if (value != null && !value.isBlank()) { where.append(" and ").append(column).append("=:").append(key); params.put(key, value.trim()); }
  }

  private String scopeClause(Scope scope, Map<String, Object> params) {
    if (scope.storeId() != null) { params.put("store", scope.storeId()); return " and a.store_id=:store"; }
    if (scope.allStores()) return "";
    if (scope.storeIds().isEmpty()) return " and 1=0";
    params.put("storeIds", scope.storeIds());
    return " and a.store_id in (:storeIds)";
  }

  private Scope scope(String authorization, UUID requestedStoreId) {
    AdminSessionService.AdminSession session = sessions.session(authorization);
    boolean tenantAdmin = session.roles().contains("TENANT_ADMIN");
    if (requestedStoreId != null) {
      boolean exists = jdbc.sql("select exists(select 1 from store where id=:store and tenant_id=:tenant)")
        .param("store", requestedStoreId).param("tenant", TENANT_ID).query(Boolean.class).single();
      if (!exists) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Store not found");
      if (!tenantAdmin && !session.storeIds().contains(requestedStoreId)) {
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Store access denied");
      }
      return new Scope(false, List.of(), requestedStoreId);
    }
    return tenantAdmin ? new Scope(true, List.of(), null) : new Scope(false, session.storeIds(), null);
  }

  private List<StoreOption> stores(Scope scope) {
    if (scope.allStores()) {
      return jdbc.sql("select id,code,name,active from store where tenant_id=:tenant order by active desc,code")
        .param("tenant", TENANT_ID).query(StoreOption.class).list();
    }
    if (scope.storeIds().isEmpty()) return List.of();
    return jdbc.sql("select id,code,name,active from store where tenant_id=:tenant and id in (:stores) order by active desc,code")
      .param("tenant", TENANT_ID).param("stores", scope.storeIds()).query(StoreOption.class).list();
  }

  private List<String> values(String column, Scope scope, Map<String, Object> baseParams) {
    Map<String, Object> params = new HashMap<>(baseParams);
    String scopeClause = scopeClause(scope, params);
    return jdbc.sql("select distinct a." + column + " from audit_log a where a.tenant_id=:tenant" + scopeClause + " and a." + column + " is not null order by a." + column)
      .params(params).query(String.class).list();
  }

  private byte[] exportWorkbook(List<AuditExportRow> records) {
    String[] headers = {"序号", "操作时间", "门店编码", "门店名称", "操作人", "角色快照", "业务模块", "操作动作",
      "操作摘要", "对象类型", "对象编号", "来源", "结果", "失败原因", "请求编号", "IP 地址", "设备信息",
      "修改前", "修改后", "请求环境"};
    try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      Sheet sheet = workbook.createSheet("操作审计");
      sheet.createFreezePane(0, 1);
      sheet.setAutoFilter(new CellRangeAddress(0, 0, 0, headers.length - 1));
      Font headerFont = workbook.createFont();
      headerFont.setBold(true);
      headerFont.setColor(IndexedColors.WHITE.getIndex());
      CellStyle headerStyle = workbook.createCellStyle();
      headerStyle.setFont(headerFont);
      headerStyle.setFillForegroundColor(IndexedColors.DARK_BLUE.getIndex());
      headerStyle.setFillPattern(FillPatternType.SOLID_FOREGROUND);
      CellStyle wrapStyle = workbook.createCellStyle();
      wrapStyle.setWrapText(true);
      Row header = sheet.createRow(0);
      for (int column = 0; column < headers.length; column++) setCell(header, column, headers[column], headerStyle);
      int index = 1;
      for (AuditExportRow record : records) {
        Row row = sheet.createRow(index);
        String occurredAt = record.createdAt() == null ? "" : record.createdAt().atZoneSameInstant(BUSINESS_ZONE).toLocalDateTime().toString().replace('T', ' ');
        String[] values = {String.valueOf(index), occurredAt, record.storeCode(), record.storeName(), record.actorName(),
          record.actorRoles(), record.moduleCode(), record.action(), record.summary(), record.entityType(),
          record.entityId() == null ? "" : record.entityId().toString(), record.source(), record.result(), record.failureReason(),
          record.requestId(), record.ipAddress(), record.userAgent(), record.beforeData(), record.afterData(), record.contextData()};
        for (int column = 0; column < values.length; column++) setCell(row, column, values[column], column >= 16 ? wrapStyle : null);
        index++;
      }
      int[] widths = {8, 21, 16, 20, 18, 24, 16, 28, 32, 18, 38, 18, 12, 30, 38, 16, 42, 60, 60, 48};
      for (int column = 0; column < widths.length; column++) sheet.setColumnWidth(column, widths[column] * 256);
      workbook.write(output);
      return output.toByteArray();
    } catch (IOException exception) {
      throw new IllegalStateException("Unable to export audit workbook", exception);
    }
  }

  private void setCell(Row row, int column, String value, CellStyle style) {
    Cell cell = row.createCell(column);
    cell.setCellValue(truncateCell(value));
    if (style != null) cell.setCellStyle(style);
  }

  private String truncateCell(String value) {
    if (value == null) return "";
    return value.length() <= 32_000 ? value : value.substring(0, 32_000) + "\n[TRUNCATED]";
  }

  private String blankToNull(String value) { return value == null || value.isBlank() ? null : value.trim(); }

  private void validateQuery(LocalDate from, LocalDate to, String query, int page, int size) {
    if (from != null && to != null && to.isBefore(from)) throw bad("End date must not be before start date");
    if (from != null && to != null && from.plusDays(366).isBefore(to)) throw bad("Date range cannot exceed 367 days");
    if (query != null && query.length() > 120) throw bad("Query must not exceed 120 characters");
    if (page < 0) throw bad("Page must be non-negative");
    if (size < 1 || size > 100) throw bad("Page size must be between 1 and 100");
  }

  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private String auditFrom() { return "from audit_log a left join store s on s.id=a.store_id left join app_user u on u.id=a.actor_user_id"; }

  public record AuditPage(List<AuditListItem> items, int page, int size, long totalElements, long totalPages) {}
  public record AuditListItem(UUID id, OffsetDateTime createdAt, UUID storeId, String storeCode, String storeName,
                              UUID actorUserId, String actorName, String actorRoles, String moduleCode, String action,
                              String summary, String entityType, UUID entityId, String source, String result,
                              String failureReason, String requestId, String ipAddress) {}
  public record AuditDetail(UUID id, OffsetDateTime createdAt, UUID storeId, String storeCode, String storeName,
                            UUID actorUserId, String actorName, String actorRoles, String moduleCode, String action,
                            String summary, String entityType, UUID entityId, String source, String result,
                            String failureReason, String requestId, String ipAddress, String userAgent,
                            String beforeData, String afterData, String contextData) {}
  public record AuditOptions(List<StoreOption> stores, List<ActorOption> actors, List<String> modules,
                             List<String> actions, List<String> sources, List<String> results) {}
  public record StoreOption(UUID id, String code, String name, Boolean active) {}
  public record ActorOption(UUID id, String name) {}
  private record AuditExportRow(OffsetDateTime createdAt, String storeCode, String storeName, String actorName,
                                String actorRoles, String moduleCode, String action, String summary, String entityType,
                                UUID entityId, String source, String result, String failureReason, String requestId,
                                String ipAddress, String userAgent, String beforeData, String afterData, String contextData) {}
  private record QueryParts(String where, Map<String, Object> params) {}
  private record Scope(boolean allStores, List<UUID> storeIds, UUID storeId) {}
}
