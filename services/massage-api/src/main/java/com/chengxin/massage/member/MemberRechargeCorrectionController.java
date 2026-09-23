package com.chengxin.massage.member;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.DailyReportService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.Locale;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/members/{memberId}/recharges/{rechargeId}/correction")
@CrossOrigin(origins = "*")
public class MemberRechargeCorrectionController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final AdminSessionService sessions;
  private final StoreContextService stores;
  private final AuditService audits;
  private final DailyReportService reports;

  MemberRechargeCorrectionController(JdbcClient jdbc, AdminSessionService sessions, StoreContextService stores,
                                     AuditService audits, DailyReportService reports) {
    this.jdbc = jdbc; this.sessions = sessions; this.stores = stores; this.audits = audits; this.reports = reports;
  }

  @PutMapping
  @Transactional(isolation = Isolation.REPEATABLE_READ)
  CorrectionResult correct(@PathVariable UUID memberId, @PathVariable UUID rechargeId,
      @Valid @RequestBody CorrectionInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    sessions.requirePermission(authorization, "MEMBER_MANAGE");
    AdminSessionService.AuthenticatedIdentity actor = sessions.authenticatedIdentity(authorization);
    if (!actor.roles().contains("STORE_MANAGER") && !actor.roles().contains("TENANT_ADMIN")) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Store manager role required");
    }
    UUID storeId = stores.currentStore(authorization, requestedStoreId);
    // Match refund lock order: principal first, wallet second. Both paths serialize on this row.
    Recharge before = jdbc.sql("""
      select id,wallet_id,business_date,payment_method,payment_method_name_snapshot,
        coalesce(corrected_amount_cents,amount_cents) amount_cents,correction_version
      from wallet_transaction where id=:id and member_id=:member and store_id=:store
        and tenant_id=:tenant and transaction_type='RECHARGE' and not report_excluded for update
      """).param("id", rechargeId).param("member", memberId).param("store", storeId).param("tenant", TENANT_ID)
      .query(Recharge.class).optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Recharge not found"));
    if (before.correctionVersion() != input.version()) throw conflict("Recharge changed; refresh before correcting");
    if (before.businessDate() == null) throw conflict("Recharge business date requires review");
    boolean refunded = jdbc.sql("select exists(select 1 from member_recharge_refund where original_transaction_id=:id and status in ('PENDING','COMPLETED'))")
      .param("id", rechargeId).query(Boolean.class).single();
    if (refunded) throw conflict("Recharge has a pending or completed refund");
    PaymentMethod method = jdbc.sql("select code,name from store_payment_method where store_id=:store and code=:code and active=true and method_kind='EXTERNAL'")
      .param("store", storeId).param("code", input.paymentMethod().trim().toUpperCase(Locale.ROOT))
      .query(PaymentMethod.class).optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Select an active external payment method"));
    long amount = input.amountCents() == null ? before.amountCents() : input.amountCents();
    long delta = Math.subtractExact(amount, before.amountCents());
    if (delta == 0 && method.code().equals(before.paymentMethod())) throw conflict("No recharge values changed");
    UUID reportId = jdbc.sql("select id from daily_operating_report where store_id=:store and business_date=:date for update")
      .param("store", storeId).param("date", before.businessDate()).query(UUID.class).optional().orElse(null);
    long balance = jdbc.sql("select balance_cents from member_wallet where id=:wallet and member_id=:member and tenant_id=:tenant for update")
      .param("wallet", before.walletId()).param("member", memberId).param("tenant", TENANT_ID).query(Long.class).single();
    long afterBalance = correctedBalance(balance, before.amountCents(), amount);
    jdbc.sql("update wallet_transaction set payment_method=:method,payment_method_name_snapshot=:name,corrected_amount_cents=:amount,correction_version=correction_version+1 where id=:id")
      .param("method", method.code()).param("name", method.name()).param("amount", amount).param("id", rechargeId).update();
    UUID adjustmentId = null;
    if (delta != 0) {
      adjustmentId = UUID.randomUUID();
      jdbc.sql("""
        insert into wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,
          balance_before_cents,balance_after_cents,source,note,business_date,corrected_recharge_id)
        values(:id,:tenant,:store,:wallet,:member,'ADJUSTMENT',:delta,:before,:after,'RECHARGE_CORRECTION',:reason,:date,:recharge)
        """).param("id", adjustmentId).param("tenant", TENANT_ID).param("store", storeId).param("wallet", before.walletId())
        .param("member", memberId).param("delta", delta).param("before", balance).param("after", afterBalance)
        .param("reason", input.reason().trim()).param("date", before.businessDate()).param("recharge", rechargeId).update();
      jdbc.sql("update member_wallet set balance_cents=:balance,updated_at=now(),version=version+1 where id=:id")
        .param("balance", afterBalance).param("id", before.walletId()).update();
    }
    if (reportId != null) refreshReport(reportId, storeId, before.businessDate(), actor.userId());
    CorrectionResult after = new CorrectionResult(rechargeId, memberId, before.businessDate(), method.code(), method.name(),
      amount, before.correctionVersion() + 1, afterBalance, adjustmentId, input.reason().trim());
    audits.record(authorization, storeId, "MEMBER", "MEMBER_RECHARGE_CORRECTED", "wallet_transaction", rechargeId,
      input.reason().trim(), before, after);
    return after;
  }

  private void refreshReport(UUID reportId, UUID storeId, LocalDate date, UUID actor) {
    DailyReportService.DailyMetrics metrics = reports.daily(storeId, date);
    // Only financial snapshots for the original date change; publication and manual fields stay intact.
    jdbc.sql("""
      update daily_operating_report set daily_cash_flow_cents=:cashFlow,daily_card_sale_cents=:cardSale,
        daily_card_open_cents=:cardOpen,daily_card_renew_cents=:cardRenew,daily_cash_cents=:cash,
        daily_alipay_cents=:alipay,daily_douyin_cents=:douyin,daily_meituan_cents=:meituan,
        daily_free_order_cents=:freeOrder,daily_entertainment_cents=:entertainment,
        updated_at=now(),updated_by_user_id=:actor,version=version+1 where id=:id
      """).param("id", reportId).param("actor", actor).param("cashFlow", Math.max(0, metrics.cashFlowCents()))
      .param("cardSale", metrics.rechargeAmountCents()).param("cardOpen", metrics.cardOpenCents()).param("cardRenew", metrics.cardRenewCents())
      .param("cash", channel(metrics, "CASH")).param("alipay", channel(metrics, "ALIPAY")).param("douyin", channel(metrics, "DOUYIN"))
      .param("meituan", channel(metrics, "MEITUAN")).param("freeOrder", channel(metrics, "FREE_ORDER"))
      .param("entertainment", channel(metrics, "ENTERTAINMENT")).update();
  }

  private long channel(DailyReportService.DailyMetrics metrics, String code) {
    return Math.max(0, metrics.channels().stream().filter(c -> code.equals(c.code())).mapToLong(DailyReportService.ChannelMetrics::netCents).sum());
  }

  static long correctedBalance(long balance, long before, long after) {
    try {
      long result = Math.addExact(balance, Math.subtractExact(after, before));
      if (result < 0) throw conflict("Insufficient wallet balance for this correction");
      return result;
    } catch (ArithmeticException exception) { throw conflict("Amount exceeds supported range"); }
  }

  private static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }
  record CorrectionInput(@NotBlank @Size(max=30) String paymentMethod, @Min(1) Long amountCents,
                         @NotBlank @Size(max=240) String reason, @NotNull @Min(0) Long version) {}
  record Recharge(UUID id, UUID walletId, LocalDate businessDate, String paymentMethod, String paymentMethodNameSnapshot,
                  long amountCents, long correctionVersion) {}
  record PaymentMethod(String code, String name) {}
  record CorrectionResult(UUID id, UUID memberId, LocalDate businessDate, String paymentMethod, String paymentMethodNameSnapshot,
                          long amountCents, long version, long balanceCents, UUID adjustmentId, String reason) {}
}
