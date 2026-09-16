package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.simple.JdbcClient;

class EmployeeAttendanceServiceTest {
  private final UUID store = UUID.randomUUID();
  private final UUID employee = UUID.randomUUID();
  private final LocalDate date = LocalDate.of(2026, 9, 14);
  private final JdbcClient jdbc = mock(JdbcClient.class);
  private final JdbcClient.StatementSpec statement = mock(JdbcClient.StatementSpec.class);
  private final JdbcClient.StatementSpec upsert = mock(JdbcClient.StatementSpec.class);
  @SuppressWarnings("unchecked")
  private final JdbcClient.MappedQuerySpec<EmployeeAttendanceService.AttendanceSeed> seeds = mock(JdbcClient.MappedQuerySpec.class);
  private final EmployeeAttendanceService service = new EmployeeAttendanceService(jdbc, mock(BusinessClockService.class));

  @BeforeEach
  void setUp() {
    when(jdbc.sql(anyString())).thenAnswer(call -> call.getArgument(0, String.class).contains("insert into employee_attendance") ? upsert : statement);
    when(statement.param(anyString(), any())).thenReturn(statement);
    when(upsert.param(anyString(), any())).thenReturn(upsert);
    when(statement.query(EmployeeAttendanceService.AttendanceSeed.class)).thenReturn(seeds);
    @SuppressWarnings("unchecked")
    JdbcClient.MappedQuerySpec<EmployeeAttendanceService.AttendanceRow> rows = mock(JdbcClient.MappedQuerySpec.class);
    when(statement.query(EmployeeAttendanceService.AttendanceRow.class)).thenReturn(rows);
    when(rows.list()).thenReturn(List.of());
  }

  private void synchronize(String scheduleStatus, String clockIn, String clockOut) {
    when(seeds.list()).thenReturn(List.of(new EmployeeAttendanceService.AttendanceSeed(employee, "Test", "TECHNICIAN", "Technician",
      LocalTime.of(10, 0), LocalTime.of(18, 0), scheduleStatus,
      clockIn == null ? null : OffsetDateTime.parse(clockIn), clockOut == null ? null : OffsetDateTime.parse(clockOut), "Asia/Shanghai")));
    service.synchronize(store, date);
  }

  @Test
  void importsOriginalClockInAndCalculatesLateMinutesInStoreTimezone() {
    synchronize("SCHEDULED", "2026-09-14T02:17:00Z", null);
    verify(upsert).param("store", store);
    verify(upsert).param("employee", employee);
    verify(upsert).param("date", date);
    verify(upsert).param("clockIn", OffsetDateTime.parse("2026-09-14T02:17:00Z"));
    verify(upsert).param("late", 17);
    verify(upsert).param("status", "LATE");
    verify(upsert).param("source", "TECHNICIAN");
  }

  @Test
  void importsClockOutAndCalculatesEarlyLeave() {
    synchronize("SCHEDULED", "2026-09-14T09:55:00+08:00", "2026-09-14T17:40:00+08:00");
    verify(upsert).param("late", 0);
    verify(upsert).param("early", 20);
    verify(upsert).param("status", "LEFT_EARLY");
    verify(upsert).param("clockOut", OffsetDateTime.parse("2026-09-14T17:40:00+08:00"));
  }

  @Test
  void overnightClockOutIsCompletedInsteadOfEarlyLeave() {
    synchronize("SCHEDULED", "2026-09-14T10:00:00+08:00", "2026-09-15T01:00:00+08:00");
    verify(upsert).param("early", 0);
    verify(upsert).param("status", "COMPLETED");
  }

  @Test
  void nextCalendarDayClockInStillBelongsToRequestedBusinessDate() {
    synchronize("SCHEDULED", "2026-09-15T01:00:00+08:00", null);
    verify(upsert).param("date", date);
    verify(upsert).param("late", 900);
    verify(upsert).param("status", "LATE");
  }

  @Test
  void unscheduledTechnicianClockInCountsAsPresent() {
    synchronize(null, "2026-09-14T11:00:00+08:00", null);
    verify(upsert).param("late", 0);
    verify(upsert).param("status", "PRESENT");
  }

  @Test
  void cancelledScheduleDoesNotCreateEarlyLeaveOrLatePenalties() {
    synchronize("CANCELLED", "2026-09-14T11:00:00+08:00", "2026-09-14T12:00:00+08:00");
    verify(upsert).param("late", 0);
    verify(upsert).param("early", 0);
    verify(upsert).param("status", "COMPLETED");
  }

  @Test
  void noTechnicianClockLeavesManualAttendanceIntact() {
    synchronize(null, null, null);
    verify(upsert).param("source", "MANUAL");
    verify(upsert).param("clockIn", null);
    verify(upsert).param("clockOut", null);
    ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
    verify(jdbc, times(4)).sql(sql.capture());
    assertThat(sql.getAllValues().getFirst()).contains("t.employee_id=e.id", "clock.store_id=a.store_id", "clock.business_date=:date", "a.store_id=:store");
    assertThat(sql.getAllValues().get(1)).contains("on conflict(store_id,employee_id,attendance_date)",
      "coalesce(excluded.clock_in_at,employee_attendance.clock_in_at)",
      "coalesce(excluded.clock_out_at,employee_attendance.clock_out_at)",
      "when employee_attendance.clock_out_at is not null then employee_attendance.status",
      "when employee_attendance.clock_in_at is not null then employee_attendance.status");
  }

  @Test
  void historicalAndFutureSchedulesUseTheirFullStoreLocalDate() {
    var zone = java.time.ZoneId.of("Asia/Shanghai");
    var now = java.time.Instant.parse("2026-09-16T03:00:00Z");
    assertThat(EmployeeAttendanceService.initialStatus(date, zone, "SCHEDULED", LocalTime.of(10,0), LocalTime.of(18,0), now)).isEqualTo("ABSENT");
    assertThat(EmployeeAttendanceService.initialStatus(date.plusDays(3), zone, "SCHEDULED", LocalTime.of(10,0), LocalTime.of(18,0), now)).isEqualTo("NOT_STARTED");
    assertThat(EmployeeAttendanceService.initialStatus(date.plusDays(2), zone, "SCHEDULED", LocalTime.of(10,0), LocalTime.of(18,0), now)).isEqualTo("LATE");
    assertThat(EmployeeAttendanceService.initialStatus(date.plusDays(2), java.time.ZoneId.of("America/New_York"), "SCHEDULED", LocalTime.of(10,0), LocalTime.of(18,0), now)).isEqualTo("NOT_STARTED");
  }

  @Test
  void overnightScheduledEndBelongsToTheNextDay() {
    var zone = java.time.ZoneId.of("Asia/Shanghai");
    assertThat(EmployeeAttendanceService.shiftEnd(date, LocalTime.of(22,0), LocalTime.of(6,0), zone).toLocalDate()).isEqualTo(date.plusDays(1));
    assertThat(EmployeeAttendanceService.initialStatus(date, zone, "SCHEDULED", LocalTime.of(22,0), LocalTime.of(6,0),
      java.time.Instant.parse("2026-09-14T15:00:00Z"))).isEqualTo("LATE");
    assertThat(EmployeeAttendanceService.initialStatus(date, zone, "SCHEDULED", LocalTime.of(22,0), LocalTime.of(6,0),
      java.time.Instant.parse("2026-09-14T22:00:00Z"))).isEqualTo("ABSENT");
  }
}
