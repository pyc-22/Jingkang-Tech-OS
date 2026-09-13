package com.chengxin.massage.admin;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/** Contract checks for the additive historical-order migration. */
class HistoricalBackfillMigrationTest {
  private String migrationSql() throws Exception {
    return Files.readString(Path.of(
        "src/main/resources/db/migration/V91__historical_order_backfill.sql"))
        .replaceAll("\\s+", " ")
        .trim()
        .toLowerCase();
  }

  @Test
  void addsThePermissionAndManagerGrantTableWithoutImplicitRoleGrants() throws Exception {
    String sql = migrationSql();

    assertThat(sql)
        .contains("insert into permission")
        .contains("historical_order_create")
        .contains("select gen_random_uuid()")
        .contains("where not exists")
        .contains("on conflict (code) do nothing")
        .contains("create table if not exists store_manager_backfill_permission")
        .contains("unique (store_id, manager_id)")
        .contains("is_active boolean not null default false");
    // The permission is deliberately not assigned to STORE_MANAGER by the migration.
    assertThat(sql).doesNotContain("insert into role_permission");
  }

  @Test
  void addsOnlyNullableBackfillMetadataAndPreservesExistingOrders() throws Exception {
    String sql = migrationSql();

    assertThat(sql)
        .contains("add column if not exists is_historical_backfill boolean not null default false")
        .contains("add column if not exists backfill_date date")
        .contains("add column if not exists backfill_by uuid")
        .contains("add column if not exists backfill_at timestamptz")
        .contains("sales_order_historical_backfill_idx")
        .contains("where is_historical_backfill = true")
        .contains("comment on column sales_order.is_historical_backfill");
    assertThat(sql)
        .doesNotMatch("(?s).*\\bdrop\\s+(table|column|constraint|index)\\b.*")
        .doesNotMatch("(?s).*\\btruncate\\b.*")
        .doesNotMatch("(?s).*\\bdelete\\s+from\\b.*");
  }

  @Test
  void keepsGrantAuditActorsAndTenantIsolationInTheSchema() throws Exception {
    String sql = migrationSql();

    assertThat(sql)
        .contains("tenant_id uuid not null references tenant(id)")
        .contains("store_id uuid not null references store(id)")
        .contains("manager_id uuid not null references app_user(id)")
        .contains("granted_by uuid references app_user(id) on delete set null")
        .contains("revoked_by uuid references app_user(id) on delete set null")
        .contains("store_manager_backfill_permission_manager_idx");
  }

  @Test
  void declaresTheExpectedAdministratorAndCreationRouteContracts() throws Exception {
    String permissionFilter = Files.readString(Path.of(
        "src/main/java/com/chengxin/massage/admin/BusinessPermissionFilter.java"));
    assertThat(permissionFilter)
        .contains("/api/v1/sales-orders/historical-backfill")
        .contains("HISTORICAL_ORDER_CREATE");
  }
}
