package com.chengxin.massage.mobile;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.catalog.TechnicianSchedulePolicy;
import com.chengxin.massage.operations.BusinessClockService;
import com.chengxin.massage.operations.EmployeeAttendanceService;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
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

/** Technician attendance endpoints.  Mobile users can only operate on their own record. */
@RestController
@RequestMapping("/api/v1/technicians")
@CrossOrigin(origins = "*")
public class TechnicianAttendanceController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final MobileSessionService mobileSessions;
  private final AdminSessionService adminSessions;
  private final StoreContextService storeContext;
  private final TechnicianSchedulePolicy schedulePolicy;
  private final BusinessClockService businessClock;
  private final AuditService audits;
  private final EmployeeAttendanceService employeeAttendance;

  TechnicianAttendanceController(JdbcClient jdbc, MobileSessionService mobileSessions,
                                 AdminSessionService adminSessions, StoreContextService storeContext,
                                 TechnicianSchedulePolicy schedulePolicy, BusinessClockService businessClock,
                                 AuditService audits, EmployeeAttendanceService employeeAttendance) {
    this.jdbc = jdbc;
    this.mobileSessions = mobileSessions;
    this.adminSessions = adminSessions;
    this.storeContext = storeContext;
    this.schedulePolicy = schedulePolicy;
    this.businessClock = businessClock;
    this.audits = audits;
    this.employeeAttendance = employeeAttendance;
  }

  @PostMapping("/clock-in")
  @Transactional
  TechnicianSchedulePolicy.ClockInStatus clockIn(
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestBody(required = false) ClockInput input) {
    Technician technician = currentTechnician(authorization);
    LocalDate date = businessClock.currentBusinessDate(technician.storeId());
    TechnicianSchedulePolicy.ClockInStatus before = schedulePolicy.clockInStatus(technician.storeId(), technician.id());
    if (before.clockedIn()) {
      employeeAttendance.synchronize(technician.storeId(), date);
      return before;
    }
    if (!before.legacyCompatible() && before.clockOutTime() != null) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "技师今日已下班，请次日重新打卡");
    }
    OffsetDateTime now = OffsetDateTime.now();
    // The unique key makes duplicate mobile taps/concurrent requests idempotent.
    jdbc.sql("insert into technician_clock_in(id,tenant_id,technician_id,store_id,clock_in_time,business_date) "
        + "values(:id,:tenant,:technician,:store,:clockIn,:date) on conflict(technician_id,business_date) do nothing")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("technician", technician.id())
      .param("store", technician.storeId()).param("clockIn", now).param("date", date).update();
    TechnicianSchedulePolicy.ClockInStatus result = schedulePolicy.clockInStatus(technician.storeId(), technician.id());
    if (!result.clockedIn()) throw new ResponseStatusException(HttpStatus.CONFLICT, "打卡状态已变化，请刷新后重试");
    employeeAttendance.synchronize(technician.storeId(), date);
    audits.record(authorization, technician.storeId(), "ATTENDANCE", "TECHNICIAN_CLOCKED_IN",
      "technician_clock_in", technician.id(), input == null ? "技师上班打卡" : input.note(), before, result);
    return result;
  }

  @PostMapping("/clock-out")
  @Transactional
  TechnicianSchedulePolicy.ClockInStatus clockOut(
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestBody(required = false) ClockInput input) {
    Technician technician = currentTechnician(authorization);
    LocalDate date = businessClock.currentBusinessDate(technician.storeId());
    TechnicianSchedulePolicy.ClockInStatus before = schedulePolicy.clockInStatus(technician.storeId(), technician.id());
    if (before.legacyCompatible() || !before.clockedIn()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "技师今日尚未打卡");
    }
    OffsetDateTime now = OffsetDateTime.now();
    int updated = jdbc.sql("update technician_clock_in set clock_out_time=:clockOut,updated_at=now() where technician_id=:technician and store_id=:store and business_date=:date and clock_out_time is null")
      .param("clockOut", now).param("technician", technician.id()).param("store", technician.storeId()).param("date", date).update();
    if (updated == 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "打卡状态已变化，请刷新后重试");
    TechnicianSchedulePolicy.ClockInStatus result = schedulePolicy.clockInStatus(technician.storeId(), technician.id());
    employeeAttendance.synchronize(technician.storeId(), date);
    audits.record(authorization, technician.storeId(), "ATTENDANCE", "TECHNICIAN_CLOCKED_OUT",
      "technician_clock_in", technician.id(), input == null ? "技师下班打卡" : input.note(), before, result);
    return result;
  }

  @GetMapping("/clock-in/status")
  TechnicianSchedulePolicy.ClockInStatus status(
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    return schedulePolicy.clockInStatus(technician.storeId(), technician.id());
  }

  @GetMapping("/clocked-in")
  List<ClockedInTechnician> clockedIn(
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId,
      @RequestParam(required = false) LocalDate date) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate businessDate = date == null ? businessClock.currentBusinessDate(storeId) : date;
    return jdbc.sql("select t.id,t.code,t.name,c.clock_in_time,c.clock_out_time,true clocked_in "
        + "from technician_clock_in c join technician t on t.id=c.technician_id and t.store_id=c.store_id "
        + "where c.store_id=:store and c.business_date=:date and t.active=true and c.clock_in_time is not null "
        + "and c.clock_out_time is null order by t.queue_order,t.code")
      .param("store", storeId).param("date", businessDate).query(ClockedInTechnician.class).list();
  }

  @GetMapping("/clock-in/records")
  List<ClockedInTechnician> records(
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId,
      @RequestParam(required = false) LocalDate date) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate businessDate = date == null ? businessClock.currentBusinessDate(storeId) : date;
    adminSessions.requirePermission(authorization, "FOUNDATION_MANAGE");
    return jdbc.sql("select t.id,t.code,t.name,c.clock_in_time,c.clock_out_time,(c.clock_in_time is not null and c.clock_out_time is null) clocked_in "
        + "from technician_clock_in c join technician t on t.id=c.technician_id and t.store_id=c.store_id "
        + "where c.store_id=:store and c.business_date=:date order by t.queue_order,t.code")
      .param("store", storeId).param("date", businessDate).query(ClockedInTechnician.class).list();
  }

  private Technician currentTechnician(String authorization) {
    UUID userId = mobileSessions.requireUserId(authorization);
    return jdbc.sql("select t.id,t.code,t.name,b.store_id from technician_account_binding b "
        + "join technician t on t.id=b.technician_id and t.store_id=b.store_id "
        + "join store s on s.id=b.store_id where b.user_id=:user and b.tenant_id=:tenant "
        + "and t.tenant_id=:tenant and s.tenant_id=:tenant and b.active=true and t.active=true and s.active=true")
      .param("user", userId).param("tenant", TENANT_ID).query(Technician.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "未找到可用的技师账号绑定"));
  }

  record Technician(UUID id, String code, String name, UUID storeId) {}
  record ClockInput(@Size(max = 240) String note) {}
  public record ClockedInTechnician(UUID id, String code, String name, OffsetDateTime clockInTime,
                                    OffsetDateTime clockOutTime, Boolean clockedIn) {}
}
