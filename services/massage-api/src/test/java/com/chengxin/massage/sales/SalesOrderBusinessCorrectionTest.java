package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class SalesOrderBusinessCorrectionTest {
  @Test
  void migrationStoresSnapshotsAndAllowsCorrectionCommissionRecords() throws Exception {
    String sql = Files.readString(Path.of("src/main/resources/db/migration/V74__sales_order_business_corrections.sql"));
    assertThat(sql).contains("sales_order_business_correction");
    assertThat(sql).contains("BUSINESS_CORRECTION_REVERSAL");
    assertThat(sql).contains("BUSINESS_CORRECTION");
  }

  @Test
  void controllerExposesAuditedBusinessCorrectionWorkflow() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/sales/SalesOrderController.java"));
    assertThat(source).contains("/{id}/business-corrections");
    assertThat(source).contains("loadBusinessCorrections(storeId, id)");
    assertThat(source).contains("old_base_amount_cents");
    assertThat(source).contains("new_commission_cents");
    assertThat(source).contains("record_type='BUSINESS_CORRECTION_REVERSAL'");
    assertThat(source).contains("record_type='BUSINESS_CORRECTION'");
    assertThat(source).contains("List<BusinessCorrectionView> businessCorrections");
    assertThat(source).contains("reverseCurrentCommissionsForBusinessCorrection");
    assertThat(source).contains("ORDER_BUSINESS_CORRECTED");
    assertThat(source).contains("多人服务或中途换技师");
  }

  @Test
  void settlementAndOrderSearchUseTheSettlementBusinessDate() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/sales/SalesOrderController.java"))
      .replaceAll("\\s+", "");
    assertThat(source).contains("LocalDatebusinessDate=businessClock.businessDate(storeId,settledAt)");
    assertThat(source).contains("ando.business_date>=:fromDate");
    assertThat(source).contains("ando.business_date<=:toDate");
    assertThat(source).doesNotContain("cast(o.settled_atasdate)");
  }
}
