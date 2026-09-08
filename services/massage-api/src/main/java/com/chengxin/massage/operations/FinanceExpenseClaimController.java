package com.chengxin.massage.operations;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.nio.charset.StandardCharsets;
import java.net.URLEncoder;
import java.util.List;
import java.util.Locale;
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
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.multipart.MultipartFile;
import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.audit.AuditService;

@RestController
@RequestMapping("/api/v1/finance/expense-claims")
@CrossOrigin(origins = "*")
public class FinanceExpenseClaimController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final AdminSessionService sessions;
  private final AuditService audits;
  private final ExpenseAttachmentStorage storage;

  FinanceExpenseClaimController(JdbcClient jdbc, AdminSessionService sessions, AuditService audits, ExpenseAttachmentStorage storage) {
    this.jdbc = jdbc;
    this.sessions = sessions;
    this.audits = audits;
    this.storage = storage;
  }

  @GetMapping
  List<FinanceClaimSummary> list(
      @RequestParam(defaultValue = "SUBMITTED") String status,
      @RequestParam(required = false) UUID storeId,
      @RequestParam(required = false) UUID applicantUserId,
      @RequestParam(required = false) String claimNo,
      @RequestParam(required = false) LocalDate from,
      @RequestParam(required = false) LocalDate to,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "EXPENSE_REVIEW");
    sessions.requirePermission(authorization, "EXPENSE_ALL_STORE_VIEW");
    String normalizedStatus = normalizeStatus(status);
    StringBuilder sql = new StringBuilder("select c.id,c.claim_no,c.store_id,s.name store_name,c.expense_category_id,coalesce(parent.name || ' / ','') || category.name category_name,c.expense_date,c.amount_cents,c.payee_name,c.receipt_type,c.status,c.submitted_at,c.updated_at,c.applicant_user_id,applicant.display_name applicant_name,(select count(*) from expense_attachment a where a.claim_id=c.id and a.active=true)::bigint attachment_count,exists(select 1 from expense_attachment a where a.claim_id=c.id and a.active=true and a.attachment_kind='EXPENSE_PROOF') has_expense_proof from expense_claim c join store s on s.id=c.store_id join app_user applicant on applicant.id=c.applicant_user_id join expense_category category on category.id=c.expense_category_id left join expense_category parent on parent.id=category.parent_id where c.tenant_id=:tenant");
    if (!normalizedStatus.isBlank()) sql.append(" and c.status=:status");
    if (storeId != null) sql.append(" and c.store_id=:store");
    if (applicantUserId != null) sql.append(" and c.applicant_user_id=:applicant");
    if (claimNo != null && !claimNo.isBlank()) sql.append(" and c.claim_no ilike :claimNo");
    if (from != null) sql.append(" and c.expense_date>=:from");
    if (to != null) sql.append(" and c.expense_date<=:to");
    sql.append(" order by c.submitted_at desc nulls last,c.updated_at desc limit 500");
    JdbcClient.StatementSpec statement = jdbc.sql(sql.toString()).param("tenant", TENANT_ID);
    if (!normalizedStatus.isBlank()) statement = statement.param("status", normalizedStatus);
    if (storeId != null) statement = statement.param("store", storeId);
    if (applicantUserId != null) statement = statement.param("applicant", applicantUserId);
    if (claimNo != null && !claimNo.isBlank()) statement = statement.param("claimNo", "%" + claimNo.trim() + "%");
    if (from != null) statement = statement.param("from", from);
    if (to != null) statement = statement.param("to", to);
    return statement.query(FinanceClaimSummary.class).list();
  }

  @GetMapping("/{id}")
  FinanceClaimDetail detail(
      @PathVariable UUID id,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "EXPENSE_REVIEW");
    sessions.requirePermission(authorization, "EXPENSE_ALL_STORE_VIEW");
    ExpenseClaimController.ClaimRow claim = claim(id);
    return detail(claim);
  }

  @GetMapping("/{claimId}/attachments/{attachmentId}")
  ResponseEntity<byte[]> attachment(
      @PathVariable UUID claimId,
      @PathVariable UUID attachmentId,
      @RequestParam(defaultValue = "false") boolean download,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "EXPENSE_REVIEW");
    sessions.requirePermission(authorization, "EXPENSE_ALL_STORE_VIEW");
    ExpenseClaimController.ClaimRow claim = claim(claimId);
    ExpenseClaimController.Attachment attachment = jdbc.sql("select id,claim_id,attachment_kind,storage_key,original_filename,content_type,file_size_bytes,sha256,uploaded_by_user_id,created_at from expense_attachment where id=:id and claim_id=:claim and store_id=:store and active=true")
      .param("id", attachmentId).param("claim", claimId).param("store", claim.storeId()).query(ExpenseClaimController.Attachment.class).optional()
      .orElseThrow(() -> notFound("Attachment not found"));
    String filename = URLEncoder.encode(attachment.originalFilename(), StandardCharsets.UTF_8).replace("+", "%20");
    MediaType mediaType = MediaType.parseMediaType(attachment.contentType());
    String disposition = download ? "attachment" : "inline";
    return ResponseEntity.ok().contentType(mediaType)
      .header(HttpHeaders.CONTENT_DISPOSITION, disposition + "; filename*=UTF-8''" + filename)
      .body(storage.read(attachment.storageKey()));
  }

  @PostMapping("/{id}/approve")
  @Transactional
  FinanceClaimDetail approve(
      @PathVariable UUID id,
      @Valid @RequestBody(required = false) ReviewInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "EXPENSE_REVIEW");
    sessions.requirePermission(authorization, "EXPENSE_ALL_STORE_VIEW");
    return review(id, "APPROVED", input == null ? null : input.comment(), authorization);
  }

  @PostMapping("/{id}/return")
  @Transactional
  FinanceClaimDetail returnClaim(
      @PathVariable UUID id,
      @Valid @RequestBody ReviewInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "EXPENSE_REVIEW");
    sessions.requirePermission(authorization, "EXPENSE_ALL_STORE_VIEW");
    requireComment(input.comment(), "A return reason is required");
    return review(id, "RETURNED", input.comment(), authorization);
  }

  @PostMapping("/{id}/reject")
  @Transactional
  FinanceClaimDetail reject(
      @PathVariable UUID id,
      @Valid @RequestBody ReviewInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "EXPENSE_REVIEW");
    sessions.requirePermission(authorization, "EXPENSE_ALL_STORE_VIEW");
    requireComment(input.comment(), "A rejection reason is required");
    return review(id, "REJECTED", input.comment(), authorization);
  }

  @PostMapping("/{id}/classify")
  @Transactional
  FinanceClaimDetail classify(
      @PathVariable UUID id,
      @Valid @RequestBody CategoryAssignmentInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "EXPENSE_REVIEW");
    sessions.requirePermission(authorization, "EXPENSE_ALL_STORE_VIEW");
    UUID actor = sessions.requireAuthenticatedUserId(authorization);
    ExpenseClaimController.ClaimRow before = claim(id);
    if (!List.of("SUBMITTED", "APPROVED").contains(before.status())) {
      throw conflict("Only submitted or approved claims can be reclassified");
    }
    CategoryInfo target = categoryInfo(input.categoryId(), true);
    if ("PENDING_FINANCE_CLASSIFICATION".equals(target.code())) throw bad("Please select a specific expense category");
    if (before.expenseCategoryId().equals(target.id())) return detail(before);
    jdbc.sql("update expense_claim set expense_category_id=:category,updated_at=now(),version=version+1 where id=:id and tenant_id=:tenant and status in ('SUBMITTED','APPROVED')")
      .param("category", target.id()).param("id", id).param("tenant", TENANT_ID).update();
    ExpenseClaimController.ClaimRow updated = claim(id);
    String comment = "分类由 " + before.categoryName() + " 调整为 " + updated.categoryName();
    if (input.comment() != null && !input.comment().isBlank()) comment += "；" + input.comment().trim();
    history(id, actor, "CLASSIFY", before.status(), updated.status(), comment, updated);
    audits.record(authorization, before.storeId(), "EXPENSE", "EXPENSE_CLAIM_CLASSIFIED", "expense_claim", id, "财务调整报销类型", before, updated);
    return detail(updated);
  }

  @PostMapping("/{id}/pay")
  @Transactional
  FinanceClaimDetail pay(
      @PathVariable UUID id,
      @Valid @RequestBody PaymentInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "EXPENSE_PAY");
    sessions.requirePermission(authorization, "EXPENSE_ALL_STORE_VIEW");
    UUID actor = sessions.requireAuthenticatedUserId(authorization);
    ExpenseClaimController.ClaimRow before = claim(id);
    if (!"APPROVED".equals(before.status())) throw conflict("Only approved claims can be paid");
    if (!before.amountCents().equals(input.amountCents())) throw bad("Payment amount must equal claim amount");
    UUID paymentId = UUID.randomUUID();
    jdbc.sql("insert into expense_payment(id,claim_id,tenant_id,store_id,amount_cents,payment_method,payment_date,payment_reference,note,created_by_user_id) values(:id,:claim,:tenant,:store,:amount,:method,:date,:reference,:note,:actor)")
      .param("id", paymentId).param("claim", id).param("tenant", TENANT_ID).param("store", before.storeId())
      .param("amount", input.amountCents()).param("method", input.paymentMethod().trim()).param("date", input.paymentDate())
      .param("reference", blankToNull(input.paymentReference())).param("note", blankToNull(input.note())).param("actor", actor).update();
    jdbc.sql("update expense_claim set status='PAID',reviewed_by_user_id=:actor,reviewed_at=now(),review_note=:note,updated_at=now(),version=version+1 where id=:id and status='APPROVED'")
      .param("id", id).param("actor", actor).param("note", blankToNull(input.note())).update();
    ExpenseClaimController.ClaimRow updated = claim(id);
    history(id, actor, "PAY", before.status(), updated.status(), input.note(), updated);
    audits.record(authorization, before.storeId(), "EXPENSE", "EXPENSE_CLAIM_PAID", "expense_claim", id, "Expense claim paid", before, updated);
    return detail(updated);
  }

  @PostMapping(path = "/{id}/payment-proof", consumes = "multipart/form-data")
  @Transactional
  ExpenseClaimController.Attachment uploadPaymentProof(
      @PathVariable UUID id,
      @RequestPart("file") MultipartFile file,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    sessions.requirePermission(authorization, "EXPENSE_PAY");
    sessions.requirePermission(authorization, "EXPENSE_ALL_STORE_VIEW");
    UUID actor = sessions.requireAuthenticatedUserId(authorization);
    ExpenseClaimController.ClaimRow claim = claim(id);
    if (!List.of("APPROVED", "PAID").contains(claim.status())) {
      throw conflict("Payment proof can only be uploaded for approved or paid claims");
    }
    Integer existing = jdbc.sql("select count(*) from expense_attachment where claim_id=:claim and store_id=:store and attachment_kind='PAYMENT_PROOF' and active=true")
      .param("claim", id).param("store", claim.storeId()).query(Integer.class).single();
    if (existing > 0) throw conflict("This claim already has a payment proof");
    ExpenseAttachmentStorage.StoredFile stored = storage.store(TENANT_ID, claim.storeId(), id, file);
    try {
      UUID attachmentId = UUID.randomUUID();
      jdbc.sql("insert into expense_attachment(id,claim_id,tenant_id,store_id,attachment_kind,storage_key,original_filename,content_type,file_size_bytes,sha256,uploaded_by_user_id) values(:id,:claim,:tenant,:store,:kind,:key,:filename,:type,:size,:sha256,:actor)")
        .param("id", attachmentId).param("claim", id).param("tenant", TENANT_ID).param("store", claim.storeId())
        .param("kind", "PAYMENT_PROOF").param("key", stored.storageKey()).param("filename", stored.originalFilename())
        .param("type", stored.contentType()).param("size", stored.fileSizeBytes()).param("sha256", stored.sha256()).param("actor", actor).update();
      ExpenseClaimController.Attachment created = jdbc.sql("select id,claim_id,attachment_kind,storage_key,original_filename,content_type,file_size_bytes,sha256,uploaded_by_user_id,created_at from expense_attachment where id=:id")
        .param("id", attachmentId).query(ExpenseClaimController.Attachment.class).single();
      audits.record(authorization, claim.storeId(), "EXPENSE", "EXPENSE_PAYMENT_PROOF_UPLOADED", "expense_attachment", attachmentId, "上传付款凭证", null, created);
      return created;
    } catch (RuntimeException exception) {
      storage.delete(stored.storageKey());
      throw exception;
    }
  }

  private FinanceClaimDetail review(UUID id, String targetStatus, String comment, String authorization) {
    UUID actor = sessions.requireAuthenticatedUserId(authorization);
    ExpenseClaimController.ClaimRow before = claim(id);
    if (!"SUBMITTED".equals(before.status())) throw conflict("Only submitted claims can be reviewed");
    if ("APPROVED".equals(targetStatus) && "PENDING_FINANCE_CLASSIFICATION".equals(categoryInfo(before.expenseCategoryId(), false).code())) {
      throw conflict("Please classify this expense claim before approval");
    }
    jdbc.sql("update expense_claim set status=:status,reviewed_by_user_id=:actor,reviewed_at=now(),review_note=:note,updated_at=now(),version=version+1 where id=:id and status='SUBMITTED'")
      .param("id", id).param("status", targetStatus).param("actor", actor).param("note", blankToNull(comment)).update();
    ExpenseClaimController.ClaimRow updated = claim(id);
    String action = "APPROVED".equals(targetStatus) ? "APPROVE" : ("RETURNED".equals(targetStatus) ? "RETURN" : "REJECT");
    history(id, actor, action, before.status(), updated.status(), comment, updated);
    audits.record(authorization, before.storeId(), "EXPENSE", "EXPENSE_CLAIM_" + action, "expense_claim", id, "Expense claim reviewed", before, updated);
    return detail(updated);
  }

  private FinanceClaimDetail detail(ExpenseClaimController.ClaimRow row) {
    List<ExpenseClaimController.Attachment> attachments = jdbc.sql("select id,claim_id,attachment_kind,storage_key,original_filename,content_type,file_size_bytes,sha256,uploaded_by_user_id,created_at from expense_attachment where claim_id=:claim and store_id=:store and active=true order by created_at")
      .param("claim", row.id()).param("store", row.storeId()).query(ExpenseClaimController.Attachment.class).list();
    List<ExpenseClaimController.ReviewHistory> history = jdbc.sql("select h.id,h.action,h.from_status,h.to_status,h.comment,h.actor_user_id,u.display_name actor_name,h.created_at from expense_review_history h join app_user u on u.id=h.actor_user_id where h.claim_id=:claim and h.store_id=:store order by h.created_at desc")
      .param("claim", row.id()).param("store", row.storeId()).query(ExpenseClaimController.ReviewHistory.class).list();
    PaymentDetail payment = jdbc.sql("select id,amount_cents,payment_method,payment_date,payment_reference,note,status,created_by_user_id,created_at from expense_payment where claim_id=:claim and store_id=:store order by created_at desc limit 1")
      .param("claim", row.id()).param("store", row.storeId()).query(PaymentDetail.class).optional().orElse(null);
    return new FinanceClaimDetail(row, attachments, history, payment);
  }

  private ExpenseClaimController.ClaimRow claim(UUID id) {
    return jdbc.sql("select c.id,c.claim_no,c.store_id,s.name store_name,c.applicant_user_id,applicant.display_name applicant_name,c.expense_category_id,coalesce(parent.name || ' / ','') || category.name category_name,c.expense_date,c.amount_cents,c.payee_name,c.payment_source,c.receipt_type,c.invoice_no,c.description,c.no_receipt_reason,c.status,c.duplicate_warning::text duplicate_warning,c.submitted_at,c.reviewed_by_user_id,c.reviewed_at,c.review_note,c.created_at,c.updated_at,c.version from expense_claim c join store s on s.id=c.store_id join app_user applicant on applicant.id=c.applicant_user_id join expense_category category on category.id=c.expense_category_id left join expense_category parent on parent.id=category.parent_id where c.id=:id and c.tenant_id=:tenant")
      .param("id", id).param("tenant", TENANT_ID).query(ExpenseClaimController.ClaimRow.class).optional().orElseThrow(() -> notFound("Expense claim not found"));
  }

  private CategoryInfo categoryInfo(UUID id, boolean activeOnly) {
    String sql = "select id,code,name,active from expense_category where id=:id and tenant_id=:tenant" + (activeOnly ? " and active=true" : "");
    return jdbc.sql(sql).param("id", id).param("tenant", TENANT_ID).query(CategoryInfo.class).optional()
      .orElseThrow(() -> bad("Expense category not found or inactive"));
  }

  private void history(UUID claimId, UUID actor, String action, String from, String to, String comment, ExpenseClaimController.ClaimRow snapshot) {
    jdbc.sql("insert into expense_review_history(id,claim_id,tenant_id,store_id,action,from_status,to_status,comment,snapshot,actor_user_id) values(:id,:claim,:tenant,:store,:action,:from,:to,:comment,cast(:snapshot as jsonb),:actor)")
      .param("id", UUID.randomUUID()).param("claim", claimId).param("tenant", TENANT_ID).param("store", snapshot.storeId()).param("action", action)
      .param("from", from).param("to", to).param("comment", blankToNull(comment)).param("snapshot", "{\"status\":\"" + to + "\",\"amountCents\":" + snapshot.amountCents() + "}").param("actor", actor).update();
  }

  private String normalizeStatus(String value) {
    if (value == null || value.isBlank()) return "";
    String normalized = value.trim().toUpperCase(Locale.ROOT);
    if (!List.of("SUBMITTED", "RETURNED", "APPROVED", "REJECTED", "PAID", "WITHDRAWN", "DRAFT").contains(normalized)) throw bad("Unsupported expense claim status");
    return normalized;
  }
  private void requireComment(String comment, String message) { if (comment == null || comment.isBlank()) throw bad(message); }
  private String blankToNull(String value) { return value == null || value.isBlank() ? null : value.trim(); }
  private ResponseStatusException bad(String message) { return new ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT, message); }
  private ResponseStatusException notFound(String message) { return new ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, message); }

  public record ReviewInput(@Size(max = 2000) String comment) {}
  public record CategoryAssignmentInput(@NotNull UUID categoryId, @Size(max = 2000) String comment) {}
  public record PaymentInput(@NotNull @Positive Long amountCents, @NotBlank @Size(max = 50) String paymentMethod, @NotNull LocalDate paymentDate, @Size(max = 160) String paymentReference, @Size(max = 2000) String note) {}
  public record FinanceClaimSummary(UUID id, String claimNo, UUID storeId, String storeName, UUID expenseCategoryId, String categoryName, LocalDate expenseDate, Long amountCents, String payeeName, String receiptType, String status, OffsetDateTime submittedAt, OffsetDateTime updatedAt, UUID applicantUserId, String applicantName, Long attachmentCount, Boolean hasExpenseProof) {}
  public record FinanceClaimDetail(ExpenseClaimController.ClaimRow claim, List<ExpenseClaimController.Attachment> attachments, List<ExpenseClaimController.ReviewHistory> history, PaymentDetail payment) {}
  public record PaymentDetail(UUID id, Long amountCents, String paymentMethod, LocalDate paymentDate, String paymentReference, String note, String status, UUID createdByUserId, OffsetDateTime createdAt) {}
  private record CategoryInfo(UUID id, String code, String name, Boolean active) {}
}
