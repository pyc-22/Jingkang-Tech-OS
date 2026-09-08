package com.chengxin.massage.member;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
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
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.AdminSessionService.AuthenticatedIdentity;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.BusinessClockService;

@RestController
@RequestMapping("/api/v1/member-recharge-refunds")
@CrossOrigin(origins = "*")
public class MemberRechargeRefundController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final AuditService audits;
  private final BusinessClockService businessClock;

  MemberRechargeRefundController(JdbcClient jdbc, StoreContextService storeContext, AdminSessionService adminSessions, AuditService audits, BusinessClockService businessClock) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.audits = audits;
    this.businessClock = businessClock;
  }

  @GetMapping
  List<RefundRow> list(@RequestParam(defaultValue = "") String status, @RequestParam(required = false) UUID memberId,
                       @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                       @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID store = storeContext.currentStore(authorization, requestedStoreId);
    String normalized = status.isBlank() ? "ALL" : status.trim().toUpperCase();
    if (!List.of("ALL", "PENDING", "COMPLETED", "CANCELLED").contains(normalized)) throw bad("Unsupported refund status");
    return jdbc.sql("select r.id,r.member_id,m.name member_name,m.phone member_phone,r.original_transaction_id,r.refund_no,r.status,r.amount_cents,r.bonus_reclaim_cents,r.reason,r.requested_by_name_snapshot,r.completed_by_name_snapshot,r.created_at,r.completed_at from member_recharge_refund r join member m on m.id=r.member_id where r.store_id=:store and (:status='ALL' or r.status=:status) and (cast(:member as uuid) is null or r.member_id=cast(:member as uuid)) order by r.created_at desc limit 200")
      .param("store", store).param("status", normalized).param("member", memberId).query(RefundRow.class).list();
  }

  @PostMapping
  @Transactional
  RefundRow create(@Valid @RequestBody CreateInput input,
                   @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                   @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID store = storeContext.currentStore(authorization, requestedStoreId);
    AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    RefundRow existing = jdbc.sql(refundSql("where r.store_id=:store and r.request_key=:key"))
      .param("store", store).param("key", input.requestKey()).query(RefundRow.class).optional().orElse(null);
    if (existing != null) return existing;
    RechargeTransaction original = jdbc.sql("select wt.id,wt.member_id,wt.amount_cents,coalesce((select sum(b.amount_cents) from wallet_transaction b where b.member_id=wt.member_id and b.store_id=wt.store_id and b.transaction_type='BONUS' and b.created_at>=wt.created_at and b.created_at<=wt.created_at+interval '2 seconds'),0) bonus_amount_cents from wallet_transaction wt join member m on m.id=wt.member_id where wt.id=:transaction and wt.store_id=:store and wt.transaction_type='RECHARGE' and m.id=:member")
      .param("transaction", input.originalTransactionId()).param("store", store).param("member", input.memberId()).query(RechargeTransaction.class).optional().orElseThrow(() -> bad("Original recharge transaction is unavailable"));
    long prior = jdbc.sql("select coalesce(sum(amount_cents),0) from member_recharge_refund where original_transaction_id=:transaction and status <> 'CANCELLED'").param("transaction", original.id()).query(Long.class).single();
    if (input.amountCents() > original.amountCents() - prior) throw conflict("Refund amount exceeds remaining recharge amount");
    long bonusReclaim = Math.min(original.bonusAmountCents(), (original.bonusAmountCents() * input.amountCents()) / original.amountCents());
    UUID id = UUID.randomUUID(); String refundNo = "MRF" + System.currentTimeMillis();
    jdbc.sql("insert into member_recharge_refund(id,tenant_id,store_id,member_id,original_transaction_id,refund_no,request_key,status,amount_cents,bonus_reclaim_cents,reason,requested_by_user_id,requested_by_name_snapshot) values(:id,:tenant,:store,:member,:transaction,:no,:key,'PENDING',:amount,:bonus,:reason,:actor,:actorName)")
      .param("id", id).param("tenant", TENANT_ID).param("store", store).param("member", input.memberId()).param("transaction", original.id()).param("no", refundNo).param("key", input.requestKey()).param("amount", input.amountCents()).param("bonus", bonusReclaim).param("reason", input.reason().trim()).param("actor", actor.userId()).param("actorName", actor.displayName()).update();
    RefundRow created = find(store, id);
    audits.record(authorization, store, "MEMBER", "RECHARGE_REFUND_CREATED", "member_recharge_refund", id, "会员充值退款申请", null, created);
    return created;
  }

  @PostMapping("/{id}/complete")
  @Transactional
  RefundRow complete(@PathVariable UUID id,
                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID store = storeContext.currentStore(authorization, requestedStoreId);
    AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    RefundForUpdate refund = jdbc.sql("select r.id,r.member_id,r.refund_no,r.status,r.amount_cents,r.bonus_reclaim_cents,wt.payment_method,wt.payment_method_name_snapshot from member_recharge_refund r join wallet_transaction wt on wt.id=r.original_transaction_id where r.id=:id and r.store_id=:store for update of r").param("id", id).param("store", store).query(RefundForUpdate.class).single();
    if (!"PENDING".equals(refund.status())) return find(store, id);
    Wallet wallet = jdbc.sql("select w.id,w.balance_cents from member_wallet w where w.member_id=:member for update").param("member", refund.memberId()).query(Wallet.class).single();
    long totalDeduction = refund.amountCents() + refund.bonusReclaimCents();
    if (wallet.balanceCents() < totalDeduction) throw conflict("Member balance is insufficient for this refund");
    long after = wallet.balanceCents() - totalDeduction;
    jdbc.sql("update member_wallet set balance_cents=:after,updated_at=now(),version=version+1 where id=:id").param("after", after).param("id", wallet.id()).update();
    LocalDate date = businessClock.businessDate(store, OffsetDateTime.now());
    jdbc.sql("insert into wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,payment_method,payment_method_name_snapshot,source,note,business_date) values(:id,:tenant,:store,:wallet,:member,'ADJUSTMENT',:amount,:before,:after,:payment,:paymentName,'RECHARGE_REFUND',:note,:date)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", store).param("wallet", wallet.id()).param("member", refund.memberId()).param("amount", -refund.amountCents()).param("before", wallet.balanceCents()).param("after", after).param("payment", refund.paymentMethod()).param("paymentName", refund.paymentMethodNameSnapshot()).param("note", refund.refundNo()).param("date", date).update();
    if (refund.bonusReclaimCents() > 0) jdbc.sql("insert into wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,note,business_date) values(:id,:tenant,:store,:wallet,:member,'ADJUSTMENT',:amount,:before,:after,'RECHARGE_REFUND_BONUS',:note,:date)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", store).param("wallet", wallet.id()).param("member", refund.memberId()).param("amount", -refund.bonusReclaimCents()).param("before", wallet.balanceCents()-refund.amountCents()).param("after", after).param("note", refund.refundNo()).param("date", date).update();
    jdbc.sql("update member_recharge_refund set status='COMPLETED',completed_by_user_id=:actor,completed_by_name_snapshot=:actorName,completed_at=now(),business_date=:date where id=:id")
      .param("actor", actor.userId()).param("actorName", actor.displayName()).param("date", date).param("id", id).update();
    RefundRow completed = find(store, id);
    audits.record(authorization, store, "MEMBER", "RECHARGE_REFUND_COMPLETED", "member_recharge_refund", id, "会员充值退款完成", null, completed);
    return completed;
  }

  @PostMapping("/{id}/cancel")
  @Transactional
  RefundRow cancel(@PathVariable UUID id,
                   @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                   @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID store = storeContext.currentStore(authorization, requestedStoreId);
    AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    RefundForUpdate refund = jdbc.sql("select r.id,r.member_id,r.refund_no,r.status,r.amount_cents,r.bonus_reclaim_cents,wt.payment_method,wt.payment_method_name_snapshot from member_recharge_refund r join wallet_transaction wt on wt.id=r.original_transaction_id where r.id=:id and r.store_id=:store for update of r").param("id", id).param("store", store).query(RefundForUpdate.class).single();
    if ("COMPLETED".equals(refund.status())) throw conflict("Completed refund cannot be cancelled");
    if ("PENDING".equals(refund.status())) jdbc.sql("update member_recharge_refund set status='CANCELLED' where id=:id").param("id", id).update();
    RefundRow cancelled = find(store, id); audits.record(authorization, store, "MEMBER", "RECHARGE_REFUND_CANCELLED", "member_recharge_refund", id, "会员充值退款取消", null, cancelled); return cancelled;
  }

  private RefundRow find(UUID store, UUID id) { return jdbc.sql(refundSql("where r.store_id=:store and r.id=:id")).param("store", store).param("id", id).query(RefundRow.class).single(); }
  private String refundSql(String where) { return "select r.id,r.member_id,m.name member_name,m.phone member_phone,r.original_transaction_id,r.refund_no,r.status,r.amount_cents,r.bonus_reclaim_cents,r.reason,r.requested_by_name_snapshot,r.completed_by_name_snapshot,r.created_at,r.completed_at from member_recharge_refund r join member m on m.id=r.member_id " + where; }
  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }

  record CreateInput(@NotNull UUID memberId, @NotNull UUID originalTransactionId, @NotNull @Min(1) Long amountCents, @NotBlank @Size(max=240) String reason, @NotBlank @Size(max=80) String requestKey) {}
  record RechargeTransaction(UUID id, UUID memberId, Long amountCents, Long bonusAmountCents) {}
  record RefundForUpdate(UUID id, UUID memberId, String refundNo, String status, Long amountCents, Long bonusReclaimCents, String paymentMethod, String paymentMethodNameSnapshot) {}
  record Wallet(UUID id, Long balanceCents) {}
  record RefundRow(UUID id, UUID memberId, String memberName, String memberPhone, UUID originalTransactionId, String refundNo, String status, Long amountCents, Long bonusReclaimCents, String reason, String requestedByNameSnapshot, String completedByNameSnapshot, OffsetDateTime createdAt, OffsetDateTime completedAt) {}
}
