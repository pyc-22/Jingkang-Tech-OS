package com.chengxin.massage.mobile;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.beans.factory.annotation.Value;
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
import com.chengxin.massage.catalog.TechnicianSchedulePolicy;
import com.chengxin.massage.audit.AuditOutcomeFilter;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.BusinessClockService;
import com.chengxin.massage.catalog.ServiceItemVersionService;
import com.chengxin.massage.catalog.ServiceDispatchEventService;
import com.chengxin.massage.catalog.ServiceDispatchLifecycle;
import com.chengxin.massage.catalog.TechnicianQueueService;
import com.chengxin.massage.catalog.ServiceItemVersionService.ResolvedServiceItem;
import com.chengxin.massage.catalog.ServiceDurationPolicyService;

@RestController
@RequestMapping("/api/v1/mobile/technician")
@CrossOrigin(origins = "*")
public class TechnicianMobileController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final String EFFECTIVE_RECORD_CTE = """
    WITH adjustment_totals AS (
      SELECT original_commission_record_id original_id,
             COALESCE(SUM(base_amount_cents), 0) base_delta,
             COALESCE(SUM(commission_cents), 0) commission_delta,
             COALESCE(SUM(clock_count_adjustment), 0) clock_delta,
             COALESCE(SUM(duration_minutes_adjustment), 0) duration_delta
      FROM technician_commission_record
      WHERE record_type IN ('REFUND_REVERSAL','ORDER_VOID_REVERSAL','BUSINESS_CORRECTION_REVERSAL')
      GROUP BY original_commission_record_id
    ), effective_records AS (
      SELECT base.*,
             GREATEST(0, base.base_amount_cents + COALESCE(adjustment.base_delta, 0)) effective_base_amount_cents,
             GREATEST(0, base.commission_cents + COALESCE(adjustment.commission_delta, 0)) effective_commission_cents,
             (base.clock_count_adjustment + COALESCE(adjustment.clock_delta, 0))::smallint effective_clock_count_adjustment,
             (base.duration_minutes_adjustment + COALESCE(adjustment.duration_delta, 0))::smallint effective_duration_minutes_adjustment
      FROM technician_commission_record base
      LEFT JOIN adjustment_totals adjustment ON adjustment.original_id = base.id
      WHERE base.record_type IN ('SETTLEMENT','BUSINESS_CORRECTION')
    )
    """;
  private final JdbcClient jdbc;
  private final MobileSessionService sessions;
  private final TechnicianSchedulePolicy schedulePolicy;
  private final AuditService audits;
  private final BusinessClockService businessClock;
  private final ServiceItemVersionService itemVersions;
  private final ServiceDispatchEventService dispatchEvents;
  private final TechnicianQueueService technicianQueue;
  private final ServiceDurationPolicyService durationPolicies;

  @Value("${massage.dispatch.acceptance-timeout-seconds:300}")
  private int acceptanceTimeoutSeconds;

  TechnicianMobileController(JdbcClient jdbc, MobileSessionService sessions, TechnicianSchedulePolicy schedulePolicy, AuditService audits, BusinessClockService businessClock, ServiceItemVersionService itemVersions, ServiceDispatchEventService dispatchEvents, TechnicianQueueService technicianQueue, ServiceDurationPolicyService durationPolicies) {
    this.jdbc = jdbc;
    this.sessions = sessions;
    this.schedulePolicy = schedulePolicy;
    this.audits = audits;
    this.businessClock = businessClock;
    this.itemVersions = itemVersions;
    this.dispatchEvents = dispatchEvents;
    this.technicianQueue = technicianQueue;
    this.durationPolicies = durationPolicies;
  }

  @GetMapping("/me")
  MobileDashboard dashboard(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    LocalDate businessDate = businessClock.currentBusinessDate(technician.storeId());
    PerformanceSummary summary = jdbc.sql(EFFECTIVE_RECORD_CTE + "select coalesce(sum(effective_clock_count_adjustment) filter(where business_date=:date),0) today_completed_count,coalesce(sum(effective_base_amount_cents) filter(where business_date=:date),0) today_amount_cents,coalesce(sum(effective_clock_count_adjustment) filter(where date_trunc('month',business_date)=date_trunc('month',cast(:date as date))),0) month_completed_count,coalesce(sum(effective_base_amount_cents) filter(where date_trunc('month',business_date)=date_trunc('month',cast(:date as date))),0) month_amount_cents from effective_records where store_id=:store and technician_id=:technician and (effective_base_amount_cents>0 or effective_clock_count_adjustment>0)")
      .param("store", technician.storeId()).param("technician", technician.id()).param("date", businessDate).query(PerformanceSummary.class).single();
    ServiceSession activeSession = jdbc.sql(sessionSql("and ss.status='IN_SERVICE' and exists(select 1 from service_session_participant current_participant where current_participant.service_session_id=ss.id and current_participant.technician_id=:technician and current_participant.status='IN_SERVICE')", "limit 1"))
      .param("store", technician.storeId()).param("technician", technician.id()).query(ServiceSession.class).optional().orElse(null);
    ServiceSession acceptedSession = jdbc.sql(sessionSql("and ss.status in ('PENDING_ACCEPTANCE','REASSIGNMENT_REQUIRED','ACCEPTED') and exists(select 1 from service_session_participant current_participant where current_participant.service_session_id=ss.id and current_participant.technician_id=:technician and current_participant.status='ACCEPTED')", "limit 1"))
      .param("store", technician.storeId()).param("technician", technician.id()).query(ServiceSession.class).optional().orElse(null);
    ServiceSession pendingSession = jdbc.sql(sessionSql("and ss.status in ('PENDING_ACCEPTANCE','REASSIGNMENT_REQUIRED') and exists(select 1 from service_session_participant current_participant where current_participant.service_session_id=ss.id and current_participant.technician_id=:technician and current_participant.status='PENDING_ACCEPTANCE' and (current_participant.acceptance_deadline_at is null or current_participant.acceptance_deadline_at>now()))", "limit 1"))
      .param("store", technician.storeId()).param("technician", technician.id()).query(ServiceSession.class).optional().orElse(null);
    List<ServiceSession> recentSessions = jdbc.sql(sessionSql("and ss.status in ('IN_SERVICE','COMPLETED','CANCELLED')", "limit 12"))
      .param("store", technician.storeId()).param("technician", technician.id()).query(ServiceSession.class).list();
    List<MobileReservation> reservations = jdbc.sql("select sr.id,sr.reservation_type,sr.service_name_snapshot,r.code room_code,sr.planned_duration_minutes,sr.note,sr.created_at from service_reservation sr join room r on r.id=sr.room_id where sr.store_id=:store and sr.technician_id=:technician and sr.status='WAITING' order by sr.created_at desc")
      .param("store", technician.storeId()).param("technician", technician.id()).query(MobileReservation.class).list();
    TechnicianSchedulePolicy.TechnicianEligibility eligibility = schedulePolicy.eligibility(technician.storeId(), technician.id());
    TechnicianSchedulePolicy.ClockInStatus attendance = schedulePolicy.clockInStatus(technician.storeId(), technician.id());
    return new MobileDashboard(technician, summary, activeSession, acceptedSession, pendingSession, recentSessions, reservations,
      eligibility.eligible(), eligibility.reason(), attendance.clockedIn(), attendance.clockInTime(), attendance.legacyCompatible());
  }

  @GetMapping("/performance")
  PerformanceRange performance(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                               @RequestParam(defaultValue = "MONTH") String range) {
    Technician technician = currentTechnician(authorization);
    LocalDate businessDate = businessClock.currentBusinessDate(technician.storeId());
    String period = switch (range) {
      case "TODAY" -> "business_date=:date";
      case "LAST_7_DAYS" -> "business_date between cast(:date as date)-6 and :date";
      case "MONTH" -> "date_trunc('month', business_date)=date_trunc('month', cast(:date as date))";
      default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported performance range");
    };
    PerformanceRangeData data = jdbc.sql(EFFECTIVE_RECORD_CTE + "select coalesce(sum(effective_clock_count_adjustment),0) completed_count,coalesce(sum(effective_base_amount_cents),0) amount_cents,coalesce(sum(effective_duration_minutes_adjustment),0) total_minutes from effective_records where store_id=:store and technician_id=:technician and (effective_base_amount_cents>0 or effective_clock_count_adjustment>0) and " + period)
      .param("store", technician.storeId()).param("technician", technician.id()).param("date", businessDate).query(PerformanceRangeData.class).single();
    return new PerformanceRange(range, data.completedCount(), data.amountCents(), data.totalMinutes());
  }

  @GetMapping("/daily-data")
  TechnicianDailyData dailyData(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                @RequestParam(required = false) LocalDate date) {
    Technician technician = currentTechnician(authorization);
    LocalDate businessDate = date == null ? businessClock.currentBusinessDate(technician.storeId()) : date;
    DailyServiceCounts serviceCounts = jdbc.sql("select "
        + "count(*) filter(where participant.status in ('IN_SERVICE','COMPLETED') and session.counts_as_clock_snapshot=true and coalesce(session.clock_type,'QUEUE') in ('QUEUE','BOOKED_QUEUE')) queue_count,"
        + "count(*) filter(where participant.status in ('IN_SERVICE','COMPLETED') and session.counts_as_clock_snapshot=true and session.clock_type in ('CALL','BOOKED_CALL','SELECTED')) call_count,"
        + "count(*) filter(where participant.status='COMPLETED') completed_service_count,"
        + "coalesce(sum(case when participant.service_started_at is null then 0 else greatest(0,extract(epoch from (coalesce(participant.service_ended_at,now())-participant.service_started_at))::bigint/60) end),0) total_minutes,"
        + "count(*) filter(where participant.status='COMPLETED' and not exists(select 1 from technician_commission_record commission where commission.service_participant_id=participant.id and commission.technician_id=:technician and commission.record_type in ('SETTLEMENT','BUSINESS_CORRECTION'))) pending_settlement_count "
        + "from service_session_participant participant join service_session session on session.id=participant.service_session_id "
        + "where participant.store_id=:store and participant.technician_id=:technician and session.business_date=:date")
      .param("store", technician.storeId()).param("technician", technician.id()).param("date", businessDate)
      .query(DailyServiceCounts.class).single();
    Long extensionCount = jdbc.sql(EFFECTIVE_RECORD_CTE + "select count(*) from effective_records where store_id=:store and technician_id=:technician and business_date=:date and service_session_extension_id is not null and (effective_base_amount_cents>0 or effective_commission_cents>0)")
      .param("store", technician.storeId()).param("technician", technician.id()).param("date", businessDate).query(Long.class).single();
    MobileCommissionSummary commissions = jdbc.sql(EFFECTIVE_RECORD_CTE + "select count(*) record_count,coalesce(sum(effective_base_amount_cents),0) base_amount_cents,coalesce(sum(effective_commission_cents),0) commission_cents from effective_records where store_id=:store and technician_id=:technician and business_date=:date and (effective_base_amount_cents>0 or effective_commission_cents>0 or effective_clock_count_adjustment>0 or effective_duration_minutes_adjustment>0)")
      .param("store", technician.storeId()).param("technician", technician.id()).param("date", businessDate)
      .query(MobileCommissionSummary.class).single();
    List<TechnicianDailyService> services = jdbc.sql(EFFECTIVE_RECORD_CTE + ", effective_by_participant AS ("
        + "select service_participant_id,count(*) record_count,coalesce(sum(effective_base_amount_cents),0) base_amount_cents,coalesce(sum(effective_commission_cents),0) commission_cents "
        + "from effective_records where store_id=:store and technician_id=:technician group by service_participant_id) "
        + "select session.id,room.code room_code,session.service_name_snapshot,session.clock_type,session.status,participant.status participant_status,participant.service_started_at started_at,participant.service_ended_at ended_at,"
        + "case when participant.service_started_at is null then 0 else greatest(0,extract(epoch from (coalesce(participant.service_ended_at,now())-participant.service_started_at))::bigint/60) end served_minutes,"
        + "coalesce((select count(*) from service_session_extension extension where extension.service_session_id=session.id and extension.technician_id=:technician),0) extension_count,"
        + "coalesce((select string_agg(extension.service_name_snapshot || ' ' || extension.planned_duration_minutes || '分钟','、' order by extension.added_at) from service_session_extension extension where extension.service_session_id=session.id and extension.technician_id=:technician),'') extension_summary,"
        + "coalesce(effective.record_count,0)>0 settled,coalesce(effective.base_amount_cents,0) base_amount_cents,coalesce(effective.commission_cents,0) commission_cents "
        + "from service_session_participant participant join service_session session on session.id=participant.service_session_id join room on room.id=session.room_id left join effective_by_participant effective on effective.service_participant_id=participant.id "
        + "where participant.store_id=:store and participant.technician_id=:technician and session.business_date=:date order by coalesce(participant.service_started_at,participant.created_at) desc")
      .param("store", technician.storeId()).param("technician", technician.id()).param("date", businessDate)
      .query(TechnicianDailyService.class).list();
    TechnicianDailySummary summary = new TechnicianDailySummary(serviceCounts.queueCount(), serviceCounts.callCount(), extensionCount,
      serviceCounts.completedServiceCount(), serviceCounts.totalMinutes(), commissions.baseAmountCents(), commissions.commissionCents(),
      serviceCounts.pendingSettlementCount());
    return new TechnicianDailyData(businessDate, summary, services);
  }

  @GetMapping("/commissions")
  List<MobileCommissionRecord> commissions(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                           @RequestParam(required = false) LocalDate from,
                                           @RequestParam(required = false) LocalDate to) {
    Technician technician = currentTechnician(authorization);
    LocalDate end = to == null ? businessClock.currentBusinessDate(technician.storeId()) : to;
    LocalDate start = from == null ? end.withDayOfMonth(1) : from;
    return jdbc.sql(EFFECTIVE_RECORD_CTE + "select id,order_no_snapshot,settlement_no_snapshot,service_name_snapshot,source_type,clock_type,rule_type,rule_rate_bp,rule_fixed_cents,effective_base_amount_cents base_amount_cents,effective_commission_cents commission_cents,settled_at,record_type,refund_id,service_participant_id,allocation_bp_snapshot,served_seconds_snapshot,commission_tier_name_snapshot,commission_tier_minimum_clock_count_snapshot,commission_multiplier_bp_snapshot,monthly_clock_count_snapshot from effective_records where store_id=:store and technician_id=:technician and business_date between :from and :to and (effective_base_amount_cents>0 or effective_commission_cents>0 or effective_clock_count_adjustment>0 or effective_duration_minutes_adjustment>0) order by settled_at desc,created_at desc limit 200")
      .param("store", technician.storeId()).param("technician", technician.id()).param("from", start).param("to", end).query(MobileCommissionRecord.class).list();
  }

  @GetMapping("/commissions/adjustments")
  List<MobileCommissionAdjustment> commissionAdjustments(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                                         @RequestParam(required = false) LocalDate from,
                                                         @RequestParam(required = false) LocalDate to) {
    Technician technician = currentTechnician(authorization);
    LocalDate end = to == null ? businessClock.currentBusinessDate(technician.storeId()) : to;
    LocalDate start = from == null ? end.withDayOfMonth(1) : from;
    return jdbc.sql("""
      SELECT record.id,record.order_no_snapshot,record.service_name_snapshot,record.clock_type,
             record.base_amount_cents,record.commission_cents,record.settled_at,record.record_type,
             CASE
               WHEN record.record_type='REFUND_REVERSAL' THEN refund.refund_no
               WHEN record.record_type='BUSINESS_CORRECTION_REVERSAL' THEN '改单-' || correction.correction_version::text
               WHEN record.record_type='ORDER_VOID_REVERSAL' THEN '作废-' || order_header.order_no
               ELSE record.order_no_snapshot
             END adjustment_reference_no,
             COALESCE(refund.reason,correction.reason,order_header.cancel_reason,'系统调整') adjustment_reason
      FROM technician_commission_record record
      LEFT JOIN sales_refund refund ON refund.id=record.refund_id
      LEFT JOIN sales_order_business_correction correction ON correction.id=record.business_correction_id
      LEFT JOIN sales_order order_header ON order_header.id=record.order_id
      WHERE record.store_id=:store AND record.technician_id=:technician
        AND record.business_date BETWEEN :from AND :to
        AND record.record_type IN ('REFUND_REVERSAL','ORDER_VOID_REVERSAL','BUSINESS_CORRECTION_REVERSAL')
      ORDER BY record.settled_at DESC,record.created_at DESC LIMIT 200
      """)
      .param("store", technician.storeId()).param("technician", technician.id()).param("from", start).param("to", end)
      .query(MobileCommissionAdjustment.class).list();
  }

  @GetMapping("/commissions/summary")
  MobileCommissionSummary commissionSummary(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                            @RequestParam(required = false) LocalDate from,
                                            @RequestParam(required = false) LocalDate to) {
    Technician technician = currentTechnician(authorization);
    LocalDate end = to == null ? businessClock.currentBusinessDate(technician.storeId()) : to;
    LocalDate start = from == null ? end.withDayOfMonth(1) : from;
    return jdbc.sql(EFFECTIVE_RECORD_CTE + "select count(*) record_count,coalesce(sum(effective_base_amount_cents),0) base_amount_cents,coalesce(sum(effective_commission_cents),0) commission_cents from effective_records where store_id=:store and technician_id=:technician and business_date between :from and :to and (effective_base_amount_cents>0 or effective_commission_cents>0 or effective_clock_count_adjustment>0 or effective_duration_minutes_adjustment>0)")
      .param("store", technician.storeId()).param("technician", technician.id()).param("from", start).param("to", end).query(MobileCommissionSummary.class).single();
  }

  @GetMapping("/leave-requests")
  List<MobileLeaveRequest> leaveRequests(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    return jdbc.sql("select id,start_date,end_date,status,reason,review_note,reviewed_by_name,reviewed_at from technician_leave_request where store_id=:store and technician_id=:technician and end_date >= (now() at time zone 'Asia/Shanghai')::date-30 order by start_date desc limit 20")
      .param("store", technician.storeId()).param("technician", technician.id()).query(MobileLeaveRequest.class).list();
  }

  @GetMapping("/service-room-transfers")
  MobileRoomTransferStatus roomTransferStatus(@RequestParam UUID serviceSessionId,
                                               @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    MobileRoomTransfer transfer = jdbc.sql("select tr.id,fr.code from_room_code,trm.code to_room_code,tr.status,tr.reason,tr.rejection_note,tr.requested_at,tr.approved_at from service_room_transfer tr join service_session ss on ss.id=tr.service_session_id join room fr on fr.id=tr.from_room_id join room trm on trm.id=tr.to_room_id where tr.store_id=:store and tr.service_session_id=:session and exists(select 1 from service_session_participant participant where participant.service_session_id=ss.id and participant.technician_id=:technician) order by tr.requested_at desc limit 1")
      .param("store", technician.storeId()).param("session", serviceSessionId).param("technician", technician.id())
      .query(MobileRoomTransfer.class).optional().orElse(null);
    return new MobileRoomTransferStatus(transfer);
  }

  @PostMapping("/leave-requests")
  @Transactional
  MobileLeaveRequest createLeaveRequest(@Valid @RequestBody LeaveRequestInput input,
                                        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    if (input.endDate().isBefore(input.startDate())) throw badRequest("Leave end date must not be before start date");
    boolean overlaps = jdbc.sql("select exists(select 1 from technician_leave_request where store_id=:store and technician_id=:technician and status in ('PENDING','APPROVED') and start_date<=:end and end_date>=:start)")
      .param("store", technician.storeId()).param("technician", technician.id()).param("start", input.startDate()).param("end", input.endDate()).query(Boolean.class).single();
    if (overlaps) throw conflict("An overlapping leave request already exists");
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into technician_leave_request(id,tenant_id,store_id,technician_id,start_date,end_date,status,reason) values(:id,:tenant,:store,:technician,:start,:end,'PENDING',:reason)")
      .param("id", id).param("tenant", TENANT_ID).param("store", technician.storeId()).param("technician", technician.id())
      .param("start", input.startDate()).param("end", input.endDate()).param("reason", input.reason()).update();
    MobileLeaveRequest created = leaveRequest(technician, id);
    audits.record(authorization, technician.storeId(), "SCHEDULE", "TECHNICIAN_LEAVE_REQUESTED", "technician_leave_request", id, "技师提交请假申请", null, created);
    return created;
  }

  @GetMapping("/clock-options")
  MobileClockOptions clockOptions(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    TechnicianSchedulePolicy.TechnicianEligibility eligibility = schedulePolicy.eligibility(technician.storeId(), technician.id());
    if (!eligibility.eligible()) return new MobileClockOptions(List.of(), List.of(), false, eligibility.reason());
    LocalDate businessDate = businessClock.currentBusinessDate(technician.storeId());
    List<ServiceItemOption> services = itemVersions.activeItems(technician.storeId(), businessDate, false).stream().map(this::option).toList();
    List<RoomOption> rooms = jdbc.sql("select r.id,r.code,r.name from room r where r.store_id=:store and r.active=true and not exists(select 1 from service_session ss where ss.store_id=r.store_id and ss.room_id=r.id and ss.status='IN_SERVICE') and coalesce((select event.status from room_status_event event where event.store_id=r.store_id and event.room_id=r.id order by event.occurred_at desc,event.id desc limit 1),'IDLE')='IDLE' order by r.code")
      .param("store", technician.storeId()).query(RoomOption.class).list();
    return new MobileClockOptions(services, rooms, true, eligibility.reason());
  }

  @PostMapping("/clock-in")
  ServiceSession clockIn(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      HttpServletRequest request) {
    // Technician mobile sessions are passive recipients of front-desk/manager dispatches.
    currentTechnician(authorization);
    request.setAttribute(AuditOutcomeFilter.SUPPRESS_OUTCOME_AUDIT_ATTRIBUTE, Boolean.TRUE);
    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "技师端不能自主上钟，请等待前台或店长安排");
  }

  @PostMapping("/clock-out")
  @Transactional
  ServiceSession clockOut(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    ServiceSession active = jdbc.sql(sessionSql("and ss.status='IN_SERVICE' and exists(select 1 from service_session_participant current_participant where current_participant.service_session_id=ss.id and current_participant.technician_id=:technician and current_participant.status='IN_SERVICE')", "limit 1"))
      .param("store", technician.storeId()).param("technician", technician.id()).query(ServiceSession.class).optional()
      .orElseThrow(() -> conflict("No active service"));
    OffsetDateTime endedAt = OffsetDateTime.now();
    jdbc.sql("update service_session set status='COMPLETED',ended_at=:ended,updated_at=now(),version=version+1 where id=:id and store_id=:store and status='IN_SERVICE'")
      .param("ended", endedAt).param("id", active.id()).param("store", technician.storeId()).update();
    jdbc.sql("update service_session_participant set status='COMPLETED',service_ended_at=:ended where service_session_id=:session and store_id=:store and status='IN_SERVICE'")
      .param("ended", endedAt).param("session", active.id()).param("store", technician.storeId()).update();
    UUID roomId = jdbc.sql("select room_id from service_session where id=:id and store_id=:store")
      .param("id", active.id()).param("store", technician.storeId()).query(UUID.class).single();
    promoteNextReservation(technician, authorization);
    recordRoomStatus(technician.storeId(), roomId, "PENDING_PAYMENT", "Technician mobile clock-out; awaiting payment");
    ServiceSession completed = session(technician.storeId(), technician.id(), active.id());
    audits.record(authorization, technician.storeId(), "SERVICE", "MOBILE_SERVICE_CLOCKED_OUT", "service_session", active.id(), "技师手机端下钟", active, completed);
    return completed;
  }

  private void promoteNextReservation(Technician technician, String authorization) {
    boolean pendingDispatch = jdbc.sql("select exists(select 1 from service_session_participant where store_id=:store and technician_id=:technician and status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE'))")
      .param("store", technician.storeId()).param("technician", technician.id()).query(Boolean.class).single();
    if (pendingDispatch) return;
    QueuedReservation reservation = jdbc.sql("select sr.id,sr.room_id,sr.service_item_id,sr.reservation_type,sr.service_name_snapshot,sr.service_price_cents,sr.planned_duration_minutes,sr.note,sr.price_version_id,sr.counts_as_clock_snapshot from service_reservation sr where sr.store_id=:store and sr.technician_id=:technician and sr.status='WAITING' order by sr.created_at,sr.id limit 1 for update")
      .param("store", technician.storeId()).param("technician", technician.id()).query(QueuedReservation.class).optional().orElse(null);
    if (reservation == null) return;
    UUID sessionId = UUID.randomUUID();
    OffsetDateTime acceptanceDeadline = OffsetDateTime.now().plusSeconds(acceptanceTimeoutSeconds);
    String clockType = "BOOKED_CALL".equals(reservation.reservationType()) ? "BOOKED_CALL" : "BOOKED_QUEUE";
    jdbc.sql("insert into service_session(id,tenant_id,store_id,technician_id,room_id,service_item_id,service_name_snapshot,service_price_cents,planned_duration_minutes,started_at,expected_end_at,status,note,clock_type,price_version_id,counts_as_clock_snapshot,acceptance_deadline_at) values(:id,:tenant,:store,:technician,:room,:service,:name,:price,:duration,null,null,'PENDING_ACCEPTANCE',:note,:clockType,:priceVersion,:countsAsClock,:deadline)")
      .param("id", sessionId).param("tenant", TENANT_ID).param("store", technician.storeId()).param("technician", technician.id()).param("room", reservation.roomId())
      .param("service", reservation.serviceItemId()).param("name", reservation.serviceNameSnapshot()).param("price", reservation.servicePriceCents()).param("duration", reservation.plannedDurationMinutes())
      .param("note", reservation.note()).param("clockType", clockType).param("priceVersion", reservation.priceVersionId()).param("countsAsClock", reservation.countsAsClockSnapshot()).param("deadline", acceptanceDeadline).update();
    UUID participantId = UUID.randomUUID();
    jdbc.sql("insert into service_session_participant(id,tenant_id,store_id,service_session_id,technician_id,slot_no,sequence_no,participation_type,allocation_bp,status,acceptance_deadline_at) values(:id,:tenant,:store,:session,:technician,1,1,'PRIMARY',10000,'PENDING_ACCEPTANCE',:deadline)")
      .param("id", participantId).param("tenant", TENANT_ID).param("store", technician.storeId()).param("session", sessionId).param("technician", technician.id()).param("deadline", acceptanceDeadline).update();
    jdbc.sql("update service_reservation set status='DISPATCHED',dispatched_at=now(),updated_at=now(),version=version+1 where id=:id and store_id=:store and status='WAITING'")
      .param("id", reservation.id()).param("store", technician.storeId()).update();
    dispatchEvents.record(technician.storeId(), sessionId, participantId, "ASSIGNED", null, technician.id(), acceptanceDeadline,
      "Reserved service promoted after previous service", sessions.requireUserId(authorization), technician.name());
    audits.record(authorization, technician.storeId(), "SERVICE", "SERVICE_RESERVATION_PROMOTED", "service_reservation", reservation.id(), "Promoted queued reservation after previous service ended", reservation, sessionId);
  }

  @GetMapping("/dispatch-notification")
  DispatchNotification dispatchNotification(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    PendingDispatch dispatch = jdbc.sql("select participant.id participant_id,ss.id session_id,ss.room_id,ss.service_name_snapshot,r.code room_code,ss.planned_duration_minutes,ss.created_at started_at,participant.acceptance_deadline_at from service_session ss join service_session_participant participant on participant.service_session_id=ss.id join room r on r.id=ss.room_id where ss.store_id=:store and participant.technician_id=:technician and participant.status='PENDING_ACCEPTANCE' and (participant.acceptance_deadline_at is null or participant.acceptance_deadline_at>now()) and ss.status in ('PENDING_ACCEPTANCE','REASSIGNMENT_REQUIRED') order by ss.created_at asc limit 1")
      .param("store", technician.storeId()).param("technician", technician.id()).query(PendingDispatch.class).optional().orElse(null);
    ReservationNotification reservation = jdbc.sql("select sr.id reservation_id,sr.reservation_type,sr.service_name_snapshot,r.code room_code,sr.planned_duration_minutes,sr.created_at created_at from service_reservation sr join room r on r.id=sr.room_id where sr.store_id=:store and sr.technician_id=:technician and sr.status='WAITING' order by sr.created_at desc limit 1")
      .param("store", technician.storeId()).param("technician", technician.id()).query(ReservationNotification.class).optional().orElse(null);
    TransferNotification transfer = jdbc.sql("select request.id request_id,request.service_session_id session_id,request.to_technician_id,request.status,request.reason,request.reviewed_at from service_transfer_request request where request.store_id=:store and request.from_technician_id=:technician and request.status in ('REQUESTED','APPROVED','REJECTED') order by request.requested_at desc limit 1")
      .param("store", technician.storeId()).param("technician", technician.id()).query(TransferNotification.class).optional().orElse(null);
    return new DispatchNotification(dispatch, reservation, transfer);
  }

  @PostMapping("/dispatch-notification/confirm")
  @Transactional
  void confirmDispatchNotification(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    schedulePolicy.requireClockedIn(technician.storeId(), technician.id());
    PendingDispatch dispatch = jdbc.sql("select participant.id participant_id,ss.id session_id,ss.room_id,ss.service_name_snapshot,r.code room_code,ss.planned_duration_minutes,ss.created_at started_at,participant.acceptance_deadline_at from service_session ss join service_session_participant participant on participant.service_session_id=ss.id join room r on r.id=ss.room_id where ss.store_id=:store and participant.technician_id=:technician and participant.status='PENDING_ACCEPTANCE' and (participant.acceptance_deadline_at is null or participant.acceptance_deadline_at>now()) and ss.status in ('PENDING_ACCEPTANCE','REASSIGNMENT_REQUIRED') order by ss.created_at asc limit 1")
      .param("store", technician.storeId()).param("technician", technician.id()).query(PendingDispatch.class).optional().orElse(null);
    int updated = dispatch == null ? 0 : jdbc.sql("update service_session_participant set status='ACCEPTED',accepted_at=now() where id=:participant and status='PENDING_ACCEPTANCE' and (acceptance_deadline_at is null or acceptance_deadline_at>now())")
      .param("participant", dispatch.participantId()).update();
    if (updated > 0) jdbc.sql("update service_session set status='ACCEPTED',technician_confirmed_at=now(),acceptance_deadline_at=null,updated_at=now(),version=version+1 where id=:session and store_id=:store and status='PENDING_ACCEPTANCE' and not exists(select 1 from service_session_participant where service_session_id=:session and status='PENDING_ACCEPTANCE')")
      .param("session", dispatch.sessionId()).param("store", technician.storeId()).update();
    if (updated > 0 && dispatch != null) {
      recordRoomStatus(technician.storeId(), dispatch.roomId(), "RESERVED", "Technician accepted service; awaiting start");
      audits.record(authorization, technician.storeId(), "SERVICE", "MOBILE_DISPATCH_CONFIRMED", "service_session", dispatch.sessionId(), "Technician accepted service", dispatch, new DispatchConfirmation(true));
      dispatchEvents.record(technician.storeId(), dispatch.sessionId(), dispatch.participantId(), "ACCEPTED", null, technician.id(),
        null, null, sessions.requireUserId(authorization), technician.name());
    }
  }

  @PostMapping("/dispatch-notification/reject")
  @Transactional
  DispatchDecline rejectDispatchNotification(@Valid @RequestBody DispatchDeclineInput input,
                                             @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    schedulePolicy.requireClockedIn(technician.storeId(), technician.id());
    PendingDispatch dispatch = jdbc.sql("select participant.id participant_id,ss.id session_id,ss.room_id,ss.service_name_snapshot,r.code room_code,ss.planned_duration_minutes,ss.created_at started_at,participant.acceptance_deadline_at from service_session ss join service_session_participant participant on participant.service_session_id=ss.id join room r on r.id=ss.room_id where ss.store_id=:store and participant.technician_id=:technician and participant.status='PENDING_ACCEPTANCE' and (participant.acceptance_deadline_at is null or participant.acceptance_deadline_at>now()) and ss.status in ('PENDING_ACCEPTANCE','REASSIGNMENT_REQUIRED') order by ss.created_at asc limit 1 for update")
      .param("store", technician.storeId()).param("technician", technician.id()).query(PendingDispatch.class).optional()
      .orElseThrow(() -> conflict("No pending service assignment"));
    int updated = jdbc.sql("update service_session_participant set status='REJECTED',declined_at=now(),decline_reason=:reason where id=:participant and status='PENDING_ACCEPTANCE'")
      .param("reason", input.reason().trim()).param("participant", dispatch.participantId()).update();
    if (updated == 0) throw conflict("Service assignment has changed");
    jdbc.sql("update service_session set status='REASSIGNMENT_REQUIRED',acceptance_deadline_at=null,updated_at=now(),version=version+1 where id=:session and store_id=:store and status in ('PENDING_ACCEPTANCE','REASSIGNMENT_REQUIRED')")
      .param("session", dispatch.sessionId()).param("store", technician.storeId()).update();
    DispatchDecline result = new DispatchDecline(dispatch.sessionId(), dispatch.participantId(), "REASSIGNMENT_REQUIRED");
    dispatchEvents.record(technician.storeId(), dispatch.sessionId(), dispatch.participantId(), "REJECTED", technician.id(), null,
      null, input.reason().trim(), sessions.requireUserId(authorization), technician.name());
    audits.record(authorization, technician.storeId(), "SERVICE", "MOBILE_DISPATCH_REJECTED", "service_session", dispatch.sessionId(),
      input.reason().trim(), dispatch, result);
    return result;
  }

  @GetMapping("/dispatch-notification/transfer-candidates")
  List<TransferCandidate> transferCandidates(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    return jdbc.sql("select t.id,t.code,t.name from technician t where t.store_id=:store and t.active=true and t.queue_enabled=true and t.id<>:current and not exists(select 1 from service_session_participant busy where busy.store_id=:store and busy.technician_id=t.id and busy.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')) order by t.queue_order,t.name")
      .param("store", technician.storeId()).param("current", technician.id()).query(TransferCandidate.class).list();
  }

  @PostMapping("/dispatch-notification/transfer")
  @Transactional
  TransferRequestResult requestTransfer(@Valid @RequestBody TransferRequestInput input,
                                        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    schedulePolicy.requireClockedIn(technician.storeId(), technician.id());
    PendingTransferSource source = jdbc.sql("select participant.id participant_id,ss.id session_id,ss.status,participant.status participant_status from service_session ss join service_session_participant participant on participant.service_session_id=ss.id where ss.store_id=:store and participant.technician_id=:technician and participant.status in ('PENDING_ACCEPTANCE','ACCEPTED') and ss.status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED') order by ss.created_at asc limit 1 for update of ss")
      .param("store", technician.storeId()).param("technician", technician.id()).query(PendingTransferSource.class).optional()
      .orElseThrow(() -> conflict("当前没有可转单的待接单服务"));
    boolean duplicate = jdbc.sql("select exists(select 1 from service_transfer_request where service_session_id=:session and from_participant_id=:participant and status='REQUESTED')")
      .param("session", source.sessionId()).param("participant", source.participantId()).query(Boolean.class).single();
    if (duplicate) throw conflict("该服务已经提交转单申请，请等待前台处理");
    boolean targetAvailable = jdbc.sql("select exists(select 1 from technician target where target.id=:target and target.store_id=:store and target.active=true and target.queue_enabled=true and not exists(select 1 from service_session_participant busy where busy.store_id=:store and busy.technician_id=target.id and busy.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')))")
      .param("target", input.toTechnicianId()).param("store", technician.storeId()).query(Boolean.class).single();
    if (!targetAvailable) throw conflict("目标技师当前不可接单");
    schedulePolicy.requireClockInEligibility(technician.storeId(), input.toTechnicianId());
    UUID requestId = UUID.randomUUID();
    String reason = input.reason().trim();
    jdbc.sql("insert into service_transfer_request(id,tenant_id,store_id,service_session_id,from_participant_id,from_technician_id,to_technician_id,reason) values(:id,:tenant,:store,:session,:participant,:from,:to,:reason)")
      .param("id", requestId).param("tenant", TENANT_ID).param("store", technician.storeId()).param("session", source.sessionId()).param("participant", source.participantId()).param("from", technician.id()).param("to", input.toTechnicianId()).param("reason", reason).update();
    dispatchEvents.record(technician.storeId(), source.sessionId(), source.participantId(), "TRANSFER_REQUESTED", technician.id(), input.toTechnicianId(), null, reason, sessions.requireUserId(authorization), technician.name());
    audits.record(authorization, technician.storeId(), "SERVICE", "MOBILE_TRANSFER_REQUESTED", "service_transfer_request", requestId, reason, source, input.toTechnicianId());
    return new TransferRequestResult(requestId, source.sessionId(), input.toTechnicianId(), "REQUESTED");
  }

  @PostMapping("/start-service")
  @Transactional
  ServiceSession startService(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    schedulePolicy.requireClockedIn(technician.storeId(), technician.id());
    ServiceSession accepted = jdbc.sql(sessionSql("and ss.status='ACCEPTED' and not exists(select 1 from service_transfer_request transfer where transfer.service_session_id=ss.id and transfer.from_technician_id=:technician and transfer.status='REQUESTED') and exists(select 1 from service_session_participant current_participant where current_participant.service_session_id=ss.id and current_participant.technician_id=:technician and current_participant.status='ACCEPTED')", "limit 1"))
      .param("store", technician.storeId()).param("technician", technician.id()).query(ServiceSession.class).optional()
      .orElseThrow(() -> conflict("No accepted service awaiting start"));
    OffsetDateTime startedAt = OffsetDateTime.now();
    OffsetDateTime expectedEndAt = startedAt.plusMinutes(accepted.plannedDurationMinutes());
    LocalDate businessDate = businessClock.businessDate(technician.storeId(), startedAt);
    UUID commissionVersionId = itemVersions.commissionRule(technician.storeId(), accepted.serviceItemId(), businessDate).id();
    int updated = jdbc.sql("update service_session set status='IN_SERVICE',started_at=:started,expected_end_at=:expected,business_date=:businessDate,commission_rule_version_id=:commissionVersion,updated_at=now(),version=version+1 where id=:id and store_id=:store and status='ACCEPTED'")
      .param("started", startedAt).param("expected", expectedEndAt).param("businessDate", businessDate).param("commissionVersion", commissionVersionId).param("id", accepted.id()).param("store", technician.storeId()).update();
    if (updated == 0) throw conflict("Service state has changed");
    jdbc.sql("update service_session_participant set status='IN_SERVICE',service_started_at=:started where service_session_id=:session and store_id=:store and status='ACCEPTED'")
      .param("started", startedAt).param("session", accepted.id()).param("store", technician.storeId()).update();
    List<UUID> participants = jdbc.sql("select technician_id from service_session_participant where service_session_id=:session and store_id=:store and status='IN_SERVICE' order by slot_no,sequence_no")
      .param("session", accepted.id()).param("store", technician.storeId()).query(UUID.class).list();
    technicianQueue.rotateAfterServiceStart(technician.storeId(), businessDate, accepted.id(), accepted.clockType(), participants,
      sessions.requireUserId(authorization), technician.name());
    UUID roomId = jdbc.sql("select room_id from service_session where id=:id and store_id=:store")
      .param("id", accepted.id()).param("store", technician.storeId()).query(UUID.class).single();
    recordRoomStatus(technician.storeId(), roomId, "IN_SERVICE", "Technician started service");
    ServiceSession started = session(technician.storeId(), technician.id(), accepted.id());
    audits.record(authorization, technician.storeId(), "SERVICE", "MOBILE_SERVICE_STARTED", "service_session", accepted.id(), "Technician started service", accepted, started);
    return started;
  }

  @GetMapping("/extension-options")
  ExtensionOptions extensionOptions(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    ServiceSession active = activeSession(technician);
    int currentExtensionMinutes = durationPolicies.extensionMinutes(technician.storeId(), active.id());
    ServiceDurationPolicyService.Policy limits = durationPolicies.policy(technician.storeId());
    int remainingExtensionMinutes = durationPolicies.remainingExtensionMinutes(
      limits, currentExtensionMinutes, active.plannedDurationMinutes());
    List<ServiceItemOption> services = itemVersions.activeItems(technician.storeId(), active.businessDate(), true).stream()
      .filter(item -> item.defaultDurationMinutes() <= remainingExtensionMinutes)
      .map(this::option)
      .toList();
    return new ExtensionOptions(active.id(), active.roomCode(), active.expectedEndAt(), active.plannedDurationMinutes(),
      currentExtensionMinutes, remainingExtensionMinutes, limits.serviceDurationMaxMinutes(),
      limits.technicianExtensionMaxMinutes(), services);
  }

  @PostMapping("/extensions")
  @Transactional
  ServiceSession addExtension(@Valid @RequestBody ExtensionInput input,
                              @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Technician technician = currentTechnician(authorization);
    schedulePolicy.requireClockedIn(technician.storeId(), technician.id());
    ServiceSession active = activeSession(technician);
    ServiceDurationPolicyService.SessionState locked = durationPolicies.lockSession(technician.storeId(), active.id());
    if (!"IN_SERVICE".equals(locked.status())) throw conflict("No active service");
    ResolvedServiceItem service = itemVersions.activeItem(technician.storeId(), input.serviceItemId(), active.businessDate())
      .filter(ResolvedServiceItem::allowsExtension)
      .orElseThrow(() -> badRequest("Service item is unavailable"));
    int currentExtensionMinutes = durationPolicies.extensionMinutes(technician.storeId(), active.id());
    int totalDuration = locked.plannedDurationMinutes() + service.defaultDurationMinutes();
    ServiceDurationPolicyService.Policy limits = durationPolicies.policy(technician.storeId());
    durationPolicies.requireExtensionWithinLimit(limits, currentExtensionMinutes, service.defaultDurationMinutes(), totalDuration);
    OffsetDateTime expectedEndAt = locked.expectedEndAt().plusMinutes(service.defaultDurationMinutes());
    int updated = jdbc.sql("update service_session set planned_duration_minutes=:duration,expected_end_at=:expected,updated_at=now(),version=version+1 where id=:id and store_id=:store and status='IN_SERVICE' and version=:version and exists(select 1 from service_session_participant where service_session_id=:id and technician_id=:technician and status='IN_SERVICE')")
      .param("duration", totalDuration).param("expected", expectedEndAt).param("id", active.id()).param("store", technician.storeId()).param("version", locked.version()).param("technician", technician.id()).update();
    if (updated == 0) throw conflict("Service state has changed; refresh and retry");
    UUID extensionId = UUID.randomUUID();
    UUID commissionVersionId = itemVersions.commissionRule(technician.storeId(), service.id(), active.businessDate()).id();
    jdbc.sql("insert into service_session_extension(id,tenant_id,store_id,service_session_id,technician_id,service_item_id,service_name_snapshot,service_price_cents,planned_duration_minutes,price_version_id,commission_rule_version_id,counts_as_clock_snapshot) values(:id,:tenant,:store,:session,:technician,:service,:name,:price,:duration,:priceVersion,:commissionVersion,:countsAsClock)")
      .param("id", extensionId).param("tenant", TENANT_ID).param("store", technician.storeId()).param("session", active.id()).param("technician", technician.id())
      .param("service", service.id()).param("name", service.name()).param("price", service.priceCents()).param("duration", service.defaultDurationMinutes()).param("priceVersion", service.priceVersionId()).param("commissionVersion", commissionVersionId).param("countsAsClock", service.countsAsClock()).update();
    UUID actorId = sessions.requireUserId(authorization);
    durationPolicies.recordChange(TENANT_ID, technician.storeId(), active.id(), technician.id(), extensionId, actorId, technician.name(),
      "TECHNICIAN_EXTENSION", locked.plannedDurationMinutes(), totalDuration, locked.expectedEndAt(), expectedEndAt,
      "Technician added extension: " + service.name());
    ServiceSession extended = session(technician.storeId(), technician.id(), active.id());
    audits.record(authorization, technician.storeId(), "SERVICE", "MOBILE_SERVICE_EXTENDED", "service_session", active.id(), "技师添加服务加钟", active, extended);
    return extended;
  }

  private Technician currentTechnician(String authorization) {
    UUID userId = sessions.requireUserId(authorization);
    return jdbc.sql("select t.id,t.code,t.name,b.store_id,s.name store_name from technician_account_binding b join technician t on t.id=b.technician_id and t.store_id=b.store_id join store s on s.id=b.store_id where b.user_id=:user and b.tenant_id=:tenant and t.tenant_id=:tenant and s.tenant_id=:tenant and b.active=true and t.active=true and s.active=true")
      .param("user", userId).param("tenant", TENANT_ID).query(Technician.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "未找到可用的技师账号绑定"));
  }

  private ServiceSession activeSession(Technician technician) {
    return jdbc.sql(sessionSql("and ss.status='IN_SERVICE' and exists(select 1 from service_session_participant current_participant where current_participant.service_session_id=ss.id and current_participant.technician_id=:technician and current_participant.status='IN_SERVICE')", "limit 1"))
      .param("store", technician.storeId()).param("technician", technician.id()).query(ServiceSession.class).optional()
      .orElseThrow(() -> conflict("No active service"));
  }

  private ServiceSession session(UUID storeId, UUID technicianId, UUID sessionId) {
    return jdbc.sql(sessionSql("and ss.id=:id", "limit 1"))
      .param("id", sessionId).param("store", storeId).param("technician", technicianId).query(ServiceSession.class).single();
  }

  private MobileLeaveRequest leaveRequest(Technician technician, UUID leaveRequestId) {
    return jdbc.sql("select id,start_date,end_date,status,reason,review_note,reviewed_by_name,reviewed_at from technician_leave_request where id=:id and store_id=:store and technician_id=:technician")
      .param("id", leaveRequestId).param("store", technician.storeId()).param("technician", technician.id()).query(MobileLeaveRequest.class).single();
  }

  private ServiceItemOption option(ResolvedServiceItem item) {
    return new ServiceItemOption(item.id(), item.code(), item.name(), item.defaultDurationMinutes(), item.priceCents(), item.priceVersionId(), item.countsAsClock());
  }

  private void recordRoomStatus(UUID storeId, UUID roomId, String status, String reason) {
    lockRoom(storeId, roomId);
    jdbc.sql("insert into room_status_event(id,tenant_id,store_id,room_id,status,reason,source,occurred_at) values(:id,:tenant,:store,:room,:status,:reason,'SERVICE_SESSION',clock_timestamp())")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("room", roomId)
      .param("status", status).param("reason", reason).update();
  }

  private void lockRoom(UUID storeId, UUID roomId) {
    jdbc.sql("select id from room where id=:room and store_id=:store for update")
      .param("room", roomId).param("store", storeId).query(UUID.class).optional()
      .orElseThrow(() -> badRequest("Room is unavailable"));
  }

  private String sessionSql(String statusClause, String limitClause) {
    return "select ss.id,ss.service_item_id,r.code room_code,ss.service_name_snapshot,ss.service_price_cents,ss.planned_duration_minutes,ss.started_at,ss.expected_end_at,ss.ended_at,ss.business_date,ss.status,ss.clock_type,coalesce((select sum(extension.service_price_cents) from service_session_extension extension where extension.service_session_id=ss.id),0) extension_total_cents,coalesce((select sum(extension.planned_duration_minutes) from service_session_extension extension where extension.service_session_id=ss.id),0) extension_total_minutes,coalesce((select string_agg(extension.service_name_snapshot || ' ' || extension.planned_duration_minutes || '分钟', '、' order by extension.added_at) from service_session_extension extension where extension.service_session_id=ss.id),'') extension_summary from service_session ss join room r on r.id=ss.room_id where ss.store_id=:store and exists(select 1 from service_session_participant participant where participant.service_session_id=ss.id and participant.technician_id=:technician) " + statusClause + " order by ss.started_at desc " + limitClause;
  }

  private ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }

  record Technician(UUID id, String code, String name, UUID storeId, String storeName) {}
  record PerformanceSummary(Long todayCompletedCount, Long todayAmountCents, Long monthCompletedCount, Long monthAmountCents) {}
  record PerformanceRangeData(Long completedCount, Long amountCents, Long totalMinutes) {}
  record PerformanceRange(String range, Long completedCount, Long amountCents, Long totalMinutes) {}
  record DailyServiceCounts(Long queueCount, Long callCount, Long completedServiceCount, Long totalMinutes, Long pendingSettlementCount) {}
  record TechnicianDailySummary(Long queueCount, Long callCount, Long extensionCount, Long completedServiceCount, Long totalMinutes,
                                Long baseAmountCents, Long commissionCents, Long pendingSettlementCount) {}
  record TechnicianDailyService(UUID id, String roomCode, String serviceNameSnapshot, String clockType, String status,
                                String participantStatus, OffsetDateTime startedAt, OffsetDateTime endedAt, Long servedMinutes,
                                Long extensionCount, String extensionSummary, Boolean settled, Long baseAmountCents, Long commissionCents) {}
  record TechnicianDailyData(LocalDate businessDate, TechnicianDailySummary summary, List<TechnicianDailyService> services) {}
  record ServiceItemOption(UUID id, String code, String name, Short defaultDurationMinutes, Integer priceCents, UUID priceVersionId, Boolean countsAsClock) {}
  record RoomOption(UUID id, String code, String name) {}
  record MobileClockOptions(List<ServiceItemOption> services, List<RoomOption> rooms, Boolean clockInEligible, String clockInReason) {}
  record ExtensionOptions(UUID sessionId, String roomCode, OffsetDateTime expectedEndAt, Short plannedDurationMinutes,
                          Integer extensionTotalMinutes, Integer remainingExtensionMinutes,
                          Short serviceDurationMaxMinutes, Short technicianExtensionMaxMinutes,
                          List<ServiceItemOption> services) {}
  record ExtensionInput(@NotNull UUID serviceItemId) {}
  record PendingDispatch(UUID participantId, UUID sessionId, UUID roomId, String serviceNameSnapshot, String roomCode, Short plannedDurationMinutes, OffsetDateTime startedAt, OffsetDateTime acceptanceDeadlineAt) {}
  record QueuedReservation(UUID id, UUID roomId, UUID serviceItemId, String reservationType, String serviceNameSnapshot, Integer servicePriceCents, Short plannedDurationMinutes, String note, UUID priceVersionId, Boolean countsAsClockSnapshot) {}
  record ReservationNotification(UUID reservationId, String reservationType, String serviceNameSnapshot, String roomCode, Short plannedDurationMinutes, OffsetDateTime createdAt) {}
  record DispatchNotification(PendingDispatch dispatch, ReservationNotification reservation, TransferNotification transfer) {}
  record DispatchConfirmation(boolean confirmed) {}
  record DispatchDeclineInput(@NotBlank @Size(max = 240) String reason) {}
  record TransferRequestInput(@NotNull UUID toTechnicianId, @NotBlank @Size(max = 240) String reason) {}
  record TransferCandidate(UUID id, String code, String name) {}
  record PendingTransferSource(UUID participantId, UUID sessionId, String status, String participantStatus) {}
  record TransferRequestResult(UUID id, UUID sessionId, UUID toTechnicianId, String status) {}
  record TransferNotification(UUID requestId, UUID sessionId, UUID toTechnicianId, String status, String reason, OffsetDateTime reviewedAt) {}
  record DispatchDecline(UUID sessionId, UUID participantId, String status) {}
  record LeaveRequestInput(@NotNull LocalDate startDate, @NotNull LocalDate endDate, @Size(max = 240) String reason) {}
  record MobileLeaveRequest(UUID id, LocalDate startDate, LocalDate endDate, String status, String reason, String reviewNote, String reviewedByName, OffsetDateTime reviewedAt) {}
  record MobileRoomTransfer(UUID id, String fromRoomCode, String toRoomCode, String status, String reason, String rejectionNote, OffsetDateTime requestedAt, OffsetDateTime approvedAt) {}
  record MobileRoomTransferStatus(MobileRoomTransfer transfer) {}
  record MobileCommissionRecord(UUID id, String orderNoSnapshot, String settlementNoSnapshot, String serviceNameSnapshot, String sourceType, String clockType, String ruleType, Integer ruleRateBp, Long ruleFixedCents, Long baseAmountCents, Long commissionCents, OffsetDateTime settledAt, String recordType, UUID refundId, UUID serviceParticipantId, Integer allocationBpSnapshot, Integer servedSecondsSnapshot, String commissionTierNameSnapshot, Integer commissionTierMinimumClockCountSnapshot, Integer commissionMultiplierBpSnapshot, Integer monthlyClockCountSnapshot) {}
  record MobileCommissionAdjustment(UUID id, String orderNoSnapshot, String serviceNameSnapshot, String clockType, Long baseAmountCents, Long commissionCents, OffsetDateTime settledAt, String recordType, String adjustmentReferenceNo, String adjustmentReason) {}
  record MobileCommissionSummary(Long recordCount, Long baseAmountCents, Long commissionCents) {}
  record MobileReservation(UUID id, String reservationType, String serviceNameSnapshot, String roomCode, Short plannedDurationMinutes, String note, OffsetDateTime createdAt) {}
  record ServiceSession(UUID id, UUID serviceItemId, String roomCode, String serviceNameSnapshot, Integer servicePriceCents, Short plannedDurationMinutes, OffsetDateTime startedAt, OffsetDateTime expectedEndAt, OffsetDateTime endedAt, LocalDate businessDate, String status, String clockType, Integer extensionTotalCents, Integer extensionTotalMinutes, String extensionSummary) {}
  record MobileDashboard(Technician technician, PerformanceSummary summary, ServiceSession activeSession, ServiceSession acceptedSession, ServiceSession pendingSession, List<ServiceSession> recentSessions, List<MobileReservation> reservations, Boolean clockInEligible, String clockInReason, Boolean clockedIn, OffsetDateTime clockInAt, Boolean clockInLegacyCompatible) {}
}
