package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import com.chengxin.massage.operations.DailyReportService.ChannelMetrics;

class DailyReportArithmeticTest {
  @Test
  void keepsOrderAndRechargeCashFlowsSeparate() {
    ChannelMetrics channel = new ChannelMetrics("CASH", "Cash", "EXTERNAL", true, true,
      10000, 2500, 20000, 5000, (short) 1);
    assertThat(channel.orderNetCents()).isEqualTo(7500);
    assertThat(channel.rechargeNetCents()).isEqualTo(15000);
    assertThat(channel.netCents()).isEqualTo(22500);
  }

  @Test
  void retainsNegativeRefundOnlyCashFlow() {
    ChannelMetrics channel = new ChannelMetrics("RETIRED", "", "EXTERNAL", false, false,
      0, 0, (short) 9).withRefunds(800).withRechargeRefunds(200);
    assertThat(channel.netCents()).isEqualTo(-1000);
    assertThat(channel.name()).isEqualTo("RETIRED");
    assertThat(channel.active()).isFalse();
  }

  @Test
  void updatesOneChannelComponentWithoutLosingOthers() {
    ChannelMetrics initial = new ChannelMetrics("CASH", "Cash", "EXTERNAL", true, true,
      0, 0, (short) 2);
    ChannelMetrics updated = initial.withSales(700).withRefunds(100)
      .withRecharges(300).withRechargeRefunds(50);
    assertThat(updated.salesCents()).isEqualTo(700);
    assertThat(updated.refundCents()).isEqualTo(100);
    assertThat(updated.rechargeCents()).isEqualTo(300);
    assertThat(updated.rechargeRefundCents()).isEqualTo(50);
    assertThat(updated.netCents()).isEqualTo(850);
    assertThat(initial.netCents()).isZero();
  }

  @Test
  void memberBalanceRemainsASeparateChannelKind() {
    ChannelMetrics channel = new ChannelMetrics("MEMBER_BALANCE", null, "MEMBER_BALANCE", true, false,
      0, 0, (short) 1).withSales(900).withRefunds(400);
    assertThat(channel.methodKind()).isEqualTo("MEMBER_BALANCE");
    assertThat(channel.cashCounted()).isFalse();
    assertThat(channel.orderNetCents()).isEqualTo(500);
    assertThat(channel.name()).isEqualTo("MEMBER_BALANCE");
  }

  @Test
  void consumptionSupportsZeroAndRefundOnlyDays() {
    assertThat(DailyReportService.cardConsumptionCents(0, 0)).isZero();
    assertThat(DailyReportService.cardConsumptionCents(0, 500)).isEqualTo(-500);
    assertThat(DailyReportService.cardConsumptionCents(Long.MAX_VALUE, 0)).isEqualTo(Long.MAX_VALUE);
  }

  @Test
  void negativeConsumptionInputsAreRejected() {
    assertThatThrownBy(() -> DailyReportService.cardConsumptionCents(-1, 0))
      .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> DailyReportService.cardConsumptionCents(0, -1))
      .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void rechargeNetSubtractsCompletedRechargeRefunds() {
    assertThat(DailyReportService.rechargeNetCents(10_000, 3_000)).isEqualTo(7_000);
    assertThat(DailyReportService.rechargeNetCents(0, 5_000)).isEqualTo(-5_000);
    assertThat(DailyReportService.rechargeNetCents(10_000, 0)).isEqualTo(10_000);
  }
}
