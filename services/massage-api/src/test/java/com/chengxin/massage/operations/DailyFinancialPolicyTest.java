package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

class DailyFinancialPolicyTest {
  @Test
  void externalOrderPaymentCountsInTurnoverAndCashFlow() {
    var totals = calculate(50_000, 0, channel("EXTERNAL", 50_000, 0), 0);

    assertThat(totals.turnoverCents()).isEqualTo(50_000);
    assertThat(totals.cashFlowCents()).isEqualTo(50_000);
  }

  @Test
  void memberBalancePaymentCountsOnlyInTurnover() {
    var totals = calculate(50_000, 0, channel("MEMBER_BALANCE", 50_000, 0), 0);

    assertThat(totals.turnoverCents()).isEqualTo(50_000);
    assertThat(totals.cashFlowCents()).isZero();
  }

  @Test
  void mixedPaymentCountsAllInTurnoverAndOnlyExternalPartInCashFlow() {
    var totals = DailyFinancialPolicy.calculate(50_000, 0, List.of(
      channel("MEMBER_BALANCE", 30_000, 0),
      channel("EXTERNAL", 20_000, 0)), 0);

    assertThat(totals.turnoverCents()).isEqualTo(50_000);
    assertThat(totals.cashFlowCents()).isEqualTo(20_000);
  }

  @Test
  void cardRechargeCountsOnlyActualReceiptInCashFlow() {
    var totals = DailyFinancialPolicy.calculate(0, 0, List.of(), 100_000);

    assertThat(totals.turnoverCents()).isZero();
    assertThat(totals.cashFlowCents()).isEqualTo(100_000);
  }

  @Test
  void completedExternalRefundReducesTurnoverAndCashFlowOnCompletionDay() {
    var totals = calculate(0, 50_000, channel("EXTERNAL", 0, 50_000), 0);

    assertThat(totals.turnoverCents()).isEqualTo(-50_000);
    assertThat(totals.cashFlowCents()).isEqualTo(-50_000);
  }

  @Test
  void completedMemberBalanceRefundReducesTurnoverButNotCashFlow() {
    var totals = calculate(0, 50_000, channel("MEMBER_BALANCE", 0, 50_000), 0);

    assertThat(totals.turnoverCents()).isEqualTo(-50_000);
    assertThat(totals.cashFlowCents()).isZero();
  }

  @Test
  void mixedRefundUsesItsOriginalPaymentComposition() {
    var totals = DailyFinancialPolicy.calculate(0, 50_000, List.of(
      channel("MEMBER_BALANCE", 0, 30_000),
      channel("EXTERNAL", 0, 20_000)), 0);

    assertThat(totals.turnoverCents()).isEqualTo(-50_000);
    assertThat(totals.cashFlowCents()).isEqualTo(-20_000);
  }

  @Test
  void rechargeRefundCanProduceNegativeCashFlowWithoutChangingTurnover() {
    var totals = DailyFinancialPolicy.calculate(0, 0, List.of(), -100_000);

    assertThat(totals.turnoverCents()).isZero();
    assertThat(totals.cashFlowCents()).isEqualTo(-100_000);
  }

  @Test
  void combinesMixedOrdersRechargeAndRefundsWithoutDoubleCountingMemberBalance() {
    var totals = DailyFinancialPolicy.calculate(50_000, 5_000, List.of(
      channel("MEMBER_BALANCE", 30_000, 3_000),
      channel("EXTERNAL", 20_000, 2_000)), 10_000);

    assertThat(totals.turnoverCents()).isEqualTo(45_000);
    assertThat(totals.externalOrderCashFlowCents()).isEqualTo(18_000);
    assertThat(totals.cashFlowCents()).isEqualTo(28_000);
  }

  @Test
  void mismatchedPaymentDetailsAreRejected() {
    assertThatThrownBy(() -> calculate(50_000, 0, channel("EXTERNAL", 49_900, 0), 0))
      .isInstanceOf(IllegalArgumentException.class)
      .hasMessageContaining("payments must equal");
  }

  @Test
  void mismatchedRefundDetailsAreRejected() {
    assertThatThrownBy(() -> calculate(0, 50_000, channel("EXTERNAL", 0, 49_900), 0))
      .isInstanceOf(IllegalArgumentException.class)
      .hasMessageContaining("Refund payments must equal");
  }

  private DailyFinancialPolicy.Totals calculate(long settled, long refunded,
                                                 DailyFinancialPolicy.ChannelMovement channel,
                                                 long rechargeNet) {
    return DailyFinancialPolicy.calculate(settled, refunded, List.of(channel), rechargeNet);
  }

  private DailyFinancialPolicy.ChannelMovement channel(String kind, long settled, long refunded) {
    return new DailyFinancialPolicy.ChannelMovement(kind, settled, refunded);
  }
}
