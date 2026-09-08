package com.chengxin.massage.member;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import com.chengxin.massage.admin.StoreContextService;

@RestController
@RequestMapping("/api/v1/wallet-transactions")
@CrossOrigin(origins = "*")
public class WalletTransactionController {
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;

  WalletTransactionController(JdbcClient jdbc, StoreContextService storeContext) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
  }

  @GetMapping
  List<WalletTransaction> list(@RequestParam(defaultValue = "") String query,
                               @RequestParam(defaultValue = "") String from,
                               @RequestParam(defaultValue = "") String to,
                               @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                               @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql("select wt.id,wt.member_id,m.code member_code,m.name member_name,m.phone member_phone,wt.transaction_type,wt.amount_cents,wt.balance_before_cents,wt.balance_after_cents,wt.payment_method,wt.payment_method_name_snapshot,wt.technician_id,wt.technician_name_snapshot,wt.employee_id,wt.employee_name_snapshot,wt.source,wt.note,wt.created_at,(wt.transaction_type='RECHARGE' and not exists(select 1 from wallet_transaction earlier where earlier.member_id=wt.member_id and earlier.transaction_type='RECHARGE' and (earlier.created_at,earlier.id)<(wt.created_at,wt.id))) opening_recharge from wallet_transaction wt join member m on m.id=wt.member_id where wt.store_id=:store and (m.code ilike :query or m.name ilike :query or m.phone ilike :query or coalesce(wt.note,'') ilike :query) and (:from='' or wt.created_at >= cast(:from as date)) and (:to='' or wt.created_at < cast(:to as date) + interval '1 day') order by wt.created_at desc limit 200")
      .param("store", storeId).param("query", "%" + query.trim() + "%").param("from", from).param("to", to)
      .query(WalletTransaction.class).list();
  }

  record WalletTransaction(UUID id, UUID memberId, String memberCode, String memberName, String memberPhone,
                           String transactionType, Long amountCents, Long balanceBeforeCents, Long balanceAfterCents,
                           String paymentMethod, String paymentMethodNameSnapshot, UUID technicianId, String technicianNameSnapshot,
                           UUID employeeId, String employeeNameSnapshot,
                           String source, String note, OffsetDateTime createdAt, Boolean openingRecharge) {}
}
