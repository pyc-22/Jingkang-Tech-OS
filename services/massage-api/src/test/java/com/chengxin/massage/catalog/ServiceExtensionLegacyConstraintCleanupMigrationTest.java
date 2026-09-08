package com.chengxin.massage.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class ServiceExtensionLegacyConstraintCleanupMigrationTest {
  @Test
  void removesLegacyNoActionExtensionHistoryConstraint() throws Exception {
    String sql = Files.readString(Path.of(
        "src/main/resources/db/migration/V85__remove_legacy_extension_history_fk.sql"))
        .replaceAll("\\s+", " ")
        .trim()
        .toLowerCase();

    assertThat(sql).contains(
        "drop constraint if exists service_session_duration_chan_service_session_extension_id_fkey");
  }
}
