package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class TechnicianCommissionEffectiveRecordsTest {
  @Test
  void effectiveRecordsNetAdjustmentsAndExcludeReversalRows() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/sales/TechnicianCommissionController.java"));
    assertThat(source).contains("WITH adjustment_totals AS");
    assertThat(source).contains("GREATEST(0, base.commission_cents + COALESCE(adjustment.commission_delta, 0))");
    assertThat(source).contains("WHERE base.record_type IN ('SETTLEMENT','BUSINESS_CORRECTION')");
    assertThat(source).contains("effective_commission_cents>0");
  }

  @Test
  void adjustmentsAreAvailableWithReasonsAndReferences() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/sales/TechnicianCommissionController.java"));
    assertThat(source).contains("@GetMapping(\"/adjustments\")");
    assertThat(source).contains("REFUND_REVERSAL','ORDER_VOID_REVERSAL','BUSINESS_CORRECTION_REVERSAL");
    assertThat(source).contains("adjustment_reference_no");
    assertThat(source).contains("adjustment_reason");
  }
}
