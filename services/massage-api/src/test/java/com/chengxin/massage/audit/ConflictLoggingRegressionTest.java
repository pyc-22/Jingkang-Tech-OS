package com.chengxin.massage.audit;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class ConflictLoggingRegressionTest {
  @Test
  void allBadRequestAndConflictResponsesEmitStructuredWarnContext() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/audit/AuditOutcomeFilter.java"));

    assertThat(source).contains("HTTP write rejected");
    assertThat(source).contains("X-Store-Id");
    assertThat(source).contains("X-Offline-Operation-Id");
    assertThat(source).contains("failureReason(request, status, requestFailure)");
    assertThat(source).contains("statusFromFailure(requestFailure, response.getStatus())");
  }
}
