package com.chengxin.massage.catalog;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import com.chengxin.massage.operations.BusinessClockService;

@Service
public class TechnicianSchedulePolicy {
  private final JdbcClient jdbc;
  private final BusinessClockService businessClock;

  TechnicianSchedulePolicy(JdbcClient jdbc, BusinessClockService businessClock) { this.jdbc = jdbc; this.businessClock = businessClock; }

  public ClockEligibility clockEligibility(UUID storeId) {
    LocalDate date = businessClock.currentBusinessDate(storeId);
    boolean enabled = schedulingEnabled(storeId, date);
    List<TechnicianBase> technicians = jdbc.sql("select id,active,queue_enabled from technician where store_id=:store and active=true order by queue_order,code")
      .param("store", storeId).query(TechnicianBase.class).list();
    return new ClockEligibility(enabled, technicians.stream().map(technician -> eligibility(storeId, technician.id(), date, enabled)).toList());
  }

  public TechnicianEligibility eligibility(UUID storeId, UUID technicianId) {
    LocalDate date = businessClock.currentBusinessDate(storeId);
    return eligibility(storeId, technicianId, date, schedulingEnabled(storeId, date));
  }

  public void requireClockInEligibility(UUID storeId, UUID technicianId) {
    TechnicianEligibility result = eligibility(storeId, technicianId);
    if (!result.eligible()) {
      HttpStatus status = switch (result.reason()) {
        case "NOT_CLOCKED_IN", "CLOCKED_OUT" -> HttpStatus.FORBIDDEN;
        default -> HttpStatus.CONFLICT;
      };
      throw new ResponseStatusException(status, clockInMessage(result.reason()));
    }
  }

  /** Enforces the current-day attendance gate for technician-side mutations. */
  public void requireClockedIn(UUID storeId, UUID technicianId) {
    ClockInStatus attendance = clockInStatus(storeId, technicianId);
    if (attendance.clockedIn()) return;
    String reason = attendance.clockOutTime() == null ? "NOT_CLOCKED_IN" : "CLOCKED_OUT";
    throw new ResponseStatusException(HttpStatus.FORBIDDEN, clockInMessage(reason));
  }

  /** Returns the current business-day attendance state. Missing means not clocked in. */
  public ClockInStatus clockInStatus(UUID storeId, UUID technicianId) {
    LocalDate date = businessClock.currentBusinessDate(storeId);
    ClockInRecord record = jdbc.sql("select clock_in_time,clock_out_time from technician_clock_in where store_id=:store and technician_id=:technician and business_date=:date")
      .param("store", storeId).param("technician", technicianId).param("date", date)
      .query(ClockInRecord.class).optional().orElse(null);
    if (record == null) return new ClockInStatus(technicianId, storeId, date, false, false, null, null);
    return new ClockInStatus(technicianId, storeId, date, record.clockInTime() != null && record.clockOutTime() == null,
      false, record.clockInTime(), record.clockOutTime());
  }

  private TechnicianEligibility eligibility(UUID storeId, UUID technicianId, LocalDate date, boolean enabled) {
    TechnicianBase technician = jdbc.sql("select id,active,queue_enabled from technician where store_id=:store and id=:technician")
      .param("store", storeId).param("technician", technicianId).query(TechnicianBase.class).optional().orElse(null);
    if (technician == null || !Boolean.TRUE.equals(technician.active())) {
      return new TechnicianEligibility(technicianId, false, "INACTIVE", false, false, null);
    }
    if (!Boolean.TRUE.equals(technician.queueEnabled())) {
      return new TechnicianEligibility(technicianId, false, "QUEUE_DISABLED", false, false, null);
    }
    ClockInStatus attendance = clockInStatus(storeId, technicianId);
    if (!attendance.legacyCompatible() && !attendance.clockedIn()) {
      return new TechnicianEligibility(technicianId, false,
        attendance.clockOutTime() == null ? "NOT_CLOCKED_IN" : "CLOCKED_OUT",
        attendance.clockedIn(), attendance.legacyCompatible(), attendance.clockInTime());
    }
    boolean approvedLeave = jdbc.sql("select exists(select 1 from technician_leave_request where store_id=:store and technician_id=:technician and status='APPROVED' and start_date<=:date and end_date>=:date)")
      .param("store", storeId).param("technician", technicianId).param("date", date).query(Boolean.class).single();
    if (approvedLeave) return new TechnicianEligibility(technicianId, false, "APPROVED_LEAVE", attendance.clockedIn(), attendance.legacyCompatible(), attendance.clockInTime());
    Shift shift = jdbc.sql("select status,start_time,end_time from technician_shift_schedule where store_id=:store and technician_id=:technician and schedule_date=:date")
      .param("store", storeId).param("technician", technicianId).param("date", date).query(Shift.class).optional().orElse(null);
    String status = shift == null ? null : shift.status();
    if ("SCHEDULED".equals(status)) {
      LocalTime now = OffsetDateTime.now().toLocalTime();
      if (shift.startTime() != null && now.isBefore(shift.startTime())) return new TechnicianEligibility(technicianId, false, "NOT_STARTED", attendance.clockedIn(), attendance.legacyCompatible(), attendance.clockInTime());
      if (shift.endTime() != null && !now.isBefore(shift.endTime())) {
        boolean serving = jdbc.sql("select exists(select 1 from service_session_participant participant join service_session session on session.id=participant.service_session_id where participant.store_id=:store and participant.technician_id=:technician and participant.status='IN_SERVICE' and session.status='IN_SERVICE')")
          .param("store", storeId).param("technician", technicianId).query(Boolean.class).single();
        return new TechnicianEligibility(technicianId, serving, serving ? "SERVICE_OVERTIME" : "SHIFT_ENDED", attendance.clockedIn(), attendance.legacyCompatible(), attendance.clockInTime());
      }
      return new TechnicianEligibility(technicianId, true, "SCHEDULED", attendance.clockedIn(), attendance.legacyCompatible(), attendance.clockInTime());
    }
    if ("REST".equals(status)) return new TechnicianEligibility(technicianId, false, "REST", attendance.clockedIn(), attendance.legacyCompatible(), attendance.clockInTime());
    // Missing or cancelled schedules do not block service assignment. A schedule
    // only restricts the explicit REST status and the SCHEDULED time window.
    if ("CANCELLED".equals(status) || status == null) return new TechnicianEligibility(technicianId, true, "AVAILABLE", attendance.clockedIn(), attendance.legacyCompatible(), attendance.clockInTime());
    return new TechnicianEligibility(technicianId, true, "AVAILABLE", attendance.clockedIn(), attendance.legacyCompatible(), attendance.clockInTime());
  }

  private boolean schedulingEnabled(UUID storeId, LocalDate date) {
    return jdbc.sql("select exists(select 1 from technician_shift_schedule where store_id=:store and schedule_date=:date)")
      .param("store", storeId).param("date", date).query(Boolean.class).single();
  }

  private String clockInMessage(String reason) {
    return switch (reason) {
      case "APPROVED_LEAVE" -> "Technician has approved leave today";
      case "QUEUE_DISABLED" -> "Technician queue is disabled";
      case "INACTIVE" -> "Technician is unavailable";
      case "NOT_CLOCKED_IN" -> "Technician must clock in before assignment";
      case "CLOCKED_OUT" -> "Technician has clocked out for today";
      case "REST" -> "Technician is scheduled to rest today";
      case "CANCELLED" -> "Technician shift is cancelled today";
      default -> "Technician is not scheduled today";
    };
  }

  record TechnicianBase(UUID id, Boolean active, Boolean queueEnabled) {}
  record Shift(String status, LocalTime startTime, LocalTime endTime) {}
  record ClockInRecord(OffsetDateTime clockInTime, OffsetDateTime clockOutTime) {}
  public record ClockEligibility(Boolean schedulingEnabled, List<TechnicianEligibility> technicians) {}
  public record TechnicianEligibility(UUID technicianId, Boolean eligible, String reason, Boolean clockedIn,
                                      Boolean legacyCompatible, OffsetDateTime clockInTime) {}
  public record ClockInStatus(UUID technicianId, UUID storeId, LocalDate businessDate, Boolean clockedIn,
                              Boolean legacyCompatible, OffsetDateTime clockInTime, OffsetDateTime clockOutTime) {}
}
