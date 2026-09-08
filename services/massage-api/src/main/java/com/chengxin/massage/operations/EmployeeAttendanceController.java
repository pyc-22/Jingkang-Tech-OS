package com.chengxin.massage.operations;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/employee-attendance")
@CrossOrigin(origins = "*")
public class EmployeeAttendanceController {
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final EmployeeAttendanceService attendance;
  private final AuditService audits;
  private final BusinessClockService businessClock;

  EmployeeAttendanceController(StoreContextService storeContext, AdminSessionService adminSessions,
                               EmployeeAttendanceService attendance, AuditService audits,
                               BusinessClockService businessClock) {
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.attendance = attendance;
    this.audits = audits;
    this.businessClock = businessClock;
  }

  @GetMapping
  List<EmployeeAttendanceService.AttendanceRow> list(@RequestParam(defaultValue = "") String date,
                                                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    requireManage(authorization);
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return attendance.synchronize(storeId, parseDate(storeId, date));
  }

  @PostMapping("/clock-in")
  @Transactional
  EmployeeAttendanceService.AttendanceRow clockIn(@Valid @RequestBody AttendanceInput input,
                                                  @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                                  @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    requireManage(authorization);
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    EmployeeAttendanceService.AttendanceRow before = null;
    try { before = attendance.synchronize(storeId, businessClock.currentBusinessDate(storeId)).stream().filter(item -> item.employeeId().equals(input.employeeId())).findFirst().orElse(null); }
    catch (RuntimeException ignored) { }
    EmployeeAttendanceService.AttendanceRow result = attendance.clockIn(storeId, input.employeeId(), input.note());
    audits.record(authorization, storeId, "ATTENDANCE", "EMPLOYEE_CLOCKED_IN", "employee_attendance", result.id(), "员工上班打卡", before, result);
    return result;
  }

  @PostMapping("/clock-out")
  @Transactional
  EmployeeAttendanceService.AttendanceRow clockOut(@Valid @RequestBody AttendanceInput input,
                                                   @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                                   @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    requireManage(authorization);
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    EmployeeAttendanceService.AttendanceRow before = attendance.synchronize(storeId, businessClock.currentBusinessDate(storeId)).stream().filter(item -> item.employeeId().equals(input.employeeId())).findFirst().orElse(null);
    EmployeeAttendanceService.AttendanceRow result = attendance.clockOut(storeId, input.employeeId(), input.note());
    audits.record(authorization, storeId, "ATTENDANCE", "EMPLOYEE_CLOCKED_OUT", "employee_attendance", result.id(), "员工下班打卡", before, result);
    return result;
  }

  private void requireManage(String authorization) { adminSessions.requirePermission(authorization, "FOUNDATION_MANAGE"); }
  private LocalDate parseDate(UUID storeId, String value) {
    if (value == null || value.isBlank()) return businessClock.currentBusinessDate(storeId);
    try { return LocalDate.parse(value); }
    catch (RuntimeException exception) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Date must use YYYY-MM-DD"); }
  }

  record AttendanceInput(@NotNull UUID employeeId, @Size(max = 240) String note) {}
}
