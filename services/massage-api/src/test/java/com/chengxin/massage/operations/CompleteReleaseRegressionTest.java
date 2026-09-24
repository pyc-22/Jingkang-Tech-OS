package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class CompleteReleaseRegressionTest {
  @Test
  void dailyMetricsKeepGrossSalesSeparateAndDoNotDropPaidVoidedServices() throws Exception {
    String source = normalized("src/main/java/com/chengxin/massage/operations/DailyReportService.java");

    assertThat(source).contains("longnetSales=Math.subtractExact(orders.salesAmountCents(),refunds.refundAmountCents())");
    assertThat(source).contains("orders.salesAmountCents(),rechargeNetCents(wallet.rechargeAmountCents(),wallet.rechargeRefundAmountCents())");
    assertThat(source).contains("transaction_type='ADJUSTMENT'andwt.source='RECHARGE_REFUND'");
    assertThat(source).doesNotContain("sales_order_service_session");
    assertThat(source).doesNotContain("status<>'VOIDED'");
  }

  @Test
  void releaseContainsIdempotencyAndUnifiedDailyReportMigrations() throws Exception {
    String v87 = resource("/db/migration/V87__idempotency_duplicate_prevention.sql");
    String v88 = resource("/db/migration/V88__daily_report_unification_indexes.sql");

    assertThat(v87).contains("order_number_seq", "uk_participant_technician_active");
    assertThat(v88).contains("payment_record_store_order_idx", "wallet_transaction_store_business_type_source_idx");
  }

  @Test
  void businessDateMigrationUsesStoreSettingsAndKeepsDependentLedgersAligned() throws Exception {
    String migration = resource("/db/migration/V89__fix_order_and_refund_business_date.sql")
      .replaceAll("\\s+", "")
      .toLowerCase(java.util.Locale.ROOT);

    assertThat(migration).contains("attimezonestore.timezone");
    assertThat(migration).contains("store.business_day_cutoff");
    assertThat(migration).contains("updatesales_order");
    assertThat(migration).contains("updatesales_refund");
    assertThat(migration).contains("updatewallet_transaction");
    assertThat(migration).contains("updatetechnician_commission_record");
    assertThat(migration).doesNotContain("asia/shanghai");
    assertThat(migration).doesNotContain("calculate_business_date");
    assertThat(migration).doesNotContain("_backup_v89");
  }

  private static String normalized(String path) throws Exception {
    return Files.readString(Path.of(path)).replaceAll("\\s+", "");
  }

  private static String resource(String path) throws Exception {
    try (InputStream stream = CompleteReleaseRegressionTest.class.getResourceAsStream(path)) {
      assertThat(stream).as(path).isNotNull();
      return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
    }
  }
}
