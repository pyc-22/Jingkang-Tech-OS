package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class DailyOperatingReportControllerTest {
  private final DailyOperatingReportController controller =
    new DailyOperatingReportController(null, null, null, null, null, null);

  @Test
  void calculatesCombinedExtensionAndCallRateUsingTotalServiceCount() {
    assertThat(controller.serviceClockRate(80, 10, 10))
      .isEqualByComparingTo(new BigDecimal("20.00"));
  }

  @Test
  void returnsZeroRateWhenThereIsNoServiceActivity() {
    assertThat(controller.serviceClockRate(0, 0, 0))
      .isEqualByComparingTo(new BigDecimal("0.00"));
  }

  @Test
  void cashFlowIncludesExternalOrdersAndActualRechargeOnly() {
    assertThat(DailyOperatingReportController.cashFlowCents(18_000, 5_000))
      .isEqualTo(23_000);
  }

  @Test
  void memberBalancePaymentsAreExcludedFromCashFlowButExternalPaymentsRemain() {
    var channels = java.util.List.of(
      new DailyOperatingReportController.PaymentChannelSummary("MEMBER_PAY", "会员余额", "MEMBER_BALANCE", true, false, 12_000, 0, 12_000),
      new DailyOperatingReportController.PaymentChannelSummary("WECHAT", "微信支付", "EXTERNAL", true, true, 8_000, 1_000, 7_000));

    assertThat(DailyOperatingReportController.externalOrderCashFlow(channels)).isEqualTo(7_000);
  }

  @Test
  void cardConsumptionSubtractsOnlyEligibleOrderRefunds() {
    assertThat(DailyOperatingReportController.cardConsumptionCents(10_000, 0)).isEqualTo(10_000);
    assertThat(DailyOperatingReportController.cardConsumptionCents(10_000, 10_000)).isZero();
    assertThat(DailyOperatingReportController.cardConsumptionCents(10_000, 3_000)).isEqualTo(7_000);
    assertThat(DailyOperatingReportController.cardConsumptionCents(0, 0)).isZero();
    assertThat(DailyOperatingReportController.cardConsumptionCents(10_000, 2_000)).isEqualTo(8_000);
  }

  @Test
  void cardActivitySqlKeepsRechargeRefundsOutOfConsumptionRefunds() throws Exception {
    String source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/java/com/chengxin/massage/operations/DailyOperatingReportController.java"))
      .replaceAll("\\s+", "");
    assertThat(source).contains("transaction_type='REFUND'andsourcein('ORDER_REFUND','ORDER_CORRECTION')");
    assertThat(source).contains("transaction_type='ADJUSTMENT'andsource='RECHARGE_REFUND'");
  }

  @Test
  void customerCountExcludesFullyVoidedServiceOrdersButKeepsMixedAndUnlinkedOrders() throws Exception {
    String source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/java/com/chengxin/massage/operations/DailyOperatingReportController.java"))
      .replaceAll("\\s+", "");
    assertThat(source).contains("notexists(select1fromsales_order_service_sessionlinked_sessionwherelinked_session.order_id=sales.id)");
    assertThat(source).contains("exists(select1fromsales_order_service_sessionlinked_sessionjoinservice_sessionlinked_serviceonlinked_service.id=linked_session.service_session_idwherelinked_session.order_id=sales.idandlinked_service.status<>'VOIDED')");
    assertThat(source).contains("sales.status='SETTLED'andsales.paid_cents>0");
    assertThat(source).doesNotContain("linked_service.status='VOIDED'");
  }

  @Test
  void customerCountExcludesFullyRefundedOrdersForDailyAndMonthlyReports() throws Exception {
    String source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/java/com/chengxin/massage/operations/DailyOperatingReportController.java"))
      .replaceAll("\\s+", "");
    assertThat(source).contains("coalesce(sales.refund_status,'NONE')<>'FULL'");
  }

  @Test
  void customerCountOverrideReplacesAutomaticValueAndCanBeCleared() {
    assertThat(DailyOperatingReportController.resolveCustomerCount(24, null)).isEqualTo(24);
    assertThat(DailyOperatingReportController.resolveCustomerCount(24, 23)).isEqualTo(23);
    assertThat(DailyOperatingReportController.resolveCustomerCount(0, 0)).isZero();
  }

  @Test
  void customerCountOverrideRequiresNonNegativeValues() {
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> DailyOperatingReportController.resolveCustomerCount(-1, null))
      .isInstanceOf(IllegalArgumentException.class);
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> DailyOperatingReportController.resolveCustomerCount(1, -1))
      .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void customerCountOverrideIsPersistedOutsideTheDailyReportOrderFields() throws Exception {
    String migration = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/resources/db/migration/V83__daily_customer_count_overrides.sql"))
      .replaceAll("\\s+", "");
    assertThat(migration).contains("CREATETABLEdaily_customer_count_override");
    assertThat(migration).contains("UNIQUE(store_id,business_date)");
    String source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/java/com/chengxin/massage/operations/DailyOperatingReportController.java"))
      .replaceAll("\\s+", "");
    assertThat(source).contains("PutMapping(\"/customer-count-override\")");
    assertThat(source).contains("DeleteMapping(\"/customer-count-override\")");
    assertThat(source).contains("customerCountOverride");
  }

  @Test
  void upgradesOnlyTheLegacyDefaultCashFlowLabel() {
    var base = new DailyOperatingReportController.DefaultField("cashFlowCents", "MONTHLY", "累计现金流", 30);
    var legacy = new DailyOperatingReportController.FieldConfigRow("cashFlowCents", "累计净实收", "MONTHLY", true, false, 30);
    var custom = new DailyOperatingReportController.FieldConfigRow("cashFlowCents", "门店资金流", "MONTHLY", true, false, 30);

    assertThat(DailyOperatingReportController.configuredFieldLabel(base, legacy)).isEqualTo("累计现金流");
    assertThat(DailyOperatingReportController.configuredFieldLabel(base, custom)).isEqualTo("门店资金流");
  }

  @Test
  void upgradesOnlyTheLegacyDefaultDailyCashFlowLabel() {
    var base = new DailyOperatingReportController.DefaultField("dailyCashFlowCents", "DAILY", "当日现金流", 30);
    var legacy = new DailyOperatingReportController.FieldConfigRow("dailyCashFlowCents", "当日净实收", "DAILY", true, false, 30);
    var custom = new DailyOperatingReportController.FieldConfigRow("dailyCashFlowCents", "今日资金流", "DAILY", true, false, 30);

    assertThat(DailyOperatingReportController.configuredFieldLabel(base, legacy)).isEqualTo("当日现金流");
    assertThat(DailyOperatingReportController.configuredFieldLabel(base, custom)).isEqualTo("今日资金流");
  }

  @Test
  void keepsManualFieldsButAlwaysUsesLiveOperationalValues() {
    DailyOperatingReportController.ReportValues saved = new DailyOperatingReportController.ReportValues(
      500_00, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      2, 3, 20, 1, 4, "突发事件", "托班人员", 5, 6, "明日改进");
    DailyOperatingReportController.ReportValues live = new DailyOperatingReportController.ReportValues(
      0, 10_000, 9_000, 2_000, 1_200, 800, 100, 700, 30, 4, 6,
      3_000, 2_000, 1_500, 1_000, 500, 100, 0, 0, 0, 0, 0, null, null, 0, 0, null);

    DailyOperatingReportController.ReportValues merged = controller.operationalValues(saved, live);

    assertThat(merged.dailyTargetCents()).isEqualTo(500_00);
    assertThat(merged.dailySalesCents()).isEqualTo(10_000);
    assertThat(merged.dailyCashCents()).isEqualTo(3_000);
    assertThat(merged.dailyCustomerCount()).isEqualTo(30);
    assertThat(merged.managerCount()).isEqualTo(2);
    assertThat(merged.incidentNote()).isEqualTo("突发事件");
    assertThat(saved.dailySalesCents()).isEqualTo(1);
    assertThat(saved.dailyCashFlowCents()).isEqualTo(2);
  }
}
