package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
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
    assertThat(frontend).contains("settlementPaymentRows.push");
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
    assertThat(frontend).contains("payment.walletId=null;payment.wallets=[];payment.memberId=null");
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
    assertThat(source).contains("restoreWalletForCorrection(storeId, payment.walletId(), payment.amountCents()");
    assertThat(source).contains("Wallet wallet = walletById(payment.walletId())");
    assertThat(source).contains("delete from payment_record where order_id=:order");
    assertThat(source).contains("insert into payment_record");
  }
}
