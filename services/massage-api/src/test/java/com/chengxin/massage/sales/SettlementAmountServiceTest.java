package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.web.server.ResponseStatusException;

class SettlementAmountServiceTest {
  private final SettlementAmountService service = new SettlementAmountService();
  private final List<Long> originals = List.of(97300L, 15900L, 28900L);

  @Test
  void sumsUnitReceiptsWithoutChangingOriginalPrices() {
    var result = service.resolve(originals, List.of(97300L, 15000L, 28000L), null, "", List.of(140300L));

    assertThat(result.unitAmountsCents()).containsExactly(97300L, 15000L, 28000L);
    assertThat(result.totals()).isEqualTo(new SettlementAmountService.Totals(142100L, 140300L, 1800L));
    assertThat(originals).containsExactly(97300L, 15900L, 28900L);
  }

  @Test
  void omittedUnitReceiptsDefaultToOriginalPrices() {
    var result = service.resolve(originals, Collections.nCopies(3, null), null, "", List.of(142100L));

    assertThat(result.unitAmountsCents()).containsExactlyElementsOf(originals);
    assertThat(result.totals().adjustmentCents()).isZero();
  }

  @Test
  void onlyOmittedUnitsDefaultToTheirOriginalPrices() {
    var result = service.resolve(originals, Arrays.asList(null, 15000L, null), 141200L, "", List.of(141200L));

    assertThat(result.unitAmountsCents()).containsExactly(97300L, 15000L, 28900L);
    assertThat(result.totals().adjustmentCents()).isEqualTo(900L);
  }

  @Test
  void allowsSurchargesAndReturnsNegativeDiscounts() {
    var result = service.resolve(originals, List.of(98300L, 15900L, 28900L), null, "", List.of(143100L));

    assertThat(result.totals()).isEqualTo(new SettlementAmountService.Totals(142100L, 143100L, -1000L));
  }

  @ParameterizedTest
  @ValueSource(longs = {140300L, 143100L})
  void keepsLegacyHeaderOnlyAdjustmentsWithoutInventingUnitAllocations(long total) {
    var result = service.resolve(originals, Collections.nCopies(3, null), total, "", List.of(total));

    assertThat(result.unitAmountsCents()).containsExactly(null, null, null);
    assertThat(result.totals().settlementAmountCents()).isEqualTo(total);
  }

  @Test
  void persistsHeaderOnlySingleUnitReceipt() {
    var result = service.resolve(List.of(15900L), Collections.singletonList(null), 15000L, "", List.of(15000L));

    assertThat(result.unitAmountsCents()).containsExactly(15000L);
  }

  @Test
  void preservesLegacyWaiversAndPersistsZeroForEveryUnit() {
    var result = service.resolve(originals, Collections.nCopies(3, null), 0L, "门店免单", List.of());

    assertThat(result.unitAmountsCents()).containsExactly(0L, 0L, 0L);
    assertThat(result.totals().adjustmentCents()).isEqualTo(142100L);
  }

  @Test
  void allowsAnIndividualWaivedUnitWithAReason() {
    var result = service.resolve(originals, List.of(97300L, 0L, 28000L), null, "第二单免单", List.of(125300L));

    assertThat(result.unitAmountsCents()).containsExactly(97300L, 0L, 28000L);
  }

  @Test
  void rejectsIndividualWaiverWithoutAReason() {
    assertThatThrownBy(() -> service.resolve(originals, List.of(97300L, 0L, 28000L), null, "", List.of(125300L)))
      .isInstanceOf(ResponseStatusException.class).hasMessageContaining("0.00 元单元实收必须填写免单原因");
  }

  @Test
  void rejectsWholeOrderWaiverWithoutAReasonOrWithPayments() {
    assertThatThrownBy(() -> service.resolve(originals, Collections.nCopies(3, null), 0L, "", List.of()))
      .isInstanceOf(ResponseStatusException.class).hasMessageContaining("0.00 元结算必须填写免单原因");
    assertThatThrownBy(() -> service.resolve(originals, Collections.nCopies(3, null), 0L, "免单", List.of(1L)))
      .isInstanceOf(ResponseStatusException.class).hasMessageContaining("免单请勿填写收款金额");
  }

  @Test
  void rejectsNegativeUnitAndHeaderReceipts() {
    assertThatThrownBy(() -> service.resolve(originals, List.of(97300L, -1L, 28000L), null, "", List.of(125299L)))
      .isInstanceOf(ResponseStatusException.class).hasMessageContaining("单元实收金额不得为负数");
    assertThatThrownBy(() -> service.resolve(originals, Collections.nCopies(3, null), -1L, "", List.of()))
      .isInstanceOf(ResponseStatusException.class).hasMessageContaining("实收金额不得为负数");
  }

  @ParameterizedTest
  @ValueSource(longs = {0L, -1L})
  void rejectsNonpositivePaymentAmounts(long amount) {
    assertThatThrownBy(() -> service.resolve(originals, Collections.nCopies(3, null), null, "", List.of(amount)))
      .isInstanceOf(ResponseStatusException.class).hasMessageContaining("收款金额必须为正整数分");
  }

  @Test
  void rejectsOriginalUnitAndPaymentSumOverflow() {
    assertThatThrownBy(() -> service.resolve(List.of(Long.MAX_VALUE, 1L), Arrays.asList(null, null), null, "", List.of()))
      .isInstanceOf(ResponseStatusException.class).hasMessageContaining("金额合计超出支持范围");
    assertThatThrownBy(() -> service.resolve(originals, List.of(Long.MAX_VALUE, 1L, 1L), null, "", List.of()))
      .isInstanceOf(ResponseStatusException.class).hasMessageContaining("金额合计超出支持范围");
    assertThatThrownBy(() -> service.resolve(originals, Collections.nCopies(3, null), null, "", List.of(Long.MAX_VALUE, 1L)))
      .isInstanceOf(ResponseStatusException.class).hasMessageContaining("金额合计超出支持范围");
  }

  @Test
  void detailTotalsUseCurrentHeaderReceiptsRatherThanEstimatedUnitPrices() {
    assertThat(service.totals(originals, 140300L))
      .isEqualTo(new SettlementAmountService.Totals(142100L, 140300L, 1800L));
  }

  @Test
  void migrationAddsNullableNonnegativeSnapshotWithoutRewritingHistory() throws Exception {
    String sql = Files.readString(Path.of("src/main/resources/db/migration/V109__sales_order_unit_receipts.sql"));

    assertThat(sql)
      .contains("ADD COLUMN IF NOT EXISTS settlement_amount_cents BIGINT")
      .contains("DROP CONSTRAINT IF EXISTS sales_order_line_settlement_amount_cents_check")
      .contains("CHECK (settlement_amount_cents >= 0)")
      .doesNotContain("UPDATE ", "DELETE ", "NOT NULL");
  }
}
