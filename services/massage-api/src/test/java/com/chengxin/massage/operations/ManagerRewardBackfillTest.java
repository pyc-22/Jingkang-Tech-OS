package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import org.springframework.web.server.ResponseStatusException;

import org.junit.jupiter.api.Test;

class ManagerRewardBackfillTest {
  private static final LocalDate CURRENT = LocalDate.of(2026, 10, 2);

  @Test
  void sameDaySubmissionIsNormal() {
    assertThat(ManagerRewardService.submissionKind(CURRENT, CURRENT)).isEqualTo("NORMAL");
  }

  @Test
  void earlierSameMonthAndPreviousMonthSubmissionsAreBackfill() {
    assertThat(ManagerRewardService.submissionKind(LocalDate.of(2026, 10, 1), CURRENT)).isEqualTo("BACKFILL");
    assertThat(ManagerRewardService.submissionKind(LocalDate.of(2026, 9, 30), CURRENT)).isEqualTo("BACKFILL");
  }

  @Test
  void futureSubmissionIsRejected() {
    assertThatThrownBy(() -> ManagerRewardService.submissionKind(CURRENT.plusDays(1), CURRENT))
        .isInstanceOfSatisfying(ResponseStatusException.class, exception -> {
          assertThat(exception.getStatusCode().value()).isEqualTo(400);
          assertThat(exception.getReason()).isEqualTo("不能预录未来营业日的约客");
        });
  }

  @Test
  void serviceCarriesSubmissionKindThroughQueriesAndLeavesItUnchangedOnCorrection() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/operations/ManagerRewardService.java"));
    assertThat(source).contains("submission_kind,order_id,member_id")
        .contains(".param(\"submissionKind\", kind)")
        .contains("select r.id,r.store_id,r.business_date,r.submission_kind,r.order_id")
        .contains("requireMonthUnlocked(storeId, date);")
        .contains("if (!order.businessDate().equals(current.businessDate())) throw badRequest(\"只能更正同一营业日的约客记录\")");
    assertThat(source).doesNotContain("submission_kind=:kind");
  }
}
