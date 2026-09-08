package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class StorePrintSettingRegressionTest {
  @Test
  void migrationEnablesClockTypeForExistingStores() throws Exception {
    String sql = Files.readString(Path.of("src/main/resources/db/migration/V77__store_print_clock_type.sql"));
    assertThat(sql).contains("showClockType");
    assertThat(sql).contains("jsonb_set");
    assertThat(sql).contains("true");
  }

  @Test
  void controllerPersistsContentOptionsAsJson() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/sales/StorePrintSettingController.java"));
    assertThat(source).contains("content_options=cast(:contentOptions as jsonb)");
    assertThat(source).contains("Map<String, Boolean> contentOptions");
  }
}
