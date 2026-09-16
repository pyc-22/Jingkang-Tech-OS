package com.chengxin.massage.operations;

import com.chengxin.massage.audit.AuditService;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EmployeeAttendanceService {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final BusinessClockService businessClock;

  EmployeeAttendanceService(JdbcClient jdbc, BusinessClockService businessClock) {
    this.jdbc = jdbc;
    this.businessClock = businessClock;
  }

  @Transactional
  public List<AttendanceRow> synchronize(UUID storeId, LocalDate date) {
    List<AttendanceSeed> seeds = jdbc.sql("""
      select e.id employee_id,e.full_name employee_name,a.position_type,a.position_name,
             schedule.start_time scheduled_start,schedule.end_time scheduled_end,schedule.status schedule_status,
             clock.clock_in_time clock_in_at,clock.clock_out_time clock_out_at,store.timezone
      from employee_store_assignment a
      join employee e on e.id=a.employee_id and e.active=true
      join store on store.id=a.store_id
      left join technician t on t.employee_id=e.id and t.store_id=a.store_id and t.active=true
      left join technician_shift_schedule schedule on schedule.technician_id=t.id
        and schedule.store_id=a.store_id and schedule.schedule_date=:date
      left join technician_clock_in clock on clock.technician_id=t.id
        and clock.store_id=a.store_id and clock.business_date=:date
      where a.store_id=:store and a.active=true and a.employment_status='ACTIVE'
      order by a.position_type,a.position_name,e.full_name
      """).param("store", storeId).param("date", date).query(AttendanceSeed.class).list();
    for (AttendanceSeed seed : seeds) upsertSeed(storeId, date, seed);
    refreshOpenStatuses(storeId, date);
    return rows(storeId, date);
  }

  @Transactional
  public AttendanceRow clockIn(UUID storeId, UUID employeeId, String note) {
    LocalDate date = businessClock.currentBusinessDate(storeId);
    synchronize(storeId, date);
    AttendanceRow current = row(storeId, employeeId, date);
    if (current == null) throw new IllegalArgumentException("Employee is not active in this store");
    if (current.clockInAt() != null) throw new IllegalStateException("Employee has already clocked in today");
    OffsetDateTime now = OffsetDateTime.now();
    LocalTime start = current.scheduledStart();
    int late = start == null ? 0 : Math.max(0, (int) ChronoUnit.MINUTES.between(start, now.toLocalTime()));
    String status = late > 0 ? "LATE" : "PRESENT";
    jdbc.sql("update employee_attendance set status=:status,clock_in_at=:clockIn,late_minutes=:late,note=coalesce(:note,note),source='MANUAL',updated_at=now(),version=version+1 where id=:id and clock_in_at is null")
      .param("status", status).param("clockIn", now).param("late", late).param("note", note).param("id", current.id()).update();
    return row(storeId, employeeId, date);
  }

  @Transactional
  public AttendanceRow clockOut(UUID storeId, UUID employeeId, String note) {
    LocalDate date = businessClock.currentBusinessDate(storeId);
    synchronize(storeId, date);
    AttendanceRow current = row(storeId, employeeId, date);
    if (current == null || current.clockInAt() == null) throw new IllegalStateException("Employee has not clocked in today");
    if (current.clockOutAt() != null) throw new IllegalStateException("Employee has already clocked out today");
    OffsetDateTime now = OffsetDateTime.now();
    int early = current.scheduledEnd() == null ? 0 : Math.max(0, (int) ChronoUnit.MINUTES.between(now.toLocalTime(), current.scheduledEnd()));
    String status = early > 0 ? "LEFT_EARLY" : "COMPLETED";
    jdbc.sql("update employee_attendance set status=:status,clock_out_at=:clockOut,early_leave_minutes=:early,note=coalesce(:note,note),updated_at=now(),version=version+1 where id=:id and clock_out_at is null")
      .param("status", status).param("clockOut", now).param("early", early).param("note", note).param("id", current.id()).update();
    return row(storeId, employeeId, date);
  }

  @Scheduled(fixedDelayString = "${massage.attendance.scan-ms:60000}")
  @Transactional
  void scanAllStores() {
    List<Store> stores = jdbc.sql("select id from store where tenant_id=:tenant and active=true").param("tenant", TENANT_ID).query(Store.class).list();
    for (Store store : stores) synchronize(store.id(), businessClock.currentBusinessDate(store.id()));
  }

  private void upsertSeed(UUID storeId, LocalDate date, AttendanceSeed seed) {
    String initial = initialStatus(seed.scheduleStatus(), seed.scheduledStart(), seed.scheduledEnd());
    int late = 0;
    int early = 0;
    if (seed.clockInAt() != null) {
      ZoneId zone = ZoneId.of(seed.timezone());
      if ("SCHEDULED".equals(seed.scheduleStatus()) && seed.scheduledStart() != null) {
        late = Math.max(0, (int) ChronoUnit.MINUTES.between(date.atTime(seed.scheduledStart()).atZone(zone), seed.clockInAt().atZoneSameInstant(zone)));
      }
      initial = late > 0 ? "LATE" : "PRESENT";
      if (seed.clockOutAt() != null) {
        if ("SCHEDULED".equals(seed.scheduleStatus()) && seed.scheduledEnd() != null) {
          early = Math.max(0, (int) ChronoUnit.MINUTES.between(seed.clockOutAt().atZoneSameInstant(zone), date.atTime(seed.scheduledEnd()).atZone(zone)));
        }
        initial = early > 0 ? "LEFT_EARLY" : "COMPLETED";
      }
    }
    jdbc.sql("""
      insert into employee_attendance(id,tenant_id,store_id,employee_id,attendance_date,scheduled_start,scheduled_end,schedule_status,status,clock_in_at,clock_out_at,late_minutes,early_leave_minutes,source)
      values(:id,:tenant,:store,:employee,:date,:start,:end,:scheduleStatus,:status,:clockIn,:clockOut,:late,:early,:source)
      on conflict(store_id,employee_id,attendance_date) do update set
        scheduled_start=excluded.scheduled_start,scheduled_end=excluded.scheduled_end,schedule_status=excluded.schedule_status,
        clock_in_at=coalesce(excluded.clock_in_at,employee_attendance.clock_in_at),
        clock_out_at=coalesce(excluded.clock_out_at,employee_attendance.clock_out_at),
        late_minutes=case when excluded.clock_in_at is not null then excluded.late_minutes else employee_attendance.late_minutes end,
        early_leave_minutes=case when excluded.clock_out_at is not null then excluded.early_leave_minutes else employee_attendance.early_leave_minutes end,
        source=case when excluded.clock_in_at is not null then excluded.source else employee_attendance.source end,
        status=case when excluded.clock_out_at is not null then excluded.status
                    when employee_attendance.clock_out_at is not null then employee_attendance.status
                    when excluded.clock_in_at is not null then excluded.status
                    when employee_attendance.clock_in_at is not null then employee_attendance.status else excluded.status end,
        updated_at=now(),version=employee_attendance.version+1
      """).param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("employee", seed.employeeId())
      .param("date", date).param("start", seed.scheduledStart()).param("end", seed.scheduledEnd()).param("scheduleStatus", seed.scheduleStatus()).param("status", initial)
      .param("clockIn", seed.clockInAt()).param("clockOut", seed.clockOutAt()).param("late", late).param("early", early)
      .param("source", seed.clockInAt() == null ? "MANUAL" : "TECHNICIAN").update();
  }

  private void refreshOpenStatuses(UUID storeId, LocalDate date) {
    List<AttendanceRow> open = jdbc.sql("select a.id,a.store_id,a.employee_id,a.attendance_date,a.scheduled_start,a.scheduled_end,a.schedule_status,a.status,a.clock_in_at,a.clock_out_at,a.late_minutes,a.early_leave_minutes,e.full_name employee_name,assignment.position_type,assignment.position_name from employee_attendance a join employee e on e.id=a.employee_id join employee_store_assignment assignment on assignment.employee_id=a.employee_id and assignment.store_id=a.store_id where a.store_id=:store and a.attendance_date=:date and a.clock_in_at is null and a.status in ('NOT_STARTED','LATE')")
      .param("store", storeId).param("date", date).query(AttendanceRow.class).list();
    LocalTime now = OffsetDateTime.now().toLocalTime();
    for (AttendanceRow item : open) {
      String next = item.status();
      if ("SCHEDULED".equals(item.scheduleStatus()) && item.scheduledEnd() != null && !now.isBefore(item.scheduledEnd())) next = "ABSENT";
      else if ("SCHEDULED".equals(item.scheduleStatus()) && item.scheduledStart() != null && !now.isBefore(item.scheduledStart())) next = "LATE";
      if (!next.equals(item.status())) jdbc.sql("update employee_attendance set status=:status,updated_at=now(),version=version+1 where id=:id and clock_in_at is null").param("status", next).param("id", item.id()).update();
    }
  }

  private String initialStatus(String scheduleStatus, LocalTime start, LocalTime end) {
    if ("REST".equals(scheduleStatus)) return "REST";
    if (!"SCHEDULED".equals(scheduleStatus)) return "NOT_SCHEDULED";
    LocalTime now = OffsetDateTime.now().toLocalTime();
    if (end != null && !now.isBefore(end)) return "ABSENT";
    return start != null && !now.isBefore(start) ? "LATE" : "NOT_STARTED";
  }

  private AttendanceRow row(UUID storeId, UUID employeeId, LocalDate date) {
    return jdbc.sql(rowSql("where a.store_id=:store and a.employee_id=:employee and a.attendance_date=:date"))
      .param("store", storeId).param("employee", employeeId).param("date", date).query(AttendanceRow.class).optional().orElse(null);
  }

  private List<AttendanceRow> rows(UUID storeId, LocalDate date) {
    return jdbc.sql(rowSql("where a.store_id=:store and a.attendance_date=:date") + " order by assignment.position_type,assignment.position_name,e.full_name")
      .param("store", storeId).param("date", date).query(AttendanceRow.class).list();
  }

  private String rowSql(String where) {
    return "select a.id,a.store_id,a.employee_id,a.attendance_date,a.scheduled_start,a.scheduled_end,a.schedule_status,a.status,a.clock_in_at,a.clock_out_at,a.late_minutes,a.early_leave_minutes,e.full_name employee_name,assignment.position_type,assignment.position_name from employee_attendance a join employee e on e.id=a.employee_id join employee_store_assignment assignment on assignment.employee_id=a.employee_id and assignment.store_id=a.store_id " + where;
  }

  record AttendanceSeed(UUID employeeId, String employeeName, String positionType, String positionName, LocalTime scheduledStart, LocalTime scheduledEnd, String scheduleStatus, OffsetDateTime clockInAt, OffsetDateTime clockOutAt, String timezone) {}
  record AttendanceRow(UUID id, UUID storeId, UUID employeeId, LocalDate attendanceDate, LocalTime scheduledStart, LocalTime scheduledEnd, String scheduleStatus, String status, OffsetDateTime clockInAt, OffsetDateTime clockOutAt, Integer lateMinutes, Integer earlyLeaveMinutes, String employeeName, String positionType, String positionName) {}
  record Store(UUID id) {}
}
