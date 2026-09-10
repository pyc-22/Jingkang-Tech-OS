package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class RefundControllerRegressionTest {
  private final String source = readSource();

  @Test
  void fullReversalUsesRemainingPaidAmountAndCoversAllRemainingLines() {
    assertThat(source).contains("order.paidCents() - priorPaid");
    assertThat(source).contains("payment.amount_cents");
    assertThat(source).contains("refund.status<>'CANCELLED'");
    assertThat(source).contains("A full reversal must include every remaining order item");
  }

  @Test
  void fullReversalFullyRemovesCommissionClockAndDuration() {
    assertThat(source).contains("targetBase = original.baseAmountCents()");
    assertThat(source).contains("targetCommission = original.commissionCents()");
    assertThat(source).contains("targetClock = original.clockCountAdjustment()");
    assertThat(source).contains("targetDuration = original.durationMinutesAdjustment()");
    assertThat(source).contains("baseDelta = Math.max(0, targetBase - existing.baseCents())");
    assertThat(source).contains("durationDelta = Math.max(0, targetDuration - existing.durationMinutes())");
  }

  @Test
  void duplicateRequestRowsAreValidatedAsCombinedAmounts() {
    assertThat(source).contains("requestedLineAmounts.merge");
    assertThat(source).contains("requestedPaymentAmounts.merge");
  }

  @Test
  void completedRefundsKeepTheOriginalOrderBusinessDate() {
    String normalized = source.replaceAll("\\s+", "");
    assertThat(normalized).contains("LocalDaterefundBusinessDate=order.businessDate()");
    assertThat(normalized).contains("o.member_id,o.business_datefromsales_refundrjoinsales_ordero");
    assertThat(normalized).contains("LocalDatebusinessDate=refund.businessDate()");
    assertThat(normalized).doesNotContain("businessClock.businessDate(storeId,createdAt)");
    assertThat(normalized).doesNotContain("businessClock.businessDate(storeId,completedAt)");
  }

  private static String readSource() {
    try {
      return Files.readString(Path.of("src/main/java/com/chengxin/massage/sales/RefundController.java"));
    } catch (Exception exception) {
      throw new IllegalStateException(exception);
    }
  }
}
