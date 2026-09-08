package com.chengxin.massage.operations;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;

@RestController
@RequestMapping("/api/v1/expense-claims")
@CrossOrigin(origins = "*")
public class ExpenseClaimController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
  private static final DateTimeFormatter CLAIM_DATE = DateTimeFormatter.ofPattern("yyyyMMdd");
  private static final List<String> ACCOUNTING_STATUSES = List.of("SUBMITTED", "APPROVED", "PAID");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService sessions;
  private final AuditService audits;
  private final ExpenseAttachmentStorage storage;

  ExpenseClaimController(JdbcClient jdbc, StoreContextService storeContext, AdminSessionService sessions,
                         AuditService audits, ExpenseAttachmentStorage storage) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.sessions = sessions;
    this.audits = audits;
    this.storage = storage;
  }

  @GetMapping("/categories")
  List<ExpenseCategory> categories(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                   @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    storeContext.currentStore(authorization, requestedStoreId);
    sessions.requirePermission(authorization, "EXPENSE_STORE_VIEW");
    return jdbc.sql("select id,parent_id,code,name,category_level,receipt_required,no_receipt_allowed,sort_order from expense_category where tenant_id=:tenant and active=true order by category_level,sort_order,code")
      .param("tenant", TENANT_ID).query(ExpenseCategory.class).list();
  }

  @GetMapping
  List<ClaimSummary> list(@RequestParam(defaultValue = "") String status,
                          @RequestParam(required = false) LocalDate from,
                          @RequestParam(required = false) LocalDate to,
                          @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                          @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    sessions.requirePermission(authorization, "EXPENSE_STORE_VIEW");
    String normalizedStatus = normalizeStatus(status);
    StringBuilder sql = new StringBuilder("select c.id,c.claim_no,c.store_id,s.name store_name,c.expense_category_id,coalesce(parent.name || ' / ','') || category.name category_name,c.expense_date,c.amount_cents,c.payee_name,c.receipt_type,c.status,c.submitted_at,c.updated_at from expense_claim c join store s on s.id=c.store_id join expense_category category on category.id=c.expense_category_id left join expense_category parent on parent.id=category.parent_id where c.tenant_id=:tenant and c.store_id=:store");
    if (!normalizedStatus.isBlank()) sql.append(" and c.status=:status");
    if (from != null) sql.append(" and c.expense_date>=:from");
    if (to != null) sql.append(" and c.expense_date<=:to");
    sql.append(" order by c.updated_at desc limit 200");
    JdbcClient.StatementSpec statement = jdbc.sql(sql.toString()).param("tenant", TENANT_ID).param("store", storeId);
    if (!normalizedStatus.isBlank()) statement = statement.param("status", normalizedStatus);
    if (from != null) statement = statement.param("from", from);
    if (to != null) statement = statement.param("to", to);
    return statement.query(ClaimSummary.class).list();
  }

  @GetMapping("/{id}")
  ClaimDetail detail(@PathVariable UUID id,
                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    sessions.requirePermission(authorization, "EXPENSE_STORE_VIEW");
    return detail(claim(id, storeId), storeId);
  }

  @GetMapping("/{claimId}/attachments/{attachmentId}")
  ResponseEntity<byte[]> attachment(@PathVariable UUID claimId, @PathVariable UUID attachmentId,
                                    @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                    @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    sessions.requirePermission(authorization, "EXPENSE_STORE_VIEW");
    claim(claimId, storeId);
    Attachment attachment = jdbc.sql("select id,claim_id,attachment_kind,storage_key,original_filename,content_type,file_size_bytes,sha256,uploaded_by_user_id,created_at from expense_attachment where id=:id and claim_id=:claim and store_id=:store and active=true")
      .param("id", attachmentId).param("claim", claimId).param("store", storeId).query(Attachment.class).optional()
      .orElseThrow(() -> notFound("Attachment not found"));
    String filename = URLEncoder.encode(attachment.originalFilename(), StandardCharsets.UTF_8).replace("+", "%20");
    return ResponseEntity.ok().contentType(MediaType.parseMediaType(attachment.contentType()))
      .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename*=UTF-8''" + filename)
      .body(storage.read(attachment.storageKey()));
  }

  @PostMapping
  @Transactional
  ClaimDetail create(@Valid @RequestBody ClaimInput input,
                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    sessions.requirePermission(authorization, "EXPENSE_SUBMIT");
    UUID actor = sessions.requireAuthenticatedUserId(authorization);
    ExpenseCategory selectedCategory = category(input.expenseCategoryId(), true);
    String receiptType = normalizeReceipt(input.receiptType());
    validateReceiptPolicy(selectedCategory, receiptType, input.noReceiptReason());
    UUID id = UUID.randomUUID();
    String claimNo = claimNo();
    try {
      jdbc.sql("insert into expense_claim(id,tenant_id,store_id,claim_no,applicant_user_id,expense_category_id,expense_date,amount_cents,payee_name,payment_source,receipt_type,invoice_no,description,no_receipt_reason) values(:id,:tenant,:store,:claimNo,:applicant,:category,:date,:amount,:payee,:source,:receipt,:invoice,:description,:reason)")
        .param("id", id).param("tenant", TENANT_ID).param("store", storeId).param("claimNo", claimNo).param("applicant", actor)
        .param("category", input.expenseCategoryId()).param("date", input.expenseDate()).param("amount", input.amountCents()).param("payee", blankToNull(input.payeeName()))
        .param("source", normalizeSource(input.paymentSource())).param("receipt", receiptType).param("invoice", blankToNull(input.invoiceNo()))
        .param("description", input.description().trim()).param("reason", blankToNull(input.noReceiptReason())).update();
    } catch (DataIntegrityViolationException exception) {
      throw conflict("报销单号生成冲突，请重新提交");
    }
    ClaimRow created = claim(id, storeId);
    audits.record(authorization, storeId, "EXPENSE", "EXPENSE_CLAIM_CREATED", "expense_claim", id, "创建费用报销草稿", null, created);
    return detail(created, storeId);
  }

  @PutMapping("/{id}")
  @Transactional
  ClaimDetail update(@PathVariable UUID id, @Valid @RequestBody ClaimInput input,
                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    sessions.requirePermission(authorization, "EXPENSE_SUBMIT");
    UUID actor = sessions.requireAuthenticatedUserId(authorization);
    ClaimRow before = ownedEditableClaim(id, storeId, actor);
    ExpenseCategory selectedCategory = category(input.expenseCategoryId(), true);
    String receiptType = normalizeReceipt(input.receiptType());
    validateReceiptPolicy(selectedCategory, receiptType, input.noReceiptReason());
    jdbc.sql("update expense_claim set expense_category_id=:category,expense_date=:date,amount_cents=:amount,payee_name=:payee,payment_source=:source,receipt_type=:receipt,invoice_no=:invoice,description=:description,no_receipt_reason=:reason,updated_at=now(),version=version+1 where id=:id and store_id=:store and applicant_user_id=:applicant and status in ('DRAFT','RETURNED')")
      .param("id", id).param("store", storeId).param("applicant", actor).param("category", input.expenseCategoryId()).param("date", input.expenseDate())
      .param("amount", input.amountCents()).param("payee", blankToNull(input.payeeName())).param("source", normalizeSource(input.paymentSource()))
      .param("receipt", receiptType).param("invoice", blankToNull(input.invoiceNo())).param("description", input.description().trim())
      .param("reason", blankToNull(input.noReceiptReason())).update();
    ClaimRow updated = claim(id, storeId);
    audits.record(authorization, storeId, "EXPENSE", "EXPENSE_CLAIM_UPDATED", "expense_claim", id, "修改费用报销草稿", before, updated);
    return detail(updated, storeId);
  }

  @PostMapping("/{id}/submit")
  @Transactional
  ClaimDetail submit(@PathVariable UUID id,
                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    sessions.requirePermission(authorization, "EXPENSE_SUBMIT");
    UUID actor = sessions.requireAuthenticatedUserId(authorization);
    ClaimRow before = ownedClaim(id, storeId, actor);
    if (!("DRAFT".equals(before.status()) || "RETURNED".equals(before.status()))) throw conflict("Only draft or returned claims can be submitted");
    ExpenseCategory selectedCategory = category(before.expenseCategoryId(), true);
    validateReceiptPolicy(selectedCategory, before.receiptType(), before.noReceiptReason());
    if (!"NO_RECEIPT".equals(before.receiptType()) && !hasAttachment(id, "EXPENSE_PROOF")) throw bad("Please upload an invoice or receipt before submitting");
    if ("NO_RECEIPT".equals(before.receiptType()) && (before.noReceiptReason() == null || before.noReceiptReason().isBlank())) throw bad("No-receipt claims require an explanation");
    if ("NO_RECEIPT".equals(before.receiptType()) && !hasAttachment(id, "NO_RECEIPT_EXPLANATION")) throw bad("No-receipt claims require an explanation image");
    long duplicateCount = duplicateCount(before);
    String warning = duplicateCount == 0 ? null : "{\"matchedCount\":" + duplicateCount + "}";
    jdbc.sql("update expense_claim set status='SUBMITTED',submitted_at=coalesce(submitted_at,now()),duplicate_warning=cast(:warning as jsonb),updated_at=now(),version=version+1 where id=:id and store_id=:store and applicant_user_id=:applicant and status in ('DRAFT','RETURNED')")
      .param("id", id).param("store", storeId).param("applicant", actor).param("warning", warning).update();
    ClaimRow updated = claim(id, storeId);
    history(id, storeId, actor, "RETURNED".equals(before.status()) ? "RESUBMIT" : "SUBMIT", before.status(), updated.status(), duplicateCount > 0 ? "检测到疑似重复报销，请财务复核" : null, updated);
    audits.record(authorization, storeId, "EXPENSE", "EXPENSE_CLAIM_SUBMITTED", "expense_claim", id, "提交费用报销审核", before, updated);
    return detail(updated, storeId);
  }

  @PostMapping("/{id}/withdraw")
  @Transactional
  ClaimDetail withdraw(@PathVariable UUID id,
                       @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                       @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    sessions.requirePermission(authorization, "EXPENSE_SUBMIT");
    UUID actor = sessions.requireAuthenticatedUserId(authorization);
    ClaimRow before = ownedClaim(id, storeId, actor);
    if (!"SUBMITTED".equals(before.status())) throw conflict("Only submitted claims can be withdrawn");
    int changed = jdbc.sql("update expense_claim set status='WITHDRAWN',updated_at=now(),version=version+1 where id=:id and store_id=:store and applicant_user_id=:applicant and status='SUBMITTED'")
      .param("id", id).param("store", storeId).param("applicant", actor).update();
    if (changed != 1) throw conflict("报销状态已变化，请刷新后重试");
    ClaimRow updated = claim(id, storeId);
    history(id, storeId, actor, "WITHDRAW", before.status(), updated.status(), null, updated);
    audits.record(authorization, storeId, "EXPENSE", "EXPENSE_CLAIM_WITHDRAWN", "expense_claim", id, "撤回费用报销", before, updated);
    return detail(updated, storeId);
  }

  @PostMapping(path = "/{id}/attachments", consumes = "multipart/form-data")
  @Transactional
  Attachment upload(@PathVariable UUID id, @RequestParam(defaultValue = "EXPENSE_PROOF") String attachmentKind,
                    @RequestPart("file") MultipartFile file,
                    @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                    @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    sessions.requirePermission(authorization, "EXPENSE_SUBMIT");
    UUID actor = sessions.requireAuthenticatedUserId(authorization);
    ClaimRow claim = ownedEditableClaim(id, storeId, actor);
    String kind = normalizeAttachmentKind(attachmentKind);
    if ("PAYMENT_PROOF".equals(kind)) throw bad("Payment proof can only be uploaded by finance");
    int existing = jdbc.sql("select count(*) from expense_attachment where claim_id=:claim and active=true").param("claim", id).query(Integer.class).single();
    if (existing >= 9) throw bad("A claim can contain at most 9 attachments");
    ExpenseAttachmentStorage.StoredFile stored = storage.store(TENANT_ID, storeId, id, file);
    try {
      UUID attachmentId = UUID.randomUUID();
      jdbc.sql("insert into expense_attachment(id,claim_id,tenant_id,store_id,attachment_kind,storage_key,original_filename,content_type,file_size_bytes,sha256,uploaded_by_user_id) values(:id,:claim,:tenant,:store,:kind,:key,:filename,:type,:size,:sha256,:actor)")
        .param("id", attachmentId).param("claim", id).param("tenant", TENANT_ID).param("store", storeId).param("kind", kind)
        .param("key", stored.storageKey()).param("filename", stored.originalFilename()).param("type", stored.contentType()).param("size", stored.fileSizeBytes()).param("sha256", stored.sha256()).param("actor", actor).update();
      Attachment created = attachment(attachmentId, id);
      audits.record(authorization, storeId, "EXPENSE", "EXPENSE_ATTACHMENT_UPLOADED", "expense_attachment", attachmentId, "上传报销凭证", null, created);
      return created;
    } catch (RuntimeException exception) {
      storage.delete(stored.storageKey());
      throw exception;
    }
  }

  @DeleteMapping("/{claimId}/attachments/{attachmentId}")
  @Transactional
  void deleteAttachment(@PathVariable UUID claimId, @PathVariable UUID attachmentId,
                        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                        @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    sessions.requirePermission(authorization, "EXPENSE_SUBMIT");
    UUID actor = sessions.requireAuthenticatedUserId(authorization);
    ownedEditableClaim(claimId, storeId, actor);
    Attachment existing = jdbc.sql("select id,claim_id,attachment_kind,storage_key,original_filename,content_type,file_size_bytes,sha256,uploaded_by_user_id,created_at from expense_attachment where id=:id and claim_id=:claim and store_id=:store and active=true")
      .param("id", attachmentId).param("claim", claimId).param("store", storeId).query(Attachment.class).optional().orElseThrow(() -> notFound("Attachment not found"));
    jdbc.sql("update expense_attachment set active=false,updated_at=now(),version=version+1 where id=:id").param("id", attachmentId).update();
    storage.delete(existing.storageKey());
    audits.record(authorization, storeId, "EXPENSE", "EXPENSE_ATTACHMENT_DELETED", "expense_attachment", attachmentId, "删除报销凭证", existing, null);
  }

  private ClaimDetail detail(ClaimRow row, UUID storeId) {
    List<Attachment> attachments = jdbc.sql("select id,claim_id,attachment_kind,storage_key,original_filename,content_type,file_size_bytes,sha256,uploaded_by_user_id,created_at from expense_attachment where claim_id=:claim and store_id=:store and active=true order by created_at")
      .param("claim", row.id()).param("store", storeId).query(Attachment.class).list();
    List<ReviewHistory> history = jdbc.sql("select h.id,h.action,h.from_status,h.to_status,h.comment,h.actor_user_id,u.display_name actor_name,h.created_at from expense_review_history h join app_user u on u.id=h.actor_user_id where h.claim_id=:claim and h.store_id=:store order by h.created_at desc")
      .param("claim", row.id()).param("store", storeId).query(ReviewHistory.class).list();
    return new ClaimDetail(row, attachments, history);
  }

  private ClaimRow claim(UUID id, UUID storeId) {
    return jdbc.sql("select c.id,c.claim_no,c.store_id,s.name store_name,c.applicant_user_id,applicant.display_name applicant_name,c.expense_category_id,coalesce(parent.name || ' / ','') || category.name category_name,c.expense_date,c.amount_cents,c.payee_name,c.payment_source,c.receipt_type,c.invoice_no,c.description,c.no_receipt_reason,c.status,c.duplicate_warning::text duplicate_warning,c.submitted_at,c.reviewed_by_user_id,c.reviewed_at,c.review_note,c.created_at,c.updated_at,c.version from expense_claim c join store s on s.id=c.store_id join app_user applicant on applicant.id=c.applicant_user_id join expense_category category on category.id=c.expense_category_id left join expense_category parent on parent.id=category.parent_id where c.id=:id and c.store_id=:store and c.tenant_id=:tenant")
      .param("id", id).param("store", storeId).param("tenant", TENANT_ID).query(ClaimRow.class).optional().orElseThrow(() -> notFound("Expense claim not found"));
  }

  private ClaimRow ownedClaim(UUID id, UUID storeId, UUID actor) {
    ClaimRow row = claim(id, storeId);
    if (!row.applicantUserId().equals(actor)) throw new ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN, "Only the applicant can manage this claim");
    return row;
  }

  private ClaimRow ownedEditableClaim(UUID id, UUID storeId, UUID actor) {
    ClaimRow row = ownedClaim(id, storeId, actor);
    if (!("DRAFT".equals(row.status()) || "RETURNED".equals(row.status()))) throw conflict("Only draft or returned claims can be edited");
    return row;
  }

  private ExpenseCategory category(UUID id, boolean activeOnly) {
    String sql = "select id,parent_id,code,name,category_level,receipt_required,no_receipt_allowed,sort_order from expense_category where id=:id and tenant_id=:tenant" + (activeOnly ? " and active=true" : "");
    return jdbc.sql(sql).param("id", id).param("tenant", TENANT_ID).query(ExpenseCategory.class).optional().orElseThrow(() -> bad("Expense category not found or inactive"));
  }

  private void validateReceiptPolicy(ExpenseCategory category, String receiptType, String noReceiptReason) {
    if (!"NO_RECEIPT".equals(receiptType)) return;
    if (!Boolean.TRUE.equals(category.noReceiptAllowed()) || Boolean.TRUE.equals(category.receiptRequired())) {
      throw bad("This expense category requires an invoice or receipt");
    }
    if (noReceiptReason == null || noReceiptReason.isBlank()) {
      throw bad("No-receipt claims require an explanation");
    }
  }

  private boolean hasAttachment(UUID claimId, String kind) {
    return jdbc.sql("select exists(select 1 from expense_attachment where claim_id=:claim and attachment_kind=:kind and active=true)").param("claim", claimId).param("kind", kind).query(Boolean.class).single();
  }

  private long duplicateCount(ClaimRow row) {
    return jdbc.sql("select count(*) from expense_claim where tenant_id=:tenant and store_id=:store and id<>:id and expense_date between :from and :to and amount_cents=:amount and expense_category_id=:category and coalesce(payee_name,'')=coalesce(:payee,'') and status not in ('REJECTED','WITHDRAWN')")
      .param("tenant", TENANT_ID).param("store", row.storeId()).param("id", row.id()).param("from", row.expenseDate().minusDays(30)).param("to", row.expenseDate().plusDays(30)).param("amount", row.amountCents()).param("category", row.expenseCategoryId()).param("payee", row.payeeName()).query(Long.class).single();
  }

  private void history(UUID claimId, UUID storeId, UUID actor, String action, String from, String to, String comment, ClaimRow snapshot) {
    jdbc.sql("insert into expense_review_history(id,claim_id,tenant_id,store_id,action,from_status,to_status,comment,snapshot,actor_user_id) values(:id,:claim,:tenant,:store,:action,:from,:to,:comment,cast(:snapshot as jsonb),:actor)")
      .param("id", UUID.randomUUID()).param("claim", claimId).param("tenant", TENANT_ID).param("store", storeId).param("action", action).param("from", from).param("to", to).param("comment", comment)
      .param("snapshot", "{\"status\":\"" + to + "\",\"amountCents\":" + snapshot.amountCents() + "}").param("actor", actor).update();
  }

  private Attachment attachment(UUID id, UUID claimId) {
    return jdbc.sql("select id,claim_id,attachment_kind,storage_key,original_filename,content_type,file_size_bytes,sha256,uploaded_by_user_id,created_at from expense_attachment where id=:id and claim_id=:claim").param("id", id).param("claim", claimId).query(Attachment.class).single();
  }

  private String claimNo() {
    String date = LocalDate.now(BUSINESS_ZONE).format(CLAIM_DATE);
    long sequence = jdbc.sql(claimNoSequenceSql()).query(Long.class).optional()
      .orElseGet(() -> Math.floorMod(UUID.randomUUID().getMostSignificantBits(), 100_000_000_000L));
    return "EXP-" + date + "-" + String.format(java.util.Locale.ROOT, "%04d", sequence);
  }

  static String claimNoSequenceSql() {
    return "select case when coalesce(has_sequence_privilege(current_user,to_regclass('expense_claim_no_seq'),'USAGE'),false) then nextval(to_regclass('expense_claim_no_seq')) else null end";
  }

  static boolean accountingIncluded(String status) {
    if (status == null) return false;
    return ACCOUNTING_STATUSES.contains(status.trim().toUpperCase(java.util.Locale.ROOT));
  }

  private String normalizeStatus(String value) {
    if (value == null || value.isBlank()) return "";
    String normalized = value.trim().toUpperCase(java.util.Locale.ROOT);
    if (!List.of("DRAFT","SUBMITTED","RETURNED","APPROVED","REJECTED","WITHDRAWN","PAID").contains(normalized)) throw bad("Unsupported expense claim status");
    return normalized;
  }

  private String normalizeSource(String value) { return normalize(value, List.of("PERSONAL_ADVANCE","STORE_PETTY_CASH","COMPANY_DIRECT"), "payment source"); }
  private String normalizeReceipt(String value) { return normalize(value, List.of("INVOICE","RECEIPT","NO_RECEIPT"), "receipt type"); }
  private String normalizeAttachmentKind(String value) { return normalize(value, List.of("EXPENSE_PROOF","NO_RECEIPT_EXPLANATION","PAYMENT_PROOF"), "attachment kind"); }
  private String normalize(String value, List<String> supported, String label) { String normalized = value == null ? "" : value.trim().toUpperCase(java.util.Locale.ROOT); if (!supported.contains(normalized)) throw bad("Unsupported " + label); return normalized; }
  private String blankToNull(String value) { return value == null || value.isBlank() ? null : value.trim(); }
  private ResponseStatusException bad(String message) { return new ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT, message); }
  private ResponseStatusException notFound(String message) { return new ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, message); }

  public record ExpenseCategory(UUID id, UUID parentId, String code, String name, Short categoryLevel, Boolean receiptRequired, Boolean noReceiptAllowed, Integer sortOrder) {}
  public record ClaimSummary(UUID id, String claimNo, UUID storeId, String storeName, UUID expenseCategoryId, String categoryName, LocalDate expenseDate, Long amountCents, String payeeName, String receiptType, String status, OffsetDateTime submittedAt, OffsetDateTime updatedAt) {}
  public record ClaimRow(UUID id, String claimNo, UUID storeId, String storeName, UUID applicantUserId, String applicantName, UUID expenseCategoryId, String categoryName, LocalDate expenseDate, Long amountCents, String payeeName, String paymentSource, String receiptType, String invoiceNo, String description, String noReceiptReason, String status, String duplicateWarning, OffsetDateTime submittedAt, UUID reviewedByUserId, OffsetDateTime reviewedAt, String reviewNote, OffsetDateTime createdAt, OffsetDateTime updatedAt, Long version) {}
  public record ClaimDetail(ClaimRow claim, List<Attachment> attachments, List<ReviewHistory> history) {}
  public record Attachment(UUID id, UUID claimId, String attachmentKind, String storageKey, String originalFilename, String contentType, Long fileSizeBytes, String sha256, UUID uploadedByUserId, OffsetDateTime createdAt) {}
  public record ReviewHistory(UUID id, String action, String fromStatus, String toStatus, String comment, UUID actorUserId, String actorName, OffsetDateTime createdAt) {}
  public record ClaimInput(@NotNull UUID expenseCategoryId, @NotNull LocalDate expenseDate, @NotNull @Positive Long amountCents, @Size(max = 160) String payeeName, @NotBlank String paymentSource, @NotBlank String receiptType, @Size(max = 100) String invoiceNo, @NotBlank @Size(max = 4000) String description, @Size(max = 4000) String noReceiptReason) {}
}
