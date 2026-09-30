package com.chengxin.massage.operations;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.List;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.beans.factory.annotation.Autowired;
import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;

@RestController
@RequestMapping("/api/v1/operations")
@CrossOrigin(origins = "*")
public class OperationsReportController {
  private static final String DAILY_REPORT_SETTLED_PAID_FILTER = "sales.status='SETTLED' and sales.paid_cents>0";
  private static final String DAILY_REPORT_RECHARGE_RANKING = "row_number() over(partition by wt.store_id,wt.member_id order by wt.created_at,wt.id)";
  private static final String DAILY_REPORT_FIRST_RECHARGE = "recharge_number=1";
  private static final String DAILY_REPORT_NET_SALES_EXPRESSION = "Math.subtractExact(orders.salesAmountCents(), refunds.refundAmountCents())";
  private static final String DAILY_REPORT_REFUND_SOURCES = "source in ('ORDER_REFUND','ORDER_CORRECTION')";
  private static final String DAILY_REPORT_VOIDED_SERVICE_FILTER = "not exists(select 1 from sales_order_service_session linked_session where linked_session.order_id=sales.id) or exists(select 1 from sales_order_service_session linked_session join service_session linked_service on linked_service.id=linked_session.service_session_id where linked_session.order_id=sales.id and linked_service.status<>'VOIDED')";
  /*
   * DailyReportService is the executable source for these predicates.  Keep the
   * contract visible here because this controller is also the manager-facing
   * documentation point for the report: sales.status='SETTLED' and
   * sales.paid_cents>0; row_number() over(partition by wt.store_id,wt.member_id
   * order by wt.created_at,wt.id); source in ('ORDER_REFUND','ORDER_CORRECTION');
   * count(*) filter (where coalesce(sales.refund_status,'NONE') <> 'FULL') settled_order_count;
   * coalesce(sum(sales.paid_cents),0) sales_amount_cents;
   * not exists(select 1 from sales_order_service_session linked_session where linked_session.order_id=sales.id)
   * or exists(select 1 from sales_order_service_session linked_session join service_session linked_service
   * on linked_service.id=linked_session.service_session_id where linked_session.order_id=sales.id
   * and linked_service.status<>'VOIDED').
   */
  private static final String EFFECTIVE_COMMISSION_CTE = """
    WITH adjustment_totals AS (
      SELECT original_commission_record_id original_id,
             COALESCE(SUM(base_amount_cents), 0) base_delta,
             COALESCE(SUM(commission_cents), 0) commission_delta,
             COALESCE(SUM(clock_count_adjustment), 0) clock_delta
      FROM technician_commission_record
      WHERE record_type IN ('REFUND_REVERSAL','ORDER_VOID_REVERSAL','BUSINESS_CORRECTION_REVERSAL')
      GROUP BY original_commission_record_id
    ), effective_records AS (
      SELECT base.store_id,base.business_date,base.technician_id,
             GREATEST(0, base.base_amount_cents + COALESCE(adjustment.base_delta, 0)) effective_base_amount_cents,
             GREATEST(0, base.commission_cents + COALESCE(adjustment.commission_delta, 0)) effective_commission_cents,
             (base.clock_count_adjustment + COALESCE(adjustment.clock_delta, 0))::smallint effective_clock_count_adjustment
      FROM technician_commission_record base
      LEFT JOIN adjustment_totals adjustment ON adjustment.original_id = base.id
      WHERE base.record_type IN ('SETTLEMENT','BUSINESS_CORRECTION')
    )
    """;
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final BusinessClockService businessClock;
  private final DailyReportService dailyReports;
  private final OperationalStateService operationalState;

  @Autowired
  OperationsReportController(JdbcClient jdbc, StoreContextService storeContext, AdminSessionService adminSessions,
                             BusinessClockService businessClock, DailyReportService dailyReports,
                             OperationalStateService operationalState) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.businessClock = businessClock;
    this.dailyReports = dailyReports;
    this.operationalState = operationalState;
  }

  // Kept for focused controller tests that exercise the static SQL helpers.
  OperationsReportController(JdbcClient jdbc, StoreContextService storeContext, AdminSessionService adminSessions, BusinessClockService businessClock) {
    this(jdbc, storeContext, adminSessions, businessClock, null, new OperationalStateService(jdbc, businessClock));
  }

  @GetMapping("/daily-report")
  DailyReport dailyReport(@RequestParam(defaultValue = "") String date,
                          @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                          @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return buildReport(storeId, parseDate(date, storeId));
  }

  @GetMapping("/daily-report/export")
  void export(@RequestParam(defaultValue = "") String date,
              @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
              @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId,
              HttpServletResponse response) throws IOException {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    DailyReport report = buildReport(storeId, parseDate(date, storeId));
    String csv = "business_date,settled_orders,customer_count,sales_amount,recharge_amount,bonus_amount,member_consumption,refund_amount,net_sales,completed_services,service_amount,card_open_count\n"
      + report.businessDate() + "," + report.settledOrderCount() + "," + report.customerCount() + "," + yuan(report.salesAmountCents()) + "," + yuan(report.rechargeAmountCents()) + "," + yuan(report.bonusAmountCents()) + "," + yuan(report.consumptionAmountCents()) + "," + yuan(report.refundAmountCents()) + "," + yuan(report.netSalesAmountCents()) + "," + report.completedServiceCount() + "," + yuan(report.serviceAmountCents()) + "," + report.cardOpenCount() + "\n";
    response.setCharacterEncoding(StandardCharsets.UTF_8.name());
    response.setContentType("text/csv;charset=UTF-8");
    response.setHeader(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=daily-report-" + report.businessDate() + ".csv");
    response.getOutputStream().write(("\uFEFF" + csv).getBytes(StandardCharsets.UTF_8));
  }

  @GetMapping("/payment-channel-summary")
  PaymentChannelSummary paymentChannelSummary(@RequestParam(defaultValue = "") String date,
                                              @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                              @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate businessDate = parseDate(date, storeId);
    String day = businessDate.toString();
    DailyReportService.DailyMetrics metrics = dailyReports.daily(storeId, businessDate);
    List<ChannelAmount> sales = metrics.channels().stream().filter(c -> c.salesCents() != 0)
      .map(c -> new ChannelAmount(c.code(), c.salesCents())).toList();
    List<ChannelAmount> refunds = metrics.channels().stream().filter(c -> c.refundCents() != 0)
      .map(c -> new ChannelAmount(c.code(), c.refundCents())).toList();
    List<ChannelAmount> recharges = metrics.channels().stream().filter(c -> c.rechargeNetCents() != 0)
      .map(c -> new ChannelAmount(c.code(), c.rechargeNetCents())).toList();
    long cashNet = amount(sales,"CASH") - amount(refunds,"CASH") + amount(recharges,"CASH");
    return new PaymentChannelSummary(day,sales,refunds,recharges,cashNet);
  }

  @GetMapping("/service-clock-summary")
  ServiceClockSummary serviceClockSummary(@RequestParam(defaultValue = "") String date,
                                          @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                          @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate businessDate = parseDate(date, storeId);
    LocalDate monthStart = businessDate.withDayOfMonth(1);
    return new ServiceClockSummary(businessDate.toString(), clockCounts(storeId, businessDate, businessDate),
      clockCounts(storeId, monthStart, businessDate));
  }

  @GetMapping("/management-overview")
  ManagementOverview managementOverview(@RequestParam(defaultValue = "") String date,
                                         @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                         @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate businessDate = parseDate(date, storeId);
    List<RevenueTrendPoint> trend = new ArrayList<>();
    for (LocalDate item = businessDate.minusDays(6); !item.isAfter(businessDate); item = item.plusDays(1)) {
      DailyReport report = buildReport(storeId, item);
      trend.add(new RevenueTrendPoint(report.businessDate(), report.netSalesAmountCents(), report.rechargeAmountCents(), report.settledOrderCount()));
    }
    return new ManagementOverview(
      buildReport(storeId, businessDate),
      buildReport(storeId, businessDate.minusDays(1)),
      trend,
      managementRoomUtilization(storeId),
      managementTechnicianRanking(storeId, businessDate),
      managementAttention(storeId));
  }

  @GetMapping("/live-room-status")
  List<LiveRoomStatus> liveRoomStatus(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId,
                                      HttpServletResponse response) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store, max-age=0");
    return operationalState.live(storeId).rooms().stream().map(room -> new LiveRoomStatus(room.roomId(), room.roomCode(), room.roomName(), room.status(), room.bedCount(), room.occupiedBedCount(), room.availableBedCount(), room.services().stream().map(service -> new LiveRoomService(service.serviceSessionId(), service.roomId(), service.bedId(), service.bedCode(), service.bedName(), service.serviceNameSnapshot(), service.clockType(), service.serviceStatus(), service.startedAt(), service.expectedEndAt(), service.technicianDisplay(), service.technicianCount())).toList())).toList();
  }

  @GetMapping("/live-state")
  OperationalStateService.LiveState liveState(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                               @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId,
                                               HttpServletResponse response) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store, max-age=0");
    return operationalState.live(storeId);
  }

  @GetMapping("/live-technician-status")
  LiveTechnicianOverview liveTechnicianStatus(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                               @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId,
                                               HttpServletResponse response) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store, max-age=0");
    OperationalStateService.LiveState state = operationalState.live(storeId);
    List<LiveTechnicianStatus> technicians = state.technicians().stream().map(item -> new LiveTechnicianStatus(item.technicianId(), item.technicianCode(), item.technicianName(), item.queuePosition(), item.status(), item.serviceSessionId(), item.roomCode(), item.roomName(), item.serviceNameSnapshot(), item.clockType(), item.startedAt(), item.expectedEndAt(), item.acceptanceDeadlineAt())).toList();
    return new LiveTechnicianOverview(state.businessDate(), state.reassignmentRequiredCount(), state.dispatchCancelledCount(), technicians);
  }

  static String liveRoomStatusSql() {
    return OperationalStateService.roomSql();
  }

  static String liveRoomServiceSql() {
    return OperationalStateService.serviceSql();
  }

  static String liveTechnicianStatusSql() {
    return OperationalStateService.technicianSql();
  }

  static boolean occupiesRoomBed(String status) {
    return OperationalStateService.occupiesBed(status);
  }

  static String liveDispatchAttentionSql() {
    return OperationalStateService.attentionSql();
  }

  private RoomUtilization managementRoomUtilization(UUID storeId) {
    OperationalStateService.LiveState state = operationalState.live(storeId);
    long total = state.rooms().stream().mapToLong(room -> room.bedCount() == null ? 0L : room.bedCount()).sum();
    long used = state.rooms().stream().mapToLong(room -> room.occupiedBedCount() == null ? 0L : room.occupiedBedCount()).sum();
    used = Math.min(used, total);
    long rate = total == 0 ? 0 : Math.round(used * 100.0 / total);
    return new RoomUtilization(used, total, rate);
  }

  private List<TechnicianRanking> managementTechnicianRanking(UUID storeId, LocalDate businessDate) {
    LocalDate monthStart = businessDate.withDayOfMonth(1);
    return jdbc.sql(EFFECTIVE_COMMISSION_CTE + "select t.id technician_id,t.code technician_code,t.name technician_name,coalesce(sum(record.effective_base_amount_cents),0) amount_cents,coalesce(sum(record.effective_clock_count_adjustment),0) completed_count from technician t join effective_records record on record.technician_id=t.id and record.store_id=:store and record.business_date between :from and :to where t.store_id=:store and (record.effective_base_amount_cents>0 or record.effective_clock_count_adjustment>0) group by t.id,t.code,t.name order by amount_cents desc,completed_count desc,t.code limit 10")
      .param("store", storeId).param("from", monthStart).param("to", businessDate).query(TechnicianRanking.class).list();
  }

  private List<AttentionItem> managementAttention(UUID storeId) {
    StoreOperationSummary operation = storeOperationSummary(storeId);
    List<AttentionItem> items = new ArrayList<>();
    if (operation.roomCleaningCount() > 0) items.add(new AttentionItem("CLEANING_ROOM", "待清洁房间", operation.roomCleaningCount()));
    if (operation.pendingSettlementCount() > 0) items.add(new AttentionItem("PENDING_SETTLEMENT", "待结算服务", operation.pendingSettlementCount()));
    if (operation.pendingRefundCount() > 0) items.add(new AttentionItem("PENDING_REFUND", "待确认退款", operation.pendingRefundCount()));
    return items;
  }

  private ClockCounts clockCounts(UUID storeId, LocalDate from, LocalDate to) {
    String sql = clockCountsSql()
      + "from service_session where store_id=:store and status='COMPLETED' and counts_as_clock_snapshot=true "
      + "and business_date between :from and :to";
    ClockCounts clocks = jdbc.sql(sql).param("store", storeId).param("from", from).param("to", to).query(ClockCounts.class).single();
    Long extensions = jdbc.sql("select count(*) from service_session_extension extension join service_session session on session.id=extension.service_session_id where extension.store_id=:store and extension.counts_as_clock_snapshot=true and session.business_date between :from and :to")
      .param("store", storeId).param("from", from).param("to", to).query(Long.class).single();
    return new ClockCounts(clocks.queueCount(), clocks.callCount(), extensions);
  }

  static String clockCountsSql() {
    return "select "
      + "count(*) filter (where coalesce(clock_type,'QUEUE') in ('QUEUE','BOOKED_QUEUE')) queue_count,"
      + "count(*) filter (where clock_type in ('CALL','BOOKED_CALL','SELECTED')) call_count,"
      + "cast(0 as bigint) extension_count ";
  }

  @GetMapping("/store-comparison")
  List<StoreComparison> storeComparison(@RequestParam(defaultValue = "") String date,
                                        @RequestParam(defaultValue = "SALES") String sort,
                                        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    adminSessions.requirePermission(authorization, "REPORT_VIEW");
    String sortField = sort == null ? "SALES" : sort.trim().toUpperCase(java.util.Locale.ROOT);
    Comparator<StoreComparison> comparator = switch (sortField) {
      case "SALES" -> Comparator.comparingLong(StoreComparison::salesAmountCents).reversed();
      case "SERVICE" -> Comparator.comparingLong(StoreComparison::serviceAmountCents).reversed();
      case "CASH" -> Comparator.comparingLong(StoreComparison::cashNetCents).reversed();
      default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Sort must be SALES, SERVICE, or CASH");
    };
    List<StoreComparison> rows = new ArrayList<>();
    for (AdminSessionService.AdminStore store : adminSessions.accessibleStores(authorization)) {
      LocalDate businessDate = parseDate(date, store.id());
      DailyReport report = buildReport(store.id(), businessDate);
      StoreOperationSummary operation = storeOperationSummary(store.id());
      rows.add(new StoreComparison(store.id(), store.code(), store.name(), report.businessDate(),
        report.netSalesAmountCents(), report.completedServiceCount(), report.serviceAmountCents(), report.rechargeAmountCents(),
        report.refundAmountCents(), cashNet(store.id(), businessDate), operation.activeRoomCount(), operation.roomServingCount(),
        operation.roomCleaningCount(), operation.activeTechnicianCount(), operation.pendingSettlementCount(),
        operation.pendingRefundCount()));
    }
    rows.sort(comparator.thenComparing(StoreComparison::storeCode));
    return rows;
  }

  @GetMapping("/store-alerts")
  List<StoreAlert> storeAlerts(@RequestParam(defaultValue = "") String date,
                               @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    adminSessions.requirePermission(authorization, "REPORT_VIEW");
    List<StoreAlert> alerts = new ArrayList<>();
    for (AdminSessionService.AdminStore store : adminSessions.accessibleStores(authorization)) {
      LocalDate businessDate = parseDate(date, store.id());
      StoreOperationSummary operation = storeOperationSummary(store.id());
      if (operation.pendingRefundCount() > 0) alerts.add(alert(store, "PENDING_REFUND", "待确认退款", operation.pendingRefundCount(), 0L, null));
      if (operation.pendingSettlementCount() > 0) alerts.add(alert(store, "PENDING_SETTLEMENT", "待结算服务", operation.pendingSettlementCount(), 0L, null));
      if (operation.roomCleaningCount() > 0) alerts.add(alert(store, "CLEANING_ROOM", "待完成清洁房间", operation.roomCleaningCount(), 0L, null));
    }
    alerts.sort(Comparator.comparingInt((StoreAlert item) -> alertPriority(item.alertType()))
      .thenComparing(StoreAlert::storeCode).thenComparing(StoreAlert::alertTitle));
    return alerts;
  }

  @GetMapping("/cross-store-transactions")
  List<CrossStoreTransaction> crossStoreTransactions(@RequestParam(defaultValue = "") String query,
                                                     @RequestParam(defaultValue = "ALL") String type,
                                                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    adminSessions.requirePermission(authorization, "REPORT_VIEW");
    String typeFilter = type == null ? "ALL" : type.trim().toUpperCase(java.util.Locale.ROOT);
    if (!List.of("ALL", "ORDER", "REFUND", "CONSUMPTION").contains(typeFilter)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Type must be ALL, ORDER, REFUND, or CONSUMPTION");
    }
    String keyword = "%" + (query == null ? "" : query.trim()) + "%";
    List<CrossStoreTransaction> results = new ArrayList<>();
    for (AdminSessionService.AdminStore store : adminSessions.accessibleStores(authorization)) {
      if ("ALL".equals(typeFilter) || "ORDER".equals(typeFilter)) results.addAll(orderTransactions(store, keyword));
      if ("ALL".equals(typeFilter) || "REFUND".equals(typeFilter)) results.addAll(refundTransactions(store, keyword));
      if ("ALL".equals(typeFilter) || "CONSUMPTION".equals(typeFilter)) results.addAll(consumptionTransactions(store, keyword));
    }
    results.sort(Comparator.comparing(CrossStoreTransaction::occurredAt, Comparator.nullsLast(Comparator.reverseOrder())));
    return results.size() > 200 ? results.subList(0, 200) : results;
  }

  private DailyReport buildReport(UUID storeId, LocalDate businessDate) {
    return dailyReports.snapshot(() -> buildReportSnapshot(storeId, businessDate));
  }

  private DailyReport buildReportSnapshot(UUID storeId, LocalDate businessDate) {
    DailyReportService.DailyMetrics metrics = dailyReports.daily(storeId, businessDate);
    String day = businessDate.toString();
    ServiceSummary services = jdbc.sql("""
      select
        count(*) filter(where session.counts_as_clock_snapshot=true and (
          active_order.order_id is null
          or (active_order.status='SETTLED' and active_order.refund_status<>'FULL')
        )) completed_service_count,
        coalesce(sum(case
          when active_order.order_id is null then session.service_price_cents+extensions.extension_cents
          when active_order.status='SETTLED' then greatest(0,coalesce(order_line.line_amount_cents,session.service_price_cents+extensions.extension_cents)-refund_totals.refunded_cents)
          else 0
        end),0) service_amount_cents
      from service_session session
      left join lateral (
        select link.order_id,linked_order.status,linked_order.refund_status
        from sales_order_service_session link
        join sales_order linked_order on linked_order.id=link.order_id
        where link.service_session_id=session.id
        order by (linked_order.status='SETTLED' and linked_order.refund_status<>'FULL') desc,
                 linked_order.settled_at desc nulls last,link.created_at desc
        limit 1
      ) active_order on true
      left join sales_order_line order_line on order_line.id=(select link.order_line_id from sales_order_service_session link where link.service_session_id=session.id and link.order_id=active_order.order_id order by link.created_at desc limit 1)
      left join lateral (
        select coalesce(sum(extension.service_price_cents),0)::bigint extension_cents
        from service_session_extension extension
        where extension.service_session_id=session.id
      ) extensions on true
      left join lateral (
        select coalesce(sum(refund_line.refund_cents),0)::bigint refunded_cents
        from sales_refund_line refund_line
        join sales_refund refund on refund.id=refund_line.refund_id
        where refund_line.order_line_id=order_line.id and refund.status='COMPLETED'
      ) refund_totals on true
      where session.store_id=:store and session.status='COMPLETED' and session.business_date=cast(:date as date)
      """)
      .param("store", storeId).param("date", day).query(ServiceSummary.class).single();
    return dailyReport(day, metrics, services);
  }

  static DailyReport dailyReport(String businessDate, DailyReportService.DailyMetrics metrics, ServiceSummary services) {
    return new DailyReport(businessDate, metrics.settledOrderCount(), metrics.customerCount(), metrics.salesAmountCents(),
      metrics.rechargeAmountCents(), metrics.bonusAmountCents(), metrics.consumptionAmountCents(), metrics.refundAmountCents(),
      metrics.netSalesAmountCents(), services.completedServiceCount(), services.serviceAmountCents(), metrics.cardOpenCents(),
      metrics.cardOpenCount(), metrics);
  }

  private long cashNet(UUID storeId, LocalDate businessDate) {
    String day = businessDate.toString();
    CashNetSummary summary = jdbc.sql("select "
      + "coalesce((select sum(payment.amount_cents) from payment_record payment join sales_order sales on sales.id=payment.order_id join store reporting_store on reporting_store.id=sales.store_id where payment.store_id=:store and sales.status='SETTLED' and payment.payment_method='CASH' and ((coalesce(sales.settled_at,sales.created_at) at time zone reporting_store.timezone)::date-case when (coalesce(sales.settled_at,sales.created_at) at time zone reporting_store.timezone)::time<reporting_store.business_day_cutoff then 1 else 0 end)=cast(:date as date)),0) sales_cash_cents,"
      + "coalesce((select sum(coalesce(corrected_amount_cents,amount_cents)) from reporting_wallet_transaction where store_id=:store and (transaction_type='RECHARGE' or (transaction_type='ADJUSTMENT' and source='RECHARGE_REFUND')) and payment_method='CASH' and business_date=cast(:date as date)),0) recharge_cash_cents,"
      + "coalesce((select sum(payment.amount_cents) from refund_payment_record payment join sales_refund refund on refund.id=payment.refund_id where refund.store_id=:store and payment.payment_method='CASH' and payment.status='COMPLETED' and refund.business_date=cast(:date as date)),0) refund_cash_cents")
      .param("store", storeId).param("date", day).query(CashNetSummary.class).single();
    return summary.salesCashCents() + summary.rechargeCashCents() - summary.refundCashCents();
  }

  private StoreOperationSummary storeOperationSummary(UUID storeId) {
    OperationalStateService.LiveState state = operationalState.live(storeId);
    long activeRooms = state.rooms().size();
    long servingRooms = state.rooms().stream().filter(room -> "IN_SERVICE".equals(room.status())).count();
    long cleaningRooms = state.rooms().stream().filter(room -> "CLEANING".equals(room.status())).count();
    long activeTechnicians = state.technicians().stream().filter(technician -> !"IDLE".equals(technician.status())).count();
    long pendingSettlement = state.rooms().stream().flatMap(room -> room.services().stream())
      .filter(service -> "COMPLETED_UNSETTLED".equals(service.serviceStatus())).count();
    long pendingRefund = jdbc.sql("select count(*) from sales_refund where store_id=:store and status='PENDING'")
      .param("store", storeId).query(Long.class).single();
    return new StoreOperationSummary(activeRooms, servingRooms, cleaningRooms, activeTechnicians, pendingSettlement, pendingRefund);
  }

  private List<CrossStoreTransaction> orderTransactions(AdminSessionService.AdminStore store, String keyword) {
    return jdbc.sql("select o.id,o.id order_id,'ORDER' transaction_type,s.id store_id,s.code store_code,s.name store_name,o.order_no reference_no,coalesce(m.name,'散客') member_name,coalesce(m.phone,'') member_phone,o.paid_cents amount_cents,o.status,coalesce((select string_agg(distinct payment_method,'、') from payment_record where order_id=o.id),'') payment_method,o.settled_at occurred_at,coalesce((select string_agg(distinct concat_ws(' · ',technician.name,room.code,session.service_name_snapshot),'、') from sales_order_service_session link join service_session session on session.id=link.service_session_id join technician on technician.id=session.technician_id left join room on room.id=session.room_id where link.order_id=o.id),'') service_trace from sales_order o join store s on s.id=o.store_id left join member m on m.id=o.member_id where o.store_id=:store and o.status='SETTLED' and (o.order_no ilike :keyword or coalesce(m.name,'') ilike :keyword or coalesce(m.phone,'') ilike :keyword) order by o.settled_at desc limit 100")
      .param("store", store.id()).param("keyword", keyword).query(CrossStoreTransaction.class).list();
  }

  private List<CrossStoreTransaction> refundTransactions(AdminSessionService.AdminStore store, String keyword) {
    return jdbc.sql("select refund.id,refund.order_id,'REFUND' transaction_type,s.id store_id,s.code store_code,s.name store_name,refund.refund_no reference_no,coalesce(member.name,'散客') member_name,coalesce(member.phone,'') member_phone,refund.total_cents amount_cents,refund.status,coalesce((select string_agg(distinct payment.payment_method,'、') from refund_payment_record payment where payment.refund_id=refund.id and payment.status='COMPLETED'),'') payment_method,coalesce(refund.completed_at,refund.created_at) occurred_at,coalesce((select string_agg(distinct concat_ws(' · ',technician.name,room.code,session.service_name_snapshot),'、') from sales_order_service_session link join service_session session on session.id=link.service_session_id join technician on technician.id=session.technician_id left join room on room.id=session.room_id where link.order_id=refund.order_id),'') service_trace from sales_refund refund join sales_order ord on ord.id=refund.order_id join store s on s.id=refund.store_id left join member on member.id=ord.member_id where refund.store_id=:store and (refund.refund_no ilike :keyword or ord.order_no ilike :keyword or coalesce(member.name,'') ilike :keyword or coalesce(member.phone,'') ilike :keyword) order by coalesce(refund.completed_at,refund.created_at) desc limit 100")
      .param("store", store.id()).param("keyword", keyword).query(CrossStoreTransaction.class).list();
  }

  private List<CrossStoreTransaction> consumptionTransactions(AdminSessionService.AdminStore store, String keyword) {
    return jdbc.sql("select wt.id,null::uuid order_id,'CONSUMPTION' transaction_type,s.id store_id,s.code store_code,s.name store_name,coalesce(wt.source,'会员消费') reference_no,member.name member_name,member.phone member_phone,wt.amount_cents,wt.transaction_type status,'' payment_method,wt.created_at occurred_at,'' service_trace from wallet_transaction wt join member on member.id=wt.member_id join store s on s.id=wt.store_id where wt.store_id=:store and wt.transaction_type='CONSUMPTION' and (member.name ilike :keyword or member.phone ilike :keyword or coalesce(member.code,'') ilike :keyword) order by wt.created_at desc limit 100")
      .param("store", store.id()).param("keyword", keyword).query(CrossStoreTransaction.class).list();
  }

  private StoreAlert alert(AdminSessionService.AdminStore store, String type, String title, long count, long amount, OffsetDateTime occurredAt) {
    return new StoreAlert(store.id(), store.code(), store.name(), type, title, count, amount, occurredAt);
  }

  private int alertPriority(String type) {
    return switch (type) {
      case "PENDING_REFUND" -> 0;
      case "PENDING_SETTLEMENT" -> 1;
      case "CLEANING_ROOM" -> 2;
      default -> 3;
    };
  }

  private LocalDate parseDate(String value, UUID storeId) {
    if (value == null || value.isBlank()) return businessClock.currentBusinessDate(storeId);
    try { return LocalDate.parse(value); }
    catch (RuntimeException exception) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Date must use YYYY-MM-DD"); }
  }

  private String yuan(long cents) { return String.format(java.util.Locale.ROOT, "%.2f", cents / 100.0); }
  private long amount(List<ChannelAmount> items,String method) { return items.stream().filter(item->method.equals(item.paymentMethod())).mapToLong(ChannelAmount::amountCents).sum(); }

  record OrderSummary(Long settledOrderCount, Long salesAmountCents) {}
  record WalletSummaryRaw(Long rechargeAmountCents, Long bonusAmountCents, Long consumptionDebitCents, Long consumptionRefundCents, Long cardOpenCents, Long cardOpenCount) {}
  record WalletSummary(Long rechargeAmountCents, Long bonusAmountCents, Long consumptionAmountCents, Long cardOpenCents, Long cardOpenCount) {}
  record RefundSummary(Long refundAmountCents) {}
  record ServiceSummary(Long completedServiceCount, Long serviceAmountCents) {}
  record ChannelAmount(String paymentMethod, Long amountCents) {}
  record PaymentChannelSummary(String businessDate,List<ChannelAmount> sales,List<ChannelAmount> refunds,List<ChannelAmount> recharges,Long cashNetCents) {}
  record ClockCounts(Long queueCount, Long callCount, Long extensionCount) {}
  record ServiceClockSummary(String businessDate, ClockCounts daily, ClockCounts monthly) {}
  record CashNetSummary(Long salesCashCents, Long rechargeCashCents, Long refundCashCents) {}
  record StoreOperationSummary(Long activeRoomCount, Long roomServingCount, Long roomCleaningCount, Long activeTechnicianCount,
                               Long pendingSettlementCount, Long pendingRefundCount) {}
  record StoreComparison(UUID storeId, String storeCode, String storeName, String businessDate, Long salesAmountCents,
                         Long completedServiceCount, Long serviceAmountCents, Long rechargeAmountCents, Long refundAmountCents,
                         Long cashNetCents, Long activeRoomCount, Long roomServingCount, Long roomCleaningCount,
                         Long activeTechnicianCount, Long pendingSettlementCount, Long pendingRefundCount) {}
  record StoreAlert(UUID storeId, String storeCode, String storeName, String alertType, String alertTitle,
                    Long alertCount, Long amountCents, OffsetDateTime occurredAt) {}
  record CrossStoreTransaction(UUID id, UUID orderId, String transactionType, UUID storeId, String storeCode, String storeName,
                               String referenceNo, String memberName, String memberPhone, Long amountCents, String status,
                               String paymentMethod, OffsetDateTime occurredAt, String serviceTrace) {}
  record DailyReport(String businessDate, Long settledOrderCount, Long customerCount, Long salesAmountCents, Long rechargeAmountCents,
                     Long bonusAmountCents, Long consumptionAmountCents, Long refundAmountCents,
                     Long netSalesAmountCents, Long completedServiceCount, Long serviceAmountCents,
                     Long cardOpenCents, Long cardOpenCount, DailyReportService.DailyMetrics unifiedMetrics) {}
  record RevenueTrendPoint(String businessDate, Long netSalesAmountCents, Long rechargeAmountCents, Long settledOrderCount) {}
  record RoomBedSummary(Long totalBedCount) {}
  record RoomUtilization(Long occupiedBedCount, Long totalBedCount, Long utilizationPercent) {}
  record LiveRoomBase(UUID roomId, String roomCode, String roomName, Integer bedCount, String status) {}
  record LiveRoomService(UUID serviceSessionId, UUID roomId, UUID bedId, String bedCode, String bedName,
                         String serviceNameSnapshot, String clockType, String serviceStatus, OffsetDateTime startedAt,
                         OffsetDateTime expectedEndAt, String technicianDisplay, Long technicianCount) {}
  record LiveRoomStatus(UUID roomId, String roomCode, String roomName, String status, Integer bedCount,
                        Long occupiedBedCount, Long availableBedCount, List<LiveRoomService> services) {}
  record LiveTechnicianStatus(UUID technicianId, String technicianCode, String technicianName, Integer queuePosition,
                              String status, UUID serviceSessionId, String roomCode, String roomName,
                              String serviceNameSnapshot, String clockType, OffsetDateTime startedAt,
                              OffsetDateTime expectedEndAt, OffsetDateTime acceptanceDeadlineAt) {}
  record LiveDispatchAttention(Long reassignmentRequiredCount, Long dispatchCancelledCount) {}
  record LiveTechnicianOverview(String businessDate, Long reassignmentRequiredCount, Long dispatchCancelledCount,
                                List<LiveTechnicianStatus> technicians) {}
  record TechnicianRanking(UUID technicianId, String technicianCode, String technicianName, Long amountCents, Long completedCount) {}
  record AttentionItem(String attentionType, String title, Long count) {}
  record ManagementOverview(DailyReport report, DailyReport previousReport, List<RevenueTrendPoint> trend,
                            RoomUtilization roomUtilization, List<TechnicianRanking> technicianRanking,
                            List<AttentionItem> attention) {}
}
