package com.chengxin.massage.mobile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.catalog.TechnicianSchedulePolicy;
import com.chengxin.massage.catalog.TechnicianSchedulePolicy.ClockInStatus;
import com.chengxin.massage.operations.BusinessClockService;
import com.chengxin.massage.operations.EmployeeAttendanceService;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.server.ResponseStatusException;

class TechnicianAttendanceControllerTest {
  private final UUID store = UUID.randomUUID();
  private final UUID technician = UUID.randomUUID();
  private final LocalDate date = LocalDate.of(2026, 9, 15);
  private final OffsetDateTime clockIn = OffsetDateTime.parse("2026-09-16T01:00:00+08:00");
  private final JdbcClient jdbc = mock(JdbcClient.class);
  private final JdbcClient.StatementSpec statement = mock(JdbcClient.StatementSpec.class);
  private final MobileSessionService sessions = mock(MobileSessionService.class);
  private final TechnicianSchedulePolicy policy = mock(TechnicianSchedulePolicy.class);
  private final EmployeeAttendanceService attendance = mock(EmployeeAttendanceService.class);
  private final BusinessClockService clock = mock(BusinessClockService.class);
  private TechnicianAttendanceController controller;

  @BeforeEach
  void setUp() {
    when(jdbc.sql(anyString())).thenReturn(statement);
    when(statement.param(anyString(), any())).thenReturn(statement);
    when(statement.update()).thenReturn(1);
    @SuppressWarnings("unchecked")
    JdbcClient.MappedQuerySpec<TechnicianAttendanceController.Technician> query = mock(JdbcClient.MappedQuerySpec.class);
    when(statement.query(TechnicianAttendanceController.Technician.class)).thenReturn(query);
    when(query.optional()).thenReturn(Optional.of(new TechnicianAttendanceController.Technician(technician, "T007", "Test", store)));
    when(clock.currentBusinessDate(store)).thenReturn(date);
    controller = new TechnicianAttendanceController(jdbc, sessions, mock(AdminSessionService.class),
      mock(StoreContextService.class), policy, clock, mock(AuditService.class), attendance);
  }

  private ClockInStatus status(boolean in, OffsetDateTime started, OffsetDateTime ended) {
    return new ClockInStatus(technician, store, date, in, false, started, ended);
  }

  @Test
  void clockInSynchronizesTheSameBusinessDay() {
    ClockInStatus result = status(true, clockIn, null);
    when(policy.clockInStatus(store, technician)).thenReturn(status(false, null, null), result);
    assertThat(controller.clockIn("Bearer test", null)).isEqualTo(result);
    var order = inOrder(statement, attendance);
    order.verify(statement).update();
    order.verify(attendance).synchronize(store, date);
  }

  @Test
  void duplicateClockInRepairsAttendanceWithoutAnotherClockWrite() {
    ClockInStatus result = status(true, clockIn, null);
    when(policy.clockInStatus(store, technician)).thenReturn(result);
    assertThat(controller.clockIn("Bearer test", null)).isEqualTo(result);
    verify(statement, never()).update();
    verify(attendance).synchronize(store, date);
  }

  @Test
  void clockOutSynchronizesAfterTheClockRecordIsUpdated() {
    ClockInStatus result = status(false, clockIn, clockIn.plusHours(2));
    when(policy.clockInStatus(store, technician)).thenReturn(status(true, clockIn, null), result);
    assertThat(controller.clockOut("Bearer test", null)).isEqualTo(result);
    var order = inOrder(statement, attendance);
    order.verify(statement).update();
    order.verify(attendance).synchronize(store, date);
  }

  @Test
  void rejectedClockOutDoesNotSynchronize() {
    when(policy.clockInStatus(store, technician)).thenReturn(status(false, null, null));
    assertThatThrownBy(() -> controller.clockOut("Bearer test", null)).isInstanceOf(ResponseStatusException.class);
    verifyNoInteractions(attendance);
    verify(statement, never()).update();
  }
}
