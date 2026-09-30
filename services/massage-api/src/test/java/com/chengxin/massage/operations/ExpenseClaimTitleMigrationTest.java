package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class ExpenseClaimTitleMigrationTest {
  @Test
  void addsAnOptionalTitleForHistoricalClaims() throws Exception {
    String sql = Files.readString(Path.of(
        "src/main/resources/db/migration/V105__expense_claim_title.sql"))
        .replaceAll("\\s+", " ").trim().toLowerCase();

    assertThat(sql).contains("alter table expense_claim add column if not exists title varchar(200)");
    assertThat(sql).contains("comment on column expense_claim.title");
  }
}
