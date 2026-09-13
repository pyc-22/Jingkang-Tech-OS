package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/** Contract checks for historical order creation and order-list metadata. */
class HistoricalBackfillSalesOrderContractTest {
  @Test
  void exposesSeparateBackfillCreationAndHistoricalListFilter() throws Exception {
    String source = Files.readString(Path.of(
        "src/main/java/com/chengxin/massage/sales/SalesOrderController.java"));

    assertThat(source)
        .contains("@PostMapping(\"/historical-backfill\")")
        .contains("@RequestParam(required = false) Boolean historicalBackfill")
        .contains("and o.is_historical_backfill=:historicalBackfill")
        .contains("o.is_historical_backfill")
        .contains("o.backfill_date")
        .contains("o.backfill_by")
        .contains("o.backfill_at");
  }

  @Test
  void exposesScopedMineHistoryEndpointUsingAuthenticatedActorAndStore() throws Exception {
    String source = Files.readString(Path.of(
        "src/main/java/com/chengxin/massage/sales/SalesOrderController.java"));
    int endpoint = source.indexOf("@GetMapping(\"/historical-backfills/mine\")");
    assertThat(endpoint).as("scoped historical backfill endpoint").isGreaterThanOrEqualTo(0);
    String method = source.substring(endpoint,
        Math.min(source.length(), endpoint + 5000));
    assertThat(method)
        .contains("storeContext.currentStore(authorization, requestedStoreId)")
        .contains("adminSessions.authenticatedIdentity(authorization)")
        .contains("o.store_id=:store")
        .contains("o.backfill_by=:backfillBy")
        .contains(".param(\"backfillBy\", actor.userId())")
        .doesNotContain("input.backfillBy")
        .doesNotContain("@RequestParam UUID backfillBy");
  }

  @Test
  void validatesDatePermissionLinesAndPositivePaymentsBeforePersistingBackfill() throws Exception {
    String source = Files.readString(Path.of(
        "src/main/java/com/chengxin/massage/sales/SalesOrderController.java"));
    int endpoint = source.indexOf("@PostMapping(\"/historical-backfill\")");
    assertThat(endpoint).as("historical backfill endpoint").isGreaterThanOrEqualTo(0);
    String method = source.substring(endpoint,
        Math.min(source.length(), endpoint + 16000));

    assertThat(method)
        .contains("currentBusinessDate")
        .contains("isAfter(currentBusinessDate)")
        .contains("store_manager_backfill_permission")
        .contains("HISTORICAL_ORDER_CREATE")
        .contains("is_historical_backfill");
    assertThat(source)
        .contains("@NotEmpty List<@Valid HistoricalBackfillLineInput> lines")
        .contains("@Min(1) Long amountCents");
  }

  @Test
  void writesBusinessDateAndTechnicianCommissionAgainstTheSelectedBackfillDate() throws Exception {
    String source = Files.readString(Path.of(
        "src/main/java/com/chengxin/massage/sales/SalesOrderController.java"));
    assertThat(source)
        .contains(".param(\"businessDate\", input.backfillDate())")
        .contains(".param(\"backfillDate\", input.backfillDate())")
        .contains("insertCommissionRecord")
        .contains("input.backfillDate())")
        .contains("audits.record(authorization, storeId, \"SALES\", \"HISTORICAL_ORDER_BACKFILLED\"");
  }

  @Test
  void isolatesHistoricalMemberAndWalletToTheSelectedStore() throws Exception {
    String source = Files.readString(Path.of(
        "src/main/java/com/chengxin/massage/sales/SalesOrderController.java"));
    int endpoint = source.indexOf("@PostMapping(\"/historical-backfill\")");
    String method = source.substring(endpoint,
        Math.min(source.length(), endpoint + 16000));

    assertThat(method)
        .contains("ensureHistoricalMember(storeId, input.memberId())")
        .contains("consumeHistoricalWallet(storeId, input.memberId(), payment.amountCents(), orderId, input.backfillDate())");
    assertThat(source)
        .contains("registered_store_id=:store")
        .contains("w.opened_store_id=:store")
        .contains("where id=:id and opened_store_id=:store");
  }

  @Test
  void keepsSharedWalletBehaviorForOrdinarySettlement() throws Exception {
    String source = Files.readString(Path.of(
        "src/main/java/com/chengxin/massage/sales/SalesOrderController.java"));
    int settlement = source.indexOf("@PostMapping(\"/settle\")");
    assertThat(settlement).isGreaterThanOrEqualTo(0);
    assertThat(source.indexOf("consumeWallet(storeId, input.memberId(), payment.amountCents(), orderId, businessDate)", settlement))
        .isGreaterThanOrEqualTo(settlement);
  }

  @Test
  void historicalBackfillUsesTheSharedOfflineIdempotencyReceiptPath() throws Exception {
    String filter = Files.readString(Path.of(
        "src/main/java/com/chengxin/massage/admin/OfflineOperationIdempotencyFilter.java"));
    assertThat(filter)
        .contains("path.equals(\"/api/v1/sales-orders/historical-backfill\")")
        .contains("X-Offline-Operation-Id")
        .contains("status='APPLIED'");
  }

  @Test
  void aliasesBackfillSummaryColumnsToRecordPropertyNames() throws Exception {
    String source = Files.readString(Path.of(
        "src/main/java/com/chengxin/massage/sales/SalesOrderController.java"));
    assertThat(source).contains("o.is_historical_backfill historical_backfill")
        .contains("o.backfill_date backfill_date")
        .contains("o.backfill_by backfill_by")
        .contains("o.backfill_at backfill_at");
  }
}
