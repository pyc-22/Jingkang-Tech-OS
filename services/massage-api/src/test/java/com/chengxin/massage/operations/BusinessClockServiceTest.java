package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;

class BusinessClockServiceTest {
  private static final ZoneId SHANGHAI = ZoneId.of("Asia/Shanghai");

  @Test
  void assignsTimeBeforeCutoffToPreviousBusinessDay() {
    LocalDate result = BusinessClockService.resolveBusinessDate(
      OffsetDateTime.parse("2026-08-09T04:59:59+08:00"), SHANGHAI, LocalTime.of(5, 0));

    assertThat(result).isEqualTo(LocalDate.of(2026, 8, 8));
  }

  @Test
  void startsNewBusinessDayExactlyAtCutoff() {
    LocalDate result = BusinessClockService.resolveBusinessDate(
      OffsetDateTime.parse("2026-08-09T05:00:00+08:00"), SHANGHAI, LocalTime.of(5, 0));

    assertThat(result).isEqualTo(LocalDate.of(2026, 8, 9));
  }

  @Test
  void supportsDifferentCutoffsForDifferentStores() {
    OffsetDateTime event = OffsetDateTime.parse("2026-08-09T03:30:00+08:00");

    assertThat(BusinessClockService.resolveBusinessDate(event, SHANGHAI, LocalTime.of(5, 0)))
      .isEqualTo(LocalDate.of(2026, 8, 8));
    assertThat(BusinessClockService.resolveBusinessDate(event, SHANGHAI, LocalTime.of(2, 0)))
      .isEqualTo(LocalDate.of(2026, 8, 9));
  }

  @Test
  void convertsInstantUsingStoreTimezoneBeforeApplyingCutoff() {
    OffsetDateTime event = OffsetDateTime.parse("2026-08-08T20:30:00Z");

    assertThat(BusinessClockService.resolveBusinessDate(event, SHANGHAI, LocalTime.of(5, 0)))
      .isEqualTo(LocalDate.of(2026, 8, 8));
  }
}
