package com.chengxin.massage.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class UnlimitedTechnicianExtensionsMigrationTest {
  @Test
  void resetsLegacyExtensionCapsWithoutChangingTheTotalDurationColumn() throws Exception {
    String sql = Files.readString(Path.of(
        "src/main/resources/db/migration/V92__unlimited_technician_extensions.sql"))
      .replaceAll("\\s+", " ")
      .trim()
      .toLowerCase();

    assertThat(sql).contains("update store");
    assertThat(sql).contains("alter column technician_extension_max_minutes set default 0");
    assertThat(sql).contains("set technician_extension_max_minutes = 0");
    assertThat(sql).contains("where technician_extension_max_minutes <> 0");
    assertThat(sql).doesNotContain("service_duration_max_minutes = 0");
  }
}
