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

  @Test
  void rollsBackAcrossYearAndLeapDayBoundaries() {
    assertThat(BusinessClockService.resolveBusinessDate(
      OffsetDateTime.parse("2026-01-01T04:59:59+08:00"), SHANGHAI, LocalTime.of(5, 0)))
      .isEqualTo(LocalDate.of(2025, 12, 31));
    assertThat(BusinessClockService.resolveBusinessDate(
      OffsetDateTime.parse("2028-03-01T04:59:59+08:00"), SHANGHAI, LocalTime.of(5, 0)))
      .isEqualTo(LocalDate.of(2028, 2, 29));
  }

  @Test
  void midnightCutoffNeverMovesLocalMidnightToPreviousDay() {
    assertThat(BusinessClockService.resolveBusinessDate(
      OffsetDateTime.parse("2026-09-16T00:00:00+08:00"), SHANGHAI, LocalTime.MIDNIGHT))
      .isEqualTo(LocalDate.of(2026, 9, 16));
  }

  @Test
  void repeatedDstHourUsesStoreLocalDate() {
    ZoneId newYork = ZoneId.of("America/New_York");
    for (String instant : new String[] {"2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"}) {
      assertThat(BusinessClockService.resolveBusinessDate(
        OffsetDateTime.parse(instant), newYork, LocalTime.of(5, 0)))
        .isEqualTo(LocalDate.of(2026, 10, 31));
    }
  }
}
