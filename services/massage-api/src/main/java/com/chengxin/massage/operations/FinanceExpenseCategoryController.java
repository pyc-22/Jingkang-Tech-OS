package com.chengxin.massage.operations;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.audit.AuditService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/finance/expense-categories")
@CrossOrigin(origins = "*")
public class FinanceExpenseCategoryController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final String PENDING_CODE = "PENDING_FINANCE_CLASSIFICATION";
  private final JdbcClient jdbc;
  private final AdminSessionService sessions;
  private final AuditService audits;

  FinanceExpenseCategoryController(JdbcClient jdbc, AdminSessionService sessions, AuditService audits) {
    this.jdbc = jdbc;
    this.sessions = sessions;
    this.audits = audits;
  }

  @GetMapping
  List<FinanceCategory> list(
      @RequestParam(defaultValue = "true") boolean includeInactive,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "EXPENSE_CONFIG");
    String activeClause = includeInactive ? "" : " and category.active=true";
    return jdbc.sql("select category.id,category.parent_id,parent.name parent_name,category.code,category.name,category.category_level,category.receipt_required,category.no_receipt_allowed,category.sort_order,category.active,category.created_at,category.updated_at,category.version from expense_category category left join expense_category parent on parent.id=category.parent_id where category.tenant_id=:tenant" + activeClause + " order by category.category_level,category.sort_order,category.code")
      .param("tenant", TENANT_ID).query(FinanceCategory.class).list();
  }

  @PostMapping
  @Transactional
  FinanceCategory create(
      @Valid @RequestBody CategoryInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "EXPENSE_CONFIG");
    String code = normalizeCode(input.code());
    if (PENDING_CODE.equals(code)) throw bad("This category code is reserved");
    if (existsByCode(code, null)) throw conflict("Expense category code already exists");
    ParentCategory parent = parent(input.parentId());
    validatePolicy(input.receiptRequired(), input.noReceiptAllowed());
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into expense_category(id,tenant_id,parent_id,code,name,category_level,receipt_required,no_receipt_allowed,sort_order) values(:id,:tenant,:parent,:code,:name,:level,:required,:allowed,:sort)")
      .param("id", id).param("tenant", TENANT_ID).param("parent", input.parentId()).param("code", code)
      .param("name", input.name().trim()).param("level", parent == null ? 1 : 2)
      .param("required", input.receiptRequired()).param("allowed", input.noReceiptAllowed()).param("sort", input.sortOrder()).update();
    FinanceCategory created = category(id);
    audits.record(authorization, null, "EXPENSE", "EXPENSE_CATEGORY_CREATED", "expense_category", id, "新增报销类型", null, created);
    return created;
  }

  @PutMapping("/{id}")
  @Transactional
  FinanceCategory update(
      @PathVariable UUID id,
      @Valid @RequestBody CategoryInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "EXPENSE_CONFIG");
    FinanceCategory before = category(id);
    if (PENDING_CODE.equals(before.code())) throw conflict("The pending classification category is managed by the system");
    String code = normalizeCode(input.code());
    if (PENDING_CODE.equals(code)) throw bad("This category code is reserved");
    if (existsByCode(code, id)) throw conflict("Expense category code already exists");
    ParentCategory parent = parent(input.parentId());
    if (id.equals(input.parentId())) throw bad("A category cannot be its own parent");
    validatePolicy(input.receiptRequired(), input.noReceiptAllowed());
    jdbc.sql("update expense_category set parent_id=:parent,code=:code,name=:name,category_level=:level,receipt_required=:required,no_receipt_allowed=:allowed,sort_order=:sort,updated_at=now(),version=version+1 where id=:id and tenant_id=:tenant")
      .param("id", id).param("tenant", TENANT_ID).param("parent", input.parentId()).param("code", code)
      .param("name", input.name().trim()).param("level", parent == null ? 1 : 2)
      .param("required", input.receiptRequired()).param("allowed", input.noReceiptAllowed()).param("sort", input.sortOrder()).update();
    FinanceCategory updated = category(id);
    audits.record(authorization, null, "EXPENSE", "EXPENSE_CATEGORY_UPDATED", "expense_category", id, "修改报销类型", before, updated);
    return updated;
  }

  @PutMapping("/{id}/active")
  @Transactional
  FinanceCategory setActive(
      @PathVariable UUID id,
      @Valid @RequestBody ActiveInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "EXPENSE_CONFIG");
    FinanceCategory before = category(id);
    if (PENDING_CODE.equals(before.code()) && !input.active()) throw conflict("The pending classification category must remain active");
    jdbc.sql("update expense_category set active=:active,updated_at=now(),version=version+1 where id=:id and tenant_id=:tenant")
      .param("id", id).param("tenant", TENANT_ID).param("active", input.active()).update();
    FinanceCategory updated = category(id);
    audits.record(authorization, null, "EXPENSE", "EXPENSE_CATEGORY_STATUS_UPDATED", "expense_category", id, input.active() ? "启用报销类型" : "停用报销类型", before, updated);
    return updated;
  }

  private ParentCategory parent(UUID id) {
    if (id == null) return null;
    return jdbc.sql("select id,category_level,active from expense_category where id=:id and tenant_id=:tenant")
      .param("id", id).param("tenant", TENANT_ID).query(ParentCategory.class).optional()
      .filter(row -> row.categoryLevel() == 1 && row.active())
      .orElseThrow(() -> bad("Parent expense category must be an active level-one category"));
  }

  private FinanceCategory category(UUID id) {
    return jdbc.sql("select category.id,category.parent_id,parent.name parent_name,category.code,category.name,category.category_level,category.receipt_required,category.no_receipt_allowed,category.sort_order,category.active,category.created_at,category.updated_at,category.version from expense_category category left join expense_category parent on parent.id=category.parent_id where category.id=:id and category.tenant_id=:tenant")
      .param("id", id).param("tenant", TENANT_ID).query(FinanceCategory.class).optional()
      .orElseThrow(() -> notFound("Expense category not found"));
  }

  private boolean existsByCode(String code, UUID excludedId) {
    String sql = "select exists(select 1 from expense_category where tenant_id=:tenant and code=:code" + (excludedId == null ? "" : " and id<>:id") + ")";
    JdbcClient.StatementSpec statement = jdbc.sql(sql).param("tenant", TENANT_ID).param("code", code);
    if (excludedId != null) statement = statement.param("id", excludedId);
    return statement.query(Boolean.class).single();
  }

  private String normalizeCode(String value) {
    String code = value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    if (!code.matches("[A-Z0-9_]{2,80}")) throw bad("Category code must contain only letters, numbers, and underscores");
    return code;
  }

  private void validatePolicy(Boolean receiptRequired, Boolean noReceiptAllowed) {
    if (Boolean.TRUE.equals(receiptRequired) && Boolean.TRUE.equals(noReceiptAllowed)) throw bad("A receipt-required category cannot allow no-receipt claims");
  }

  private ResponseStatusException bad(String message) { return new ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT, message); }
  private ResponseStatusException notFound(String message) { return new ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, message); }

  public record CategoryInput(UUID parentId, @NotBlank @Size(max = 80) String code, @NotBlank @Size(max = 120) String name,
                              @NotNull Boolean receiptRequired, @NotNull Boolean noReceiptAllowed, @NotNull @Min(0) Integer sortOrder) {}
  public record ActiveInput(boolean active) {}
  public record FinanceCategory(UUID id, UUID parentId, String parentName, String code, String name, Short categoryLevel,
                                Boolean receiptRequired, Boolean noReceiptAllowed, Integer sortOrder, Boolean active,
                                OffsetDateTime createdAt, OffsetDateTime updatedAt, Long version) {}
  private record ParentCategory(UUID id, Short categoryLevel, Boolean active) {}
}
