package com.chengxin.massage.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class ServiceExtensionCancellationMigrationTest {
  @Test
  void keepsHistoryWhenAnExtensionIsCancelled() throws Exception {
    String sql = Files.readString(Path.of("src/main/resources/db/migration/V84__allow_extension_history_after_cancellation.sql"))
      .replaceAll("\\s+", " ")
      .trim()
      .toLowerCase();

    assertThat(sql).contains("drop constraint if exists service_session_duration_change_log_service_session_extension_id_fkey");
    assertThat(sql).contains("foreign key (service_session_extension_id) references service_session_extension(id) on delete set null");
  }
}
