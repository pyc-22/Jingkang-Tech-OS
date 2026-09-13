package com.chengxin.massage.admin;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/** Contract checks for administrator grant/revoke and audit endpoints. */
class HistoricalBackfillAccessControlContractTest {
  @Test
  void exposesManagerGrantToggleAndHistoricalRecordQueryRoutes() throws Exception {
    String source = Files.readString(Path.of(
        "src/main/java/com/chengxin/massage/admin/AccessControlController.java"));

    assertThat(source)
        .contains("@GetMapping(\"/stores/{storeId}/backfill-managers\")")
        .contains("@PutMapping(\"/stores/{storeId}/backfill-managers/{managerId}\")")
        .contains("@GetMapping(\"/historical-backfills\")")
        .contains("store_manager_backfill_permission")
        .contains("HISTORICAL_BACKFILL_PERMISSION_GRANTED")
        .contains("HISTORICAL_BACKFILL_PERMISSION_REVOKED")
        .contains("audits.record");
  }

  @Test
  void filtersHistoricalRecordsByStoreDateAndActor() throws Exception {
    String source = Files.readString(Path.of(
        "src/main/java/com/chengxin/massage/admin/AccessControlController.java"));

    assertThat(source)
        .contains("o.is_historical_backfill=true")
        .contains("o.store_id=:storeId")
        .contains("o.backfill_date>=:fromDate")
        .contains("o.backfill_date<=:toDate")
        .contains("o.backfill_by=:backfillBy")
        .contains("@RequestParam");
  }

  @Test
  void recordsGrantAndRevokeActorsAndTimestamps() throws Exception {
    String source = Files.readString(Path.of(
        "src/main/java/com/chengxin/massage/admin/AccessControlController.java"));

    assertThat(source)
        .contains("granted_by")
        .contains("granted_at")
        .contains("revoked_by")
        .contains("revoked_at")
        .contains("is_active")
        .contains("requireTenantAdmin")
        .contains("ensureStoreManagerScope");
  }
}
