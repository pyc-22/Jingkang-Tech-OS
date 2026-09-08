package com.chengxin.massage.catalog;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.BusinessClockService;

@RestController
@RequestMapping("/api/v1/technician-schedules")
@CrossOrigin(origins = "*")
public class TechnicianScheduleController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final TechnicianSchedulePolicy schedulePolicy;
  private final AuditService audits;
  private final BusinessClockService businessClock;

  TechnicianScheduleController(JdbcClient jdbc, StoreContextService storeContext, AdminSessionService adminSessions, TechnicianSchedulePolicy schedulePolicy, AuditService audits, BusinessClockService businessClock) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.schedulePolicy = schedulePolicy;
    this.audits = audits;
    this.businessClock = businessClock;
  }

  @GetMapping("/clock-eligibility")
  TechnicianSchedulePolicy.ClockEligibility clockEligibility(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                                             @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    return schedulePolicy.clockEligibility(storeContext.currentStore(authorization, requestedStoreId));
  }

  @GetMapping
  List<Schedule> schedules(@RequestParam(defaultValue = "") String date,
                           @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                           @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    authorize(authorization);
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql("select schedule.id,schedule.technician_id,technician.code technician_code,technician.name technician_name,schedule.schedule_date,schedule.shift_type,schedule.start_time,schedule.end_time,schedule.status,schedule.note from technician_shift_schedule schedule join technician on technician.id=schedule.technician_id where schedule.store_id=:store and schedule.schedule_date=:date order by technician.queue_order,technician.code")
      .param("store", storeId).param("date", date == null || date.isBlank() ? businessClock.currentBusinessDate(storeId) : parseDate(date)).query(Schedule.class).list();
  }

  @PostMapping
  @Transactional
  Schedule createSchedule(@Valid @RequestBody ScheduleInput input,
                          @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                          @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    authorize(authorization);
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    technician(storeId, input.technicianId());
    validateSchedule(input.shiftType(), input.startTime(), input.endTime());
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into technician_shift_schedule(id,tenant_id,store_id,technician_id,schedule_date,shift_type,start_time,end_time,status,note) values(:id,:tenant,:store,:technician,:date,:type,:start,:end,:status,:note)")
      .param("id", id).param("tenant", TENANT_ID).param("store", storeId).param("technician", input.technicianId()).param("date", input.scheduleDate())
      .param("type", input.shiftType()).param("start", input.startTime()).param("end", input.endTime()).param("status", scheduleStatus(input.shiftType())).param("note", input.note()).update();
    Schedule created = schedule(storeId, id);
    audits.record(authorization, storeId, "SCHEDULE", "SCHEDULE_CREATED", "technician_schedule", id,
      "Technician schedule created", null, created);
    return created;
  }

  @PutMapping("/{id}")
  @Transactional
  Schedule updateSchedule(@PathVariable UUID id, @Valid @RequestBody ScheduleInput input,
                          @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                          @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    authorize(authorization);
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    technician(storeId, input.technicianId());
    validateSchedule(input.shiftType(), input.startTime(), input.endTime());
    Schedule before = schedule(storeId, id);
    int updated = jdbc.sql("update technician_shift_schedule set technician_id=:technician,schedule_date=:date,shift_type=:type,start_time=:start,end_time=:end,status=:status,note=:note,updated_at=now(),version=version+1 where id=:id and store_id=:store")
      .param("technician", input.technicianId()).param("date", input.scheduleDate()).param("type", input.shiftType()).param("start", input.startTime()).param("end", input.endTime()).param("status", scheduleStatus(input.shiftType())).param("note", input.note()).param("id", id).param("store", storeId).update();
    if (updated == 0) throw notFound("Schedule not found");
    Schedule updatedSchedule = schedule(storeId, id);
    audits.record(authorization, storeId, "SCHEDULE", "SCHEDULE_UPDATED", "technician_schedule", id,
      "Technician schedule updated", before, updatedSchedule);
    return updatedSchedule;
  }

  @PutMapping("/{id}/cancel")
  @Transactional
  Schedule cancelSchedule(@PathVariable UUID id,
                          @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                          @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    authorize(authorization);
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Schedule before = schedule(storeId, id);
    int updated = jdbc.sql("update technician_shift_schedule set status='CANCELLED',updated_at=now(),version=version+1 where id=:id and store_id=:store and status='SCHEDULED'")
      .param("id", id).param("store", storeId).update();
    if (updated == 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "Only scheduled shifts can be cancelled");
    Schedule cancelled = schedule(storeId, id);
    audits.record(authorization, storeId, "SCHEDULE", "SCHEDULE_CANCELLED", "technician_schedule", id,
      "Technician schedule cancelled", before, cancelled);
    return cancelled;
  }

  @GetMapping("/leave-requests")
  List<LeaveRequest> leaveRequests(@RequestParam(defaultValue = "") String from,
                                   @RequestParam(defaultValue = "") String to,
                                   @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                   @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    authorize(authorization);
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate start = from == null || from.isBlank() ? businessClock.currentBusinessDate(storeId).withDayOfMonth(1) : parseDate(from);
    LocalDate end = to == null || to.isBlank() ? start.plusMonths(1).minusDays(1) : parseDate(to);
    if (end.isBefore(start)) throw bad("End date must not be before start date");
    return jdbc.sql("select leave.id,leave.technician_id,technician.code technician_code,technician.name technician_name,leave.start_date,leave.end_date,leave.status,leave.reason,leave.review_note,leave.reviewed_by_name,leave.reviewed_at from technician_leave_request leave join technician on technician.id=leave.technician_id where leave.store_id=:store and leave.start_date<=:end and leave.end_date>=:start order by leave.start_date desc,technician.code")
      .param("store", storeId).param("start", start).param("end", end).query(LeaveRequest.class).list();
  }

  @PostMapping("/leave-requests")
  @Transactional
  LeaveRequest createLeaveRequest(@Valid @RequestBody LeaveRequestInput input,
                                  @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                  @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    authorize(authorization);
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    technician(storeId, input.technicianId());
    if (input.endDate().isBefore(input.startDate())) throw bad("End date must not be before start date");
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into technician_leave_request(id,tenant_id,store_id,technician_id,start_date,end_date,status,reason) values(:id,:tenant,:store,:technician,:start,:end,'PENDING',:reason)")
      .param("id", id).param("tenant", TENANT_ID).param("store", storeId).param("technician", input.technicianId()).param("start", input.startDate()).param("end", input.endDate()).param("reason", input.reason()).update();
    LeaveRequest created = leaveRequest(storeId, id);
    audits.record(authorization, storeId, "SCHEDULE", "LEAVE_REQUEST_CREATED", "technician_leave_request", id,
      "Leave request created", null, created);
    return created;
  }

  @PutMapping("/leave-requests/{id}/status")
  @Transactional
  LeaveRequest updateLeaveStatus(@PathVariable UUID id, @Valid @RequestBody LeaveStatusInput input,
                                 @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                 @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    authorize(authorization);
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LeaveRequest before = leaveRequest(storeId, id);
    int updated = jdbc.sql("update technician_leave_request set status=:status,review_note=:note,reviewed_by_name=:reviewer,reviewed_at=now(),updated_at=now(),version=version+1 where id=:id and store_id=:store and status='PENDING'")
      .param("status", input.status()).param("note", input.reviewNote()).param("reviewer", input.reviewerName()).param("id", id).param("store", storeId).update();
    if (updated == 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "Only pending leave requests can be reviewed");
    LeaveRequest reviewed = leaveRequest(storeId, id);
    audits.record(authorization, storeId, "SCHEDULE", "LEAVE_REQUEST_REVIEWED", "technician_leave_request", id,
      "Leave request reviewed", before, reviewed);
    return reviewed;
  }

  private Schedule schedule(UUID storeId, UUID id) {
    return jdbc.sql("select schedule.id,schedule.technician_id,technician.code technician_code,technician.name technician_name,schedule.schedule_date,schedule.shift_type,schedule.start_time,schedule.end_time,schedule.status,schedule.note from technician_shift_schedule schedule join technician on technician.id=schedule.technician_id where schedule.id=:id and schedule.store_id=:store")
      .param("id", id).param("store", storeId).query(Schedule.class).single();
  }

  private LeaveRequest leaveRequest(UUID storeId, UUID id) {
    return jdbc.sql("select leave.id,leave.technician_id,technician.code technician_code,technician.name technician_name,leave.start_date,leave.end_date,leave.status,leave.reason,leave.review_note,leave.reviewed_by_name,leave.reviewed_at from technician_leave_request leave join technician on technician.id=leave.technician_id where leave.id=:id and leave.store_id=:store")
      .param("id", id).param("store", storeId).query(LeaveRequest.class).single();
  }

  private void technician(UUID storeId, UUID technicianId) {
    boolean exists = jdbc.sql("select exists(select 1 from technician where id=:id and store_id=:store)")
      .param("id", technicianId).param("store", storeId).query(Boolean.class).single();
    if (!exists) throw notFound("Technician not found");
  }

  private void validateSchedule(String shiftType, LocalTime start, LocalTime end) {
    if ("REST".equals(shiftType)) return;
    if (start == null || end == null || !end.isAfter(start)) throw bad("Working shifts require a valid start and end time");
  }

  private String scheduleStatus(String shiftType) { return "REST".equals(shiftType) ? "REST" : "SCHEDULED"; }
  private void authorize(String authorization) { adminSessions.requirePermission(authorization, "FOUNDATION_MANAGE"); }
  private LocalDate parseDate(String value) { try { return LocalDate.parse(value); } catch (RuntimeException exception) { throw bad("Date must use YYYY-MM-DD"); } }
  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException notFound(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }

  record Schedule(UUID id, UUID technicianId, String technicianCode, String technicianName, LocalDate scheduleDate,
                  String shiftType, LocalTime startTime, LocalTime endTime, String status, String note) {}
  record LeaveRequest(UUID id, UUID technicianId, String technicianCode, String technicianName, LocalDate startDate,
                      LocalDate endDate, String status, String reason, String reviewNote, String reviewedByName, OffsetDateTime reviewedAt) {}
  record ScheduleInput(@NotNull UUID technicianId, @NotNull LocalDate scheduleDate,
                       @NotBlank @Pattern(regexp = "MORNING|EVENING|CUSTOM|REST") String shiftType,
                       LocalTime startTime, LocalTime endTime, @Size(max = 240) String note) {}
  record LeaveRequestInput(@NotNull UUID technicianId, @NotNull LocalDate startDate, @NotNull LocalDate endDate,
                           @Size(max = 240) String reason) {}
  record LeaveStatusInput(@NotBlank @Pattern(regexp = "APPROVED|CANCELLED") String status,
                          @Size(max = 240) String reviewNote, @NotBlank @Size(max = 120) String reviewerName) {}
}
