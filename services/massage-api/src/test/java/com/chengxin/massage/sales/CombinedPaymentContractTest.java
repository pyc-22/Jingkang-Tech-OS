package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class CombinedPaymentContractTest {
  private String salesSource() throws Exception {
    return Files.readString(Path.of("src/main/java/com/chengxin/massage/sales/SalesOrderController.java"));
  }

  @Test
  void settlementAcceptsMultipleMemberCardsAndExternalPaymentRows() throws Exception {
    String source = salesSource();
    assertThat(source).contains("List<ResolvedPayment> resolvedPayments = resolvePayments(storeId, input.memberId(), input.payments())");
    assertThat(source).contains("for (ResolvedPayment payment : resolvedPayments)");
    assertThat(source).contains("payment.walletId()");
    String frontend = Files.readString(Path.of("..", "..", "apps/massage-console/app.js"));
    assertThat(frontend).contains("createCombinedPaymentEditor");
    assertThat(frontend).contains("data-combined-add-card");
    assertThat(frontend).contains("const payments=settlementPayments()");
    assertThat(frontend).contains("memberPayments=payments.filter");
  }

  @Test
  void permitsAnExplicitCardFromAnotherMemberButKeepsTenantIsolation() throws Exception {
    String sales = salesSource();
    assertThat(sales).contains("w.id=:wallet");
    assertThat(sales).contains("w.tenant_id=:tenant");
    assertThat(sales).contains("w.active and m.active");
    String wallet = Files.readString(Path.of("src/main/java/com/chengxin/massage/member/MemberWalletController.java"));
    assertThat(wallet).contains("where w.tenant_id=:tenant");
    assertThat(wallet).contains(".param(\"tenant\", TENANT_ID)");
  }

  @Test
  void rejectsWalletIdsOnExternalPaymentRows() throws Exception {
    String source = salesSource();
    assertThat(source).contains("if (!\"MEMBER_BALANCE\".equals(method.methodKind()))");
    assertThat(source).contains("if (requestedWalletId != null) throw bad(\"外部支付方式不能指定会员卡\")");
    String frontend = Files.readString(Path.of("..", "..", "apps/massage-console/app.js"));
    assertThat(frontend).contains("walletId: memberMethod(row) ? row.walletId : null");
  }

  @Test
  void locksSelectedCardBeforeCheckingAndChangingBalance() throws Exception {
    String source = salesSource();
    String selection = source.substring(source.indexOf("private List<ResolvedPayment> resolvePayments("), source.indexOf("private Map<UUID, Wallet> lockWallets("));
    assertThat(selection).contains("walletIds.add(walletId)");
    String locking = source.substring(source.indexOf("private Map<UUID, Wallet> lockWallets("), source.indexOf("private void consumeWallet("));
    assertThat(locking).contains("walletIds.stream().sorted().toList()");
    assertThat(locking).contains("order by w.id for update of w");
  }

  @Test
  void refundsEachMemberPaymentBackToItsOriginalWallet() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/sales/RefundController.java"));
    assertThat(source).contains("select wallet_id from payment_record where id=:id and order_id=:order");
    assertThat(source).contains("insert into refund_payment_record");
    assertThat(source).contains(".param(\"wallet\", walletId)");
    assertThat(source).contains("restoreWallet(storeId, payment.walletId(), payment.amountCents()");
  }

  @Test
  void financialCorrectionRestoresOldCardsAndConsumesTheSelectedNewCards() throws Exception {
    String source = salesSource();
    assertThat(source).contains("Map<UUID, Long> walletDeltas = correctionWalletDeltas(beforePayments, afterPayments)");
    assertThat(source).contains("restoreWalletForCorrection(storeId, delta.getKey(), -delta.getValue()");
    assertThat(source).contains("consumeWallet(storeId, walletById(delta.getKey()), delta.getValue()");
    assertThat(source).contains("resolvePayments(storeId, order.memberId(), input.payments(), oldWalletIds)");
    assertThat(source).contains("delete from payment_record where order_id=:order");
    assertThat(source).contains("insert into payment_record");
  }

  @Test
  void correctionDeltasNetRepeatedCardsAndLeaveUnchangedCardsUntouched() {
    SalesOrderController controller = new SalesOrderController(null, null, null, null, null, null, null);
    UUID first = UUID.fromString("00000000-0000-0000-0000-000000000001");
    UUID second = UUID.fromString("00000000-0000-0000-0000-000000000002");
    List<SalesOrderController.Payment> before = List.of(
        new SalesOrderController.Payment(UUID.randomUUID(), "MEMBER_BALANCE", "会员余额", first, null, null, null, null, null, 6000L, OffsetDateTime.now()),
        new SalesOrderController.Payment(UUID.randomUUID(), "MEMBER_BALANCE", "会员余额", second, null, null, null, null, null, 4000L, OffsetDateTime.now()));
    List<SalesOrderController.ResolvedCorrectionPayment> after = List.of(
        new SalesOrderController.ResolvedCorrectionPayment("MEMBER_BALANCE", "会员余额", "MEMBER_BALANCE", first, 6000L),
        new SalesOrderController.ResolvedCorrectionPayment("MEMBER_BALANCE", "会员余额", "MEMBER_BALANCE", second, 4000L));
    assertThat(controller.correctionWalletDeltas(before, after)).isEmpty();
  }

  @Test
  void correctionDeltasDebitAndRefundOnlyTheNetWalletDifferences() {
    SalesOrderController controller = new SalesOrderController(null, null, null, null, null, null, null);
    UUID first = UUID.fromString("00000000-0000-0000-0000-000000000001");
    UUID second = UUID.fromString("00000000-0000-0000-0000-000000000002");
    List<SalesOrderController.Payment> before = List.of(
        new SalesOrderController.Payment(UUID.randomUUID(), "MEMBER_BALANCE", "会员余额", first, null, null, null, null, null, 6000L, OffsetDateTime.now()));
    List<SalesOrderController.ResolvedCorrectionPayment> after = List.of(
        new SalesOrderController.ResolvedCorrectionPayment("MEMBER_BALANCE", "会员余额", "MEMBER_BALANCE", first, 1000L),
        new SalesOrderController.ResolvedCorrectionPayment("MEMBER_BALANCE", "会员余额", "MEMBER_BALANCE", second, 5000L));
    assertThat(controller.correctionWalletDeltas(before, after))
        .containsExactlyInAnyOrderEntriesOf(Map.of(first, -5000L, second, 5000L));
  }
}
