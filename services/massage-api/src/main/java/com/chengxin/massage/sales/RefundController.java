package com.chengxin.massage.sales;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.AdminSessionService.AuthenticatedIdentity;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.BusinessClockService;

@RestController
@CrossOrigin(origins = "*")
public class RefundController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final Logger COMMISSION_LOG = LoggerFactory.getLogger("COMMISSION");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AuditService audits;
  private final BusinessClockService businessClock;
  private final AdminSessionService adminSessions;

  RefundController(JdbcClient jdbc, StoreContextService storeContext, AuditService audits, BusinessClockService businessClock, AdminSessionService adminSessions) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.audits = audits;
    this.businessClock = businessClock;
    this.adminSessions = adminSessions;
  }

  @PostMapping("/api/v1/sales-orders/{orderId}/refunds")
  @Transactional
  RefundResult create(@PathVariable UUID orderId, @Valid @RequestBody RefundInput input,
                      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    Order order = jdbc.sql("select id,member_id,status,paid_cents,order_no,business_date from sales_order where id=:id and store_id=:store for update")
      .param("id", orderId).param("store", storeId).query(Order.class).single();
    if (!"SETTLED".equals(order.status())) throw conflict("Only settled orders can be refunded");
    List<RefundResult> existing = jdbc.sql(refundResultSql("where order_id=:order and request_key=:key"))
      .param("order", orderId).param("key", input.requestKey()).query(RefundResult.class).list();
    if (!existing.isEmpty()) return existing.getFirst();
    String refundKind = refundKind(input.refundKind());
    long lineTotal = input.lines().stream().mapToLong(RefundLineInput::refundCents).sum();
    long paymentTotal = input.payments().stream().mapToLong(RefundPaymentInput::amountCents).sum();
    if (lineTotal != paymentTotal) throw bad("Refund lines and payment allocations must have the same total");
    Map<UUID, Long> requestedLineAmounts = new HashMap<>();
    for (RefundLineInput line : input.lines()) requestedLineAmounts.merge(line.orderLineId(), line.refundCents(), Long::sum);
    for (Map.Entry<UUID, Long> line : requestedLineAmounts.entrySet()) validateLine(orderId, line.getKey(), line.getValue());
    Map<UUID, Long> requestedPaymentAmounts = new HashMap<>();
    for (RefundPaymentInput payment : input.payments()) requestedPaymentAmounts.merge(payment.originalPaymentId(), payment.amountCents(), Long::sum);
    for (Map.Entry<UUID, Long> payment : requestedPaymentAmounts.entrySet()) validatePayment(orderId, payment.getKey(), payment.getValue(), input.payments());
    validateFullReversal(orderId, order, input.lines(), lineTotal);

    UUID refundId = UUID.randomUUID();
    String refundNo = "RF" + System.currentTimeMillis();
    boolean hasExternalPayment = input.payments().stream().anyMatch(payment -> !"MEMBER_BALANCE".equals(payment.paymentMethod()));
    String status = hasExternalPayment ? "PENDING" : "COMPLETED";
    OffsetDateTime createdAt = OffsetDateTime.now();
    LocalDate createdBusinessDate = businessClock.businessDate(storeId, createdAt);
    jdbc.sql("insert into sales_refund(id,tenant_id,store_id,order_id,refund_no,request_key,status,total_cents,reason,completed_at,business_date,refund_kind,requested_by_user_id,requested_by_name_snapshot,completed_by_user_id,completed_by_name_snapshot) values(:id,:tenant,:store,:order,:no,:key,:status,:total,:reason,case when :status='COMPLETED' then :completedAt else null end,case when :status='COMPLETED' then :businessDate else null end,:kind,:actor,:actorName,case when :status='COMPLETED' then :actor else null end,case when :status='COMPLETED' then :actorName else null end)")
      .param("id", refundId).param("tenant", TENANT_ID).param("store", storeId).param("order", orderId).param("no", refundNo)
      .param("key", input.requestKey()).param("status", status).param("total", lineTotal).param("reason", input.reason().trim()).param("completedAt", createdAt).param("businessDate", createdBusinessDate)
      .param("kind", refundKind).param("actor", actor.userId()).param("actorName", actor.displayName()).update();
    for (RefundLineInput line : input.lines()) jdbc.sql("insert into sales_refund_line(id,refund_id,order_line_id,quantity,refund_cents) values(:id,:refund,:line,:quantity,:amount)")
      .param("id", UUID.randomUUID()).param("refund", refundId).param("line", line.orderLineId()).param("quantity", line.quantity()).param("amount", line.refundCents()).update();
    for (RefundPaymentInput payment : input.payments()) createPayment(storeId, refundId, order, refundNo, payment, createdBusinessDate, !hasExternalPayment);
    if ("COMPLETED".equals(status)) createCommissionAdjustments(storeId, refundId, refundNo, createdAt, createdBusinessDate);
    updateOrderRefundStatus(orderId);
    RefundResult created = find(storeId, refundId);
    audits.record(authorization, storeId, "REFUND", "REFUND_CREATED", "sales_refund", refundId,
      "Refund created", null, created);
    return created;
  }

  @GetMapping("/api/v1/sales-orders/{orderId}/refunds")
  List<RefundDetail> list(@PathVariable UUID orderId,
                          @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                          @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql("select r.id,r.refund_no,r.refund_kind,r.status,r.total_cents,r.signed_total_cents,r.reason,r.business_date,r.requested_by_name_snapshot,r.completed_by_name_snapshot,r.created_at,r.completed_at from sales_refund r join sales_order o on o.id=r.order_id where r.order_id=:order and o.store_id=:store order by r.created_at desc")
      .param("order", orderId).param("store", storeId).query(RefundDetail.class).list();
  }

  @GetMapping("/api/v1/refunds/{refundId}")
  RefundView detail(@PathVariable UUID refundId,
                    @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                    @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    RefundDetail refund = refundDetail(storeId, refundId);
    List<RefundLine> lines = jdbc.sql("select rl.id,rl.order_line_id,rl.quantity,rl.refund_cents from sales_refund_line rl where rl.refund_id=:refund")
      .param("refund", refundId).query(RefundLine.class).list();
    List<RefundPaymentView> payments = jdbc.sql("select id,original_payment_id,payment_method,amount_cents,status,created_at,completed_at from refund_payment_record where refund_id=:refund order by created_at")
      .param("refund", refundId).query(RefundPaymentView.class).list();
    return new RefundView(refund, lines, payments);
  }

  @GetMapping("/api/v1/refunds")
  List<RefundManagementRow> managementList(@RequestParam(defaultValue = "ALL") String status,
                                            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                            @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    if (!List.of("ALL", "PENDING", "COMPLETED", "CANCELLED").contains(status)) throw bad("Unsupported refund status");
    List<RefundListRow> rows = jdbc.sql("select r.id,r.order_id,r.refund_no,r.refund_kind,r.status,r.total_cents,r.signed_total_cents,r.reason,r.requested_by_name_snapshot,r.completed_by_name_snapshot,r.created_at,r.completed_at,o.order_no,m.name member_name,m.phone member_phone from sales_refund r join sales_order o on o.id=r.order_id left join member m on m.id=o.member_id where r.store_id=:store and (:status='ALL' or r.status=:status) order by r.created_at desc limit 200")
      .param("store", storeId).param("status", status).query(RefundListRow.class).list();
    return rows.stream().map(row -> new RefundManagementRow(row, jdbc.sql("select id,payment_method,amount_cents,status from refund_payment_record where refund_id=:refund order by created_at")
      .param("refund", row.id()).query(RefundPaymentSummary.class).list())).toList();
  }

  @PostMapping("/api/v1/refunds/{refundId}/payments/{refundPaymentId}/complete")
  @Transactional
  RefundResult completeExternalPayment(@PathVariable UUID refundId, @PathVariable UUID refundPaymentId,
                                       @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                       @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    ensureRefundStore(storeId, refundId);
    RefundPayment payment = jdbc.sql("select id,refund_id,payment_method,status from refund_payment_record where id=:id and refund_id=:refund for update")
      .param("id", refundPaymentId).param("refund", refundId).query(RefundPayment.class).single();
    if (!"PENDING".equals(payment.status())) return find(storeId, refundId);
    if ("MEMBER_BALANCE".equals(payment.paymentMethod())) throw bad("Member balance refunds are completed automatically");
    RefundResult before = find(storeId, refundId);
    jdbc.sql("update refund_payment_record set status='COMPLETED',completed_at=now() where id=:id").param("id", refundPaymentId).update();
    completeRefundWhenReady(storeId, refundId, actor);
    RefundResult completed = find(storeId, refundId);
    audits.record(authorization, storeId, "REFUND", "REFUND_PAYMENT_COMPLETED", "refund_payment", refundPaymentId,
      "Refund payment completed", before, completed);
    return completed;
  }

  @PostMapping("/api/v1/refunds/{refundId}/cancel")
  @Transactional
  RefundResult cancel(@PathVariable UUID refundId,
                      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    RefundForUpdate refund = jdbc.sql("select id,order_id,status from sales_refund where id=:id and store_id=:store for update")
      .param("id", refundId).param("store", storeId).query(RefundForUpdate.class).single();
    if ("CANCELLED".equals(refund.status())) return find(storeId, refundId);
    RefundResult before = find(storeId, refundId);
    int completed = jdbc.sql("select count(*) from refund_payment_record where refund_id=:refund and status='COMPLETED'")
      .param("refund", refundId).query(Integer.class).single();
    if (completed > 0) throw conflict("A refund with completed payments cannot be cancelled");
    jdbc.sql("update sales_refund set status='CANCELLED' where id=:id").param("id", refundId).update();
    updateOrderRefundStatus(refund.orderId());
    RefundResult cancelled = find(storeId, refundId);
    audits.record(authorization, storeId, "REFUND", "REFUND_CANCELLED", "sales_refund", refundId,
      "Refund cancelled", before, cancelled);
    return cancelled;
  }

  private RefundDetail refundDetail(UUID storeId, UUID refundId) {
    return jdbc.sql("select r.id,r.refund_no,r.refund_kind,r.status,r.total_cents,r.signed_total_cents,r.reason,r.business_date,r.requested_by_name_snapshot,r.completed_by_name_snapshot,r.created_at,r.completed_at from sales_refund r join sales_order o on o.id=r.order_id where r.id=:id and o.store_id=:store")
      .param("id", refundId).param("store", storeId).query(RefundDetail.class).single();
  }

  private void ensureRefundStore(UUID storeId, UUID refundId) {
    boolean exists = jdbc.sql("select exists(select 1 from sales_refund where id=:id and store_id=:store)")
      .param("id", refundId).param("store", storeId).query(Boolean.class).single();
    if (!exists) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Refund not found");
  }

  private void validateLine(UUID orderId, UUID lineId, long requestedAmount) {
    OrderLine line = jdbc.sql("select id,line_amount_cents from sales_order_line where id=:id and order_id=:order")
      .param("id", lineId).param("order", orderId).query(OrderLine.class).single();
    long prior = jdbc.sql("select coalesce(sum(rl.refund_cents),0) from sales_refund_line rl join sales_refund r on r.id=rl.refund_id where rl.order_line_id=:line and r.status <> 'CANCELLED'")
      .param("line", line.id()).query(Long.class).single();
    if (requestedAmount > line.lineAmountCents() - prior) throw conflict("Refund amount exceeds remaining amount for an order line");
  }

  private void validatePayment(UUID orderId, UUID paymentId, long requestedAmount, List<RefundPaymentInput> requestedPayments) {
    OriginalPayment payment = jdbc.sql("select id,payment_method,amount_cents from payment_record where id=:id and order_id=:order")
      .param("id", paymentId).param("order", orderId).query(OriginalPayment.class).single();
    if (requestedPayments.stream().filter(item -> paymentId.equals(item.originalPaymentId())).anyMatch(item -> !payment.paymentMethod().equals(item.paymentMethod()))) throw bad("Refund payment method does not match original payment");
    long prior = jdbc.sql("select coalesce(sum(rp.amount_cents),0) from refund_payment_record rp join sales_refund r on r.id=rp.refund_id where rp.original_payment_id=:payment and r.status <> 'CANCELLED'")
      .param("payment", payment.id()).query(Long.class).single();
    if (requestedAmount > payment.amountCents() - prior) throw conflict("Refund amount exceeds remaining amount for an original payment");
  }

  private void createPayment(UUID storeId, UUID refundId, Order order, String refundNo, RefundPaymentInput input, LocalDate businessDate, boolean autoCompleteMember) {
    boolean memberBalance = "MEMBER_BALANCE".equals(input.paymentMethod());
    String status = memberBalance && autoCompleteMember ? "COMPLETED" : "PENDING";
    jdbc.sql("insert into refund_payment_record(id,tenant_id,store_id,refund_id,original_payment_id,payment_method,amount_cents,status,completed_at) values(:id,:tenant,:store,:refund,:original,:method,:amount,:status,case when :status='COMPLETED' then now() else null end)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("refund", refundId).param("original", input.originalPaymentId())
      .param("method", input.paymentMethod()).param("amount", input.amountCents()).param("status", status).update();
    if (memberBalance && autoCompleteMember) restoreWallet(storeId, order.memberId(), input.amountCents(), refundNo, businessDate);
  }

  private void restoreWallet(UUID transactionStoreId, UUID memberId, long amount, String refundNo, LocalDate businessDate) {
    if (memberId == null) throw bad("The original order has no member balance to restore");
    Wallet wallet = jdbc.sql("select w.id,w.balance_cents from member_wallet w join member m on m.id=w.member_id where w.member_id=:member and m.tenant_id=:tenant for update")
      .param("member", memberId).param("tenant", TENANT_ID).query(Wallet.class).single();
    long after = wallet.balanceCents() + amount;
    jdbc.sql("update member_wallet set balance_cents=:balance,updated_at=now(),version=version+1 where id=:id")
      .param("balance", after).param("id", wallet.id()).update();
    jdbc.sql("insert into wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,note,business_date) values(:id,:tenant,:store,:wallet,:member,'REFUND',:amount,:before,:after,'ORDER_REFUND',:note,:businessDate)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", transactionStoreId).param("wallet", wallet.id()).param("member", memberId)
      .param("amount", amount).param("before", wallet.balanceCents()).param("after", after).param("note", refundNo).param("businessDate", businessDate).update();
  }

  private void completeRefundWhenReady(UUID storeId, UUID refundId, AuthenticatedIdentity actor) {
    RefundCompletion refund = jdbc.sql("select r.id,r.order_id,r.refund_no,r.status,r.refund_kind,o.member_id from sales_refund r join sales_order o on o.id=r.order_id where r.id=:id and r.store_id=:store for update of r")
      .param("id", refundId).param("store", storeId).query(RefundCompletion.class).single();
    int pendingExternal = jdbc.sql("select count(*) from refund_payment_record where refund_id=:refund and status='PENDING' and payment_method<>'MEMBER_BALANCE'").param("refund", refundId).query(Integer.class).single();
    if (pendingExternal == 0 && "PENDING".equals(refund.status())) {
      OffsetDateTime completedAt = OffsetDateTime.now();
      LocalDate businessDate = businessClock.businessDate(storeId, completedAt);
      List<MemberRefundPayment> memberPayments = jdbc.sql("select id,amount_cents from refund_payment_record where refund_id=:refund and payment_method='MEMBER_BALANCE' and status='PENDING' for update")
        .param("refund", refundId).query(MemberRefundPayment.class).list();
      for (MemberRefundPayment payment : memberPayments) {
        restoreWallet(storeId, refund.memberId(), payment.amountCents(), refund.refundNo(), businessDate);
        jdbc.sql("update refund_payment_record set status='COMPLETED',completed_at=:completed where id=:id")
          .param("completed", completedAt).param("id", payment.id()).update();
      }
      jdbc.sql("update sales_refund set status='COMPLETED',completed_at=:completedAt,business_date=:businessDate,completed_by_user_id=:actor,completed_by_name_snapshot=:actorName where id=:id and status='PENDING'")
        .param("completedAt", completedAt).param("businessDate", businessDate).param("actor", actor.userId()).param("actorName", actor.displayName()).param("id", refundId).update();
      if (!"FULL_REVERSAL".equals(refund.refundKind())) throw conflict("部分退款流程已停用，请取消申请后重新提交整单退款");
      createCommissionAdjustments(storeId, refundId, refund.refundNo(), completedAt, businessDate);
      updateOrderRefundStatus(refund.orderId());
    }
  }

  private void updateOrderRefundStatus(UUID orderId) {
    long paid = jdbc.sql("select paid_cents from sales_order where id=:id for update").param("id", orderId).query(Long.class).single();
    long refunded = jdbc.sql("select coalesce(sum(total_cents),0) from sales_refund where order_id=:order and status='COMPLETED'").param("order", orderId).query(Long.class).single();
    String status = refunded == 0 ? "NONE" : refunded == paid ? "FULL" : "PARTIAL";
    jdbc.sql("update sales_order set refund_status=:status where id=:id").param("status", status).param("id", orderId).update();
  }

  private RefundResult find(UUID storeId, UUID refundId) {
    return jdbc.sql(refundResultSql("where id=:id and store_id=:store"))
      .param("id", refundId).param("store", storeId).query(RefundResult.class).single();
  }

  private String refundResultSql(String where) {
    return "select id,refund_no,refund_kind,status,total_cents,signed_total_cents,requested_by_name_snapshot,completed_by_name_snapshot,created_at,completed_at from sales_refund " + where;
  }

  private String refundKind(String value) {
    String kind = value == null || value.isBlank() ? "FULL_REVERSAL" : value.trim().toUpperCase();
    if (!"FULL_REVERSAL".equals(kind)) throw bad("订单退款只支持整单退款");
    return kind;
  }

  private void validateFullReversal(UUID orderId, Order order, List<RefundLineInput> requestedLines, long requestedTotal) {
    long priorPaid = jdbc.sql("select coalesce(sum(payment.amount_cents),0) from refund_payment_record payment join sales_refund refund on refund.id=payment.refund_id where refund.order_id=:order and refund.status<>'CANCELLED'")
      .param("order", order.id()).query(Long.class).single();
    long remainingPaid = order.paidCents() - priorPaid;
    if (requestedTotal != remainingPaid) throw conflict("A full reversal must refund the entire remaining paid amount");

    List<RefundableLine> remainingLines = jdbc.sql("select line.id,line.line_amount_cents-coalesce((select sum(refund_line.refund_cents) from sales_refund_line refund_line join sales_refund refund on refund.id=refund_line.refund_id where refund_line.order_line_id=line.id and refund.status<>'CANCELLED'),0) remaining_cents from sales_order_line line where line.order_id=:order")
      .param("order", orderId).query(RefundableLine.class).list();
    Set<UUID> requestedIds = new java.util.HashSet<>();
    for (RefundLineInput line : requestedLines) requestedIds.add(line.orderLineId());
    for (RefundableLine line : remainingLines) {
      if (line.remainingCents() > 0 && !requestedIds.contains(line.id())) {
        throw conflict("A full reversal must include every remaining order item");
      }
    }
  }

  private void createCommissionAdjustments(UUID storeId, UUID refundId, String refundNo, OffsetDateTime completedAt, LocalDate businessDate) {
    COMMISSION_LOG.info("refund.createCommissionAdjustments entry storeId={} refundId={} refundNo={} completedAt={} businessDate={}", storeId, refundId, refundNo, completedAt, businessDate);
    List<CompletedRefundLine> lines = List.of();
    try {
      lines = jdbc.sql("select refund_line.order_line_id,refund_line.refund_cents,order_line.line_amount_cents from sales_refund_line refund_line join sales_order_line order_line on order_line.id=refund_line.order_line_id where refund_line.refund_id=:refund")
        .param("refund", refundId).query(CompletedRefundLine.class).list();
      COMMISSION_LOG.info("refund.createCommissionAdjustments lines count={} values={}", lines.size(), lines);
      for (CompletedRefundLine line : lines) {
        List<OriginalCommission> originals = jdbc.sql("select record.id,record.tenant_id,record.store_id,record.order_id,record.order_line_id,record.service_session_id,record.service_session_extension_id,record.service_item_id,record.technician_id,record.source_type,record.clock_type,record.order_no_snapshot,record.technician_name_snapshot,record.service_name_snapshot,record.rule_type,record.rule_rate_bp,record.rule_fixed_cents,record.base_amount_cents,record.commission_cents,record.clock_count_adjustment,record.duration_minutes_adjustment,record.service_participant_id,record.allocation_bp_snapshot,record.served_seconds_snapshot,record.commission_tier_policy_version_id,record.commission_tier_id,record.commission_tier_name_snapshot,record.commission_tier_minimum_clock_count_snapshot,record.commission_multiplier_bp_snapshot,record.monthly_clock_count_snapshot from technician_commission_record record where record.order_line_id=:line and record.record_type in ('SETTLEMENT','BUSINESS_CORRECTION') and not exists(select 1 from technician_commission_record correction_reversal where correction_reversal.original_commission_record_id=record.id and correction_reversal.record_type='BUSINESS_CORRECTION_REVERSAL') order by record.created_at,record.id")
          .param("line", line.orderLineId()).query(OriginalCommission.class).list();
        COMMISSION_LOG.info("refund.createCommissionAdjustments line orderLineId={} refundCents={} lineAmountCents={} originals={}", line.orderLineId(), line.refundCents(), line.lineAmountCents(), originals.size());
        for (OriginalCommission original : originals) createCommissionAdjustment(refundId, refundNo, completedAt, businessDate, line, original);
      }
      COMMISSION_LOG.info("refund.createCommissionAdjustments exit refundId={} lineCount={}", refundId, lines.size());
    } catch (RuntimeException exception) {
      COMMISSION_LOG.error("refund.createCommissionAdjustments exception state={storeId=" + storeId + ", refundId=" + refundId + ", refundNo=" + refundNo + ", businessDate=" + businessDate + ", lines=" + lines + "}", exception);
      throw exception;
    }
  }

  private void createCommissionAdjustment(UUID refundId, String refundNo, OffsetDateTime completedAt, LocalDate businessDate,
                                          CompletedRefundLine line, OriginalCommission original) {
    COMMISSION_LOG.info("refund.createCommissionAdjustment entry refundId={} refundNo={} businessDate={} line={} original={}", refundId, refundNo, businessDate, line, original);
    AdjustmentTotals existing = null;
    long targetBase = 0, targetCommission = 0, baseDelta = 0, commissionDelta = 0;
    int targetClock = 0, targetDuration = 0, clockDelta = 0, durationDelta = 0;
    try {
      existing = jdbc.sql("select coalesce(-sum(base_amount_cents),0) base_cents,coalesce(-sum(commission_cents),0) commission_cents,coalesce(-sum(clock_count_adjustment),0) clock_count,coalesce(-sum(duration_minutes_adjustment),0) duration_minutes from technician_commission_record where original_commission_record_id=:original and record_type='REFUND_REVERSAL'")
        .param("original", original.id()).query(AdjustmentTotals.class).single();
      targetBase = original.baseAmountCents();
      targetCommission = original.commissionCents();
      targetClock = original.clockCountAdjustment();
      targetDuration = original.durationMinutesAdjustment();
      baseDelta = Math.max(0, targetBase - existing.baseCents());
      commissionDelta = Math.max(0, targetCommission - existing.commissionCents());
      clockDelta = Math.max(0, targetClock - existing.clockCount());
      durationDelta = Math.max(0, targetDuration - existing.durationMinutes());
      COMMISSION_LOG.info("refund.createCommissionAdjustment totals existing={} targetBase={} targetCommission={} targetClock={} targetDuration={} deltas={base={},commission={},clock={},duration={}}",
        existing, targetBase, targetCommission, targetClock, targetDuration, baseDelta, commissionDelta, clockDelta, durationDelta);
      if (baseDelta == 0 && commissionDelta == 0 && clockDelta == 0 && durationDelta == 0) {
        COMMISSION_LOG.info("refund.createCommissionAdjustment exit no-op originalId={} reason=already-adjusted", original.id());
        return;
      }
      int rows = jdbc.sql("insert into technician_commission_record(id,tenant_id,store_id,order_id,order_line_id,service_session_id,service_session_extension_id,service_item_id,technician_id,source_type,clock_type,order_no_snapshot,settlement_no_snapshot,technician_name_snapshot,service_name_snapshot,rule_type,rule_rate_bp,rule_fixed_cents,base_amount_cents,commission_cents,settled_at,business_date,record_type,refund_id,original_commission_record_id,clock_count_adjustment,duration_minutes_adjustment,service_participant_id,allocation_bp_snapshot,served_seconds_snapshot,commission_tier_policy_version_id,commission_tier_id,commission_tier_name_snapshot,commission_tier_minimum_clock_count_snapshot,commission_multiplier_bp_snapshot,monthly_clock_count_snapshot) values(:id,:tenant,:store,:order,:line,:session,:extension,:service,:technician,:source,:clockType,:orderNo,:refundNo,:technicianName,:serviceName,:ruleType,:rate,:fixed,:base,:commission,:settled,:businessDate,'REFUND_REVERSAL',:refund,:original,:clock,:duration,:participant,:allocation,:servedSeconds,:tierPolicy,:tier,:tierName,:tierMinimum,:tierMultiplier,:monthlyClockCount) on conflict do nothing")
        .param("id", UUID.randomUUID()).param("tenant", original.tenantId()).param("store", original.storeId()).param("order", original.orderId()).param("line", original.orderLineId())
        .param("session", original.serviceSessionId()).param("extension", original.serviceSessionExtensionId()).param("service", original.serviceItemId()).param("technician", original.technicianId())
        .param("source", original.sourceType()).param("clockType", original.clockType()).param("orderNo", original.orderNoSnapshot()).param("refundNo", refundNo)
        .param("technicianName", original.technicianNameSnapshot()).param("serviceName", original.serviceNameSnapshot()).param("ruleType", original.ruleType()).param("rate", original.ruleRateBp()).param("fixed", original.ruleFixedCents())
        .param("base", -baseDelta).param("commission", -commissionDelta).param("settled", completedAt).param("businessDate", businessDate).param("refund", refundId).param("original", original.id()).param("clock", -clockDelta).param("duration", -durationDelta)
        .param("participant", original.serviceParticipantId()).param("allocation", original.allocationBpSnapshot()).param("servedSeconds", original.servedSecondsSnapshot())
        .param("tierPolicy", original.commissionTierPolicyVersionId()).param("tier", original.commissionTierId()).param("tierName", original.commissionTierNameSnapshot()).param("tierMinimum", original.commissionTierMinimumClockCountSnapshot()).param("tierMultiplier", original.commissionMultiplierBpSnapshot()).param("monthlyClockCount", original.monthlyClockCountSnapshot()).update();
      COMMISSION_LOG.info("refund.createCommissionAdjustment exit rows={} originalId={} refundId={} signedBase={} signedCommission={} signedClock={} signedDuration={}", rows, original.id(), refundId, -baseDelta, -commissionDelta, -clockDelta, -durationDelta);
    } catch (RuntimeException exception) {
      COMMISSION_LOG.error("refund.createCommissionAdjustment exception state={refundId=" + refundId + ", refundNo=" + refundNo + ", businessDate=" + businessDate + ", line=" + line + ", original=" + original + ", existing=" + existing + ", targetBase=" + targetBase + ", targetCommission=" + targetCommission + ", targetClock=" + targetClock + ", targetDuration=" + targetDuration + ", baseDelta=" + baseDelta + ", commissionDelta=" + commissionDelta + ", clockDelta=" + clockDelta + ", durationDelta=" + durationDelta + "}", exception);
      throw exception;
    }
  }

  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }

  record Order(UUID id, UUID memberId, String status, Long paidCents, String orderNo, LocalDate businessDate) {}
  record OrderLine(UUID id, Long lineAmountCents) {}
  record RefundableLine(UUID id, Long remainingCents) {}
  record OriginalPayment(UUID id, String paymentMethod, Long amountCents) {}
  record Wallet(UUID id, Long balanceCents) {}
  record RefundPayment(UUID id, UUID refundId, String paymentMethod, String status) {}
  record RefundForUpdate(UUID id, UUID orderId, String status) {}
  record RefundCompletion(UUID id, UUID orderId, String refundNo, String status, String refundKind, UUID memberId) {}
  record MemberRefundPayment(UUID id, Long amountCents) {}
  record RefundResult(UUID id, String refundNo, String refundKind, String status, Long totalCents, Long signedTotalCents, String requestedByNameSnapshot, String completedByNameSnapshot, OffsetDateTime createdAt, OffsetDateTime completedAt) {}
  record RefundDetail(UUID id, String refundNo, String refundKind, String status, Long totalCents, Long signedTotalCents, String reason, LocalDate businessDate, String requestedByNameSnapshot, String completedByNameSnapshot, OffsetDateTime createdAt, OffsetDateTime completedAt) {}
  record RefundListRow(UUID id, UUID orderId, String refundNo, String refundKind, String status, Long totalCents, Long signedTotalCents, String reason, String requestedByNameSnapshot, String completedByNameSnapshot, OffsetDateTime createdAt, OffsetDateTime completedAt, String orderNo, String memberName, String memberPhone) {}
  record RefundPaymentSummary(UUID id, String paymentMethod, Long amountCents, String status) {}
  record RefundManagementRow(RefundListRow refund, List<RefundPaymentSummary> payments) {}
  record RefundLine(UUID id, UUID orderLineId, Short quantity, Long refundCents) {}
  record RefundPaymentView(UUID id, UUID originalPaymentId, String paymentMethod, Long amountCents, String status, OffsetDateTime createdAt, OffsetDateTime completedAt) {}
  record RefundView(RefundDetail refund, List<RefundLine> lines, List<RefundPaymentView> payments) {}
  record CompletedRefundLine(UUID orderLineId, Long refundCents, Long lineAmountCents) {}
  record OriginalCommission(UUID id, UUID tenantId, UUID storeId, UUID orderId, UUID orderLineId, UUID serviceSessionId, UUID serviceSessionExtensionId, UUID serviceItemId, UUID technicianId, String sourceType, String clockType, String orderNoSnapshot, String technicianNameSnapshot, String serviceNameSnapshot, String ruleType, Integer ruleRateBp, Long ruleFixedCents, Long baseAmountCents, Long commissionCents, Short clockCountAdjustment, Short durationMinutesAdjustment, UUID serviceParticipantId, Integer allocationBpSnapshot, Integer servedSecondsSnapshot, UUID commissionTierPolicyVersionId, UUID commissionTierId, String commissionTierNameSnapshot, Integer commissionTierMinimumClockCountSnapshot, Integer commissionMultiplierBpSnapshot, Integer monthlyClockCountSnapshot) {}
  record AdjustmentTotals(Long baseCents, Long commissionCents, Integer clockCount, Integer durationMinutes) {}
  record RefundInput(@NotNull UUID requestKey, String refundKind, @NotBlank @Size(max=240) String reason, @NotEmpty List<@Valid RefundLineInput> lines, @NotEmpty List<@Valid RefundPaymentInput> payments) {}
  record RefundLineInput(@NotNull UUID orderLineId, @NotNull @Min(1) Short quantity, @NotNull @Min(1) Long refundCents) {}
  record RefundPaymentInput(@NotNull UUID originalPaymentId, @NotBlank String paymentMethod, @NotNull @Min(1) Long amountCents) {}
}
