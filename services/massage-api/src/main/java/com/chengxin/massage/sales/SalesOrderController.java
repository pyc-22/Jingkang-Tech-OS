package com.chengxin.massage.sales;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.BusinessClockService;
import com.chengxin.massage.catalog.ServiceItemVersionService;
import com.chengxin.massage.catalog.ServiceItemVersionService.ResolvedServiceItem;
import com.chengxin.massage.catalog.ServiceItemVersionService.CommissionRuleVersion;

@RestController
@RequestMapping("/api/v1/sales-orders")
@CrossOrigin(origins = "*")
public class SalesOrderController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final Logger COMMISSION_LOG = LoggerFactory.getLogger("COMMISSION");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final AuditService audits;
  private final BusinessClockService businessClock;
  private final ServiceItemVersionService itemVersions;
  private final MonthlyCommissionTierService monthlyTiers;

  SalesOrderController(JdbcClient jdbc, StoreContextService storeContext, AuditService audits, BusinessClockService businessClock, ServiceItemVersionService itemVersions, MonthlyCommissionTierService monthlyTiers, AdminSessionService adminSessions) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.audits = audits;
    this.businessClock = businessClock;
    this.itemVersions = itemVersions;
    this.monthlyTiers = monthlyTiers;
  }

  @GetMapping
  List<OrderSummary> list(@RequestParam(defaultValue = "") String query,
                          @RequestParam(required = false) LocalDate from,
                          @RequestParam(required = false) LocalDate to,
                          @RequestParam(defaultValue = "") String paymentMethod,
                          @RequestParam(defaultValue = "") String status,
                          @RequestParam(required = false) Boolean historicalBackfill,
                          @RequestParam(defaultValue = "0") @Min(0) int page,
                          @RequestParam(defaultValue = "50") @Min(1) int size,
                          @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                          @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    int safeSize = Math.min(size, 200);
    int safePage = Math.max(page, 0);
    StringBuilder sql = new StringBuilder("select o.id,o.order_no,o.settlement_no,o.cashier_name_snapshot,o.status,o.refund_status,o.receivable_cents,o.paid_cents,o.created_at,o.settled_at,o.cancel_reason,o.cancelled_at,o.member_id,m.name member_name,m.phone member_phone,coalesce((select balance_cents from member_wallet where member_id=m.id),0) member_balance_cents,o.corrected_from_order_id,source.order_no corrected_from_order_no,o.correction_reason,o.financial_correction_version,o.business_correction_version,o.is_historical_backfill historical_backfill,o.backfill_date backfill_date,o.backfill_by backfill_by,o.backfill_at backfill_at,backfill_actor.display_name backfill_by_name from sales_order o left join member m on m.id=o.member_id left join sales_order source on source.id=o.corrected_from_order_id left join app_user backfill_actor on backfill_actor.id=o.backfill_by where o.store_id=:store and (o.order_no ilike :q or o.settlement_no ilike :q or coalesce(m.name,'') ilike :q or coalesce(m.phone,'') ilike :q)");
    if (from != null) sql.append(" and o.business_date >= :fromDate");
    if (to != null) sql.append(" and o.business_date <= :toDate");
    if (!paymentMethod.isBlank()) sql.append(" and exists (select 1 from payment_record filter_payment where filter_payment.order_id=o.id and filter_payment.payment_method=:paymentMethod)");
    if (!status.isBlank()) sql.append(" and o.status=:status");
    if (historicalBackfill != null) sql.append(" and o.is_historical_backfill=:historicalBackfill");
    sql.append(" order by coalesce(o.settled_at,o.created_at) desc limit :limit offset :offset");
    JdbcClient.StatementSpec statement = jdbc.sql(sql.toString())
      .param("store", storeId).param("q", "%" + query.trim() + "%")
      .param("limit", safeSize).param("offset", safePage * safeSize);
    if (from != null) statement = statement.param("fromDate", from);
    if (to != null) statement = statement.param("toDate", to);
    if (!paymentMethod.isBlank()) statement = statement.param("paymentMethod", paymentMethod.trim());
    if (!status.isBlank()) statement = statement.param("status", status.trim());
    if (historicalBackfill != null) statement = statement.param("historicalBackfill", historicalBackfill);
    return statement.query(OrderSummary.class).list();
  }

  /** Returns only historical backfills created by the authenticated manager in the current store. */
  @GetMapping("/historical-backfills/mine")
  List<MyHistoricalBackfillRecord> myHistoricalBackfills(
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    boolean manager = actor.roles().contains("STORE_MANAGER");
    boolean tenantAdmin = actor.roles().contains("TENANT_ADMIN");
    if (!manager && !tenantAdmin) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "历史补单记录仅限店长");
    }
    return jdbc.sql("""
      select o.id order_id,o.order_no,o.settlement_no,o.backfill_date,
             o.receivable_cents,o.paid_cents,
             coalesce(string_agg(distinct payment.payment_method, ',' order by payment.payment_method),'') payment_methods,
             o.backfill_by,actor.display_name backfill_by_name,o.backfill_at,o.status,o.refund_status
      from sales_order o
      left join app_user actor on actor.id=o.backfill_by
      left join payment_record payment on payment.order_id=o.id
      where o.tenant_id=:tenant and o.store_id=:store
        and o.is_historical_backfill=true and o.backfill_by=:backfillBy
      group by o.id,o.order_no,o.settlement_no,o.backfill_date,o.receivable_cents,o.paid_cents,
               o.backfill_by,actor.display_name,o.backfill_at,o.status,o.refund_status
      order by o.backfill_date desc,o.backfill_at desc
      limit 100
      """)
      .param("tenant", TENANT_ID).param("store", storeId).param("backfillBy", actor.userId())
      .query(MyHistoricalBackfillRecord.class).list();
  }

  @GetMapping("/pending-service-sessions")
  List<PendingServiceSession> pendingServiceSessions(@RequestParam(required = false) UUID roomId,
                                                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    String sql = "select ss.id,upper('FW-' || substr(replace(ss.id::text,'-',''),1,12)) service_no,ss.service_item_id,ss.service_name_snapshot,ss.service_price_cents + coalesce((select sum(extension.service_price_cents) from service_session_extension extension where extension.service_session_id=ss.id),0) service_price_cents,ss.planned_duration_minutes,ss.ended_at,ss.business_date,coalesce((select string_agg(technician.name,'、' order by participant.slot_no,participant.sequence_no) from service_session_participant participant join technician technician on technician.id=participant.technician_id where participant.service_session_id=ss.id and participant.status='COMPLETED'),t.name) technician_name,ss.room_id,r.code room_code,ss.clock_type,coalesce((select string_agg(extension.service_name_snapshot || ' ' || extension.planned_duration_minutes || '分钟', '、' order by extension.added_at) from service_session_extension extension where extension.service_session_id=ss.id),'') extension_summary from service_session ss join technician t on t.id=ss.technician_id left join room r on r.id=ss.room_id where ss.store_id=:store";
    if (roomId != null) sql += " and ss.room_id=:roomId";
    sql += " and ss.status='COMPLETED' and not exists(select 1 from sales_order_service_session link join sales_order linked_order on linked_order.id=link.order_id where link.service_session_id=ss.id and linked_order.status <> 'CANCELLED' and linked_order.refund_status <> 'FULL') order by ss.ended_at desc limit 100";
    JdbcClient.StatementSpec statement = jdbc.sql(sql).param("store", storeId);
    if (roomId != null) statement = statement.param("roomId", roomId);
    return statement.query(PendingServiceSession.class).list();
  }

  @GetMapping("/{id}/business-corrections")
  List<BusinessCorrectionView> businessCorrections(@PathVariable UUID id,
                                                    @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                                    @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return loadBusinessCorrections(storeId, id);
  }

  @GetMapping("/{id}")
  OrderDetail detail(@PathVariable UUID id,
                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    OrderSummary order = jdbc.sql("select o.id,o.order_no,o.settlement_no,o.cashier_name_snapshot,o.status,o.refund_status,o.receivable_cents,o.paid_cents,o.created_at,o.settled_at,o.cancel_reason,o.cancelled_at,o.member_id,m.name member_name,m.phone member_phone,coalesce((select balance_cents from member_wallet where member_id=m.id),0) member_balance_cents,o.corrected_from_order_id,source.order_no corrected_from_order_no,o.correction_reason,o.financial_correction_version,o.business_correction_version,o.is_historical_backfill historical_backfill,o.backfill_date backfill_date,o.backfill_by backfill_by,o.backfill_at backfill_at,backfill_actor.display_name backfill_by_name from sales_order o left join member m on m.id=o.member_id left join sales_order source on source.id=o.corrected_from_order_id left join app_user backfill_actor on backfill_actor.id=o.backfill_by where o.id=:id and o.store_id=:store")
      .param("id", id).param("store", storeId).query(OrderSummary.class).single();
    List<OrderLine> lines = jdbc.sql("select line.id,line.service_item_id,line.item_name_snapshot,line.unit_price_cents,line.duration_minutes,line.quantity,line.line_amount_cents,link.service_session_id,session.technician_id,coalesce((select string_agg(technician.name,'、' order by participant.slot_no,participant.sequence_no) from service_session_participant participant join technician technician on technician.id=participant.technician_id where participant.service_session_id=session.id and participant.status='COMPLETED'),technician.name) technician_name,room.code room_code,room.name room_name,session.ended_at service_ended_at,session.clock_type,coalesce((select count(*) from service_session_participant participant where participant.service_session_id=session.id and participant.status='COMPLETED'),0) participant_count from sales_order_line line left join sales_order_service_session link on link.order_line_id=line.id left join service_session session on session.id=link.service_session_id left join technician technician on technician.id=session.technician_id left join room room on room.id=session.room_id where line.order_id=:id")
      .param("id", id).query(OrderLine.class).list();
    List<Payment> payments = jdbc.sql("select id,payment_method,payment_method_name_snapshot,amount_cents,created_at from payment_record where order_id=:id order by created_at")
      .param("id", id).query(Payment.class).list();
    return new OrderDetail(order, lines, payments, loadBusinessCorrections(storeId, id));
  }

  private List<BusinessCorrectionView> loadBusinessCorrections(UUID storeId, UUID orderId) {
    return jdbc.sql("""
      select correction.id,correction.order_id,correction.order_line_id,correction.service_session_id,
             correction.correction_version version,
             correction.old_technician_id,correction.old_technician_name_snapshot old_technician_name,
             correction.new_technician_id,correction.new_technician_name_snapshot new_technician_name,
             correction.old_clock_type,correction.new_clock_type,
             coalesce(sum(case when record.record_type='BUSINESS_CORRECTION_REVERSAL' then -record.base_amount_cents else 0 end),0) old_base_amount_cents,
             coalesce(sum(case when record.record_type='BUSINESS_CORRECTION_REVERSAL' then -record.commission_cents else 0 end),0) old_commission_cents,
             coalesce(sum(case when record.record_type='BUSINESS_CORRECTION' then record.base_amount_cents else 0 end),0) new_base_amount_cents,
             coalesce(sum(case when record.record_type='BUSINESS_CORRECTION' then record.commission_cents else 0 end),0) new_commission_cents,
             correction.reason,correction.corrected_by_name_snapshot,correction.corrected_at
      from sales_order_business_correction correction
      left join technician_commission_record record on record.business_correction_id=correction.id
      where correction.store_id=:store and correction.order_id=:order
      group by correction.id,correction.order_id,correction.order_line_id,correction.service_session_id,
               correction.correction_version,correction.old_technician_id,correction.old_technician_name_snapshot,
               correction.new_technician_id,correction.new_technician_name_snapshot,correction.old_clock_type,
               correction.new_clock_type,correction.reason,correction.corrected_by_name_snapshot,correction.corrected_at
      order by correction.correction_version desc
      """).param("store", storeId).param("order", orderId).query(BusinessCorrectionView.class).list();
  }

  @PostMapping("/{id}/void")
  @Transactional
  OrderSummary voidOrder(@PathVariable UUID id, @Valid @RequestBody VoidInput input,
                          @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                          @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    monthlyTiers.lockStore(storeId);
    OrderVoidState state = jdbc.sql("""
      select o.status,o.paid_cents,o.order_no,
             (select count(*) from payment_record payment where payment.order_id=o.id) payment_count,
             (select count(*) from technician_commission_record commission where commission.order_id=o.id) commission_count,
             (select count(*) from sales_refund refund where refund.order_id=o.id) refund_count
      from sales_order o where o.id=:id and o.store_id=:store for update
      """).param("id", id).param("store", storeId).query(OrderVoidState.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "订单不存在"));
    String reason = input.reason().trim();
    if (reason.isBlank()) throw bad("作废原因不能为空");
    if ("CANCELLED".equals(state.status())) throw conflict("订单已经作废");
    if (!"SETTLED".equals(state.status()) && !"DRAFT".equals(state.status())) throw conflict("当前订单状态不能作废");
    if (state.paidCents() > 0 || state.paymentCount() > 0) throw conflict("已收款订单请使用整单红冲，不能直接作废");
    if (state.refundCount() > 0) throw conflict("订单已有退款记录，不能直接作废");
    OffsetDateTime cancelledAt = OffsetDateTime.now();
    if (state.commissionCount() > 0) reverseCommissionsForVoid(id, state.orderNo(), cancelledAt, businessClock.businessDate(storeId, cancelledAt));
    jdbc.sql("update sales_order set status='CANCELLED',cancel_reason=:reason,cancelled_at=:cancelledAt where id=:id and store_id=:store")
      .param("id", id).param("store", storeId).param("reason", reason).param("cancelledAt", cancelledAt).update();
    OrderSummary cancelled = jdbc.sql("select o.id,o.order_no,o.settlement_no,o.cashier_name_snapshot,o.status,o.refund_status,o.receivable_cents,o.paid_cents,o.created_at,o.settled_at,o.cancel_reason,o.cancelled_at,o.member_id,m.name member_name,m.phone member_phone,coalesce((select balance_cents from member_wallet where member_id=m.id),0) member_balance_cents,o.corrected_from_order_id,source.order_no corrected_from_order_no,o.correction_reason,o.financial_correction_version,o.business_correction_version,o.is_historical_backfill historical_backfill,o.backfill_date backfill_date,o.backfill_by backfill_by,o.backfill_at backfill_at,backfill_actor.display_name backfill_by_name from sales_order o left join member m on m.id=o.member_id left join sales_order source on source.id=o.corrected_from_order_id left join app_user backfill_actor on backfill_actor.id=o.backfill_by where o.id=:id and o.store_id=:store")
      .param("id", id).param("store", storeId).query(OrderSummary.class).single();
    audits.record(authorization, storeId, "SALES", "ORDER_VOIDED", "sales_order", id, "Sales order voided: " + reason, state, cancelled);
    return cancelled;
  }

  /** Creates a settled order and completed service records for a prior business date. */
  @PostMapping("/historical-backfill")
  @Transactional
  HistoricalBackfillResult historicalBackfill(@Valid @RequestBody HistoricalBackfillInput input,
                                               @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                               @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    monthlyTiers.lockStore(storeId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    boolean manager = actor.roles().contains("STORE_MANAGER");
    boolean cashier = actor.roles().contains("CASHIER") || actor.roles().contains("FRONTDESK");
    boolean tenantAdmin = actor.roles().contains("TENANT_ADMIN");
    // The route is separately gated by HISTORICAL_ORDER_CREATE in the
    // permission filter.  Keep this role check aligned with that contract so
    // an explicitly authorised front-desk cashier can create a backfill.
    if (!manager && !cashier && !tenantAdmin) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "历史补单仅限店长或授权前台");
    if (!Boolean.TRUE.equals(input.confirmed())) throw bad("请完成二次确认后再提交历史补单");
    LocalDate currentBusinessDate = businessClock.currentBusinessDate(storeId);
    if (input.backfillDate().isAfter(currentBusinessDate)) throw bad("补单日期不能晚于当前营业日");
    validateHistoricalPayload(input.lines(), input.settlementAmountCents());
    if (input.settlementAmountCents() == null || input.settlementAmountCents() <= 0) throw bad("补单金额必须大于 0");
    if (input.lines() == null || input.lines().isEmpty()) throw bad("补单必须至少选择一个服务项目和技师");
    if (input.payments() == null || input.payments().isEmpty()) throw bad("补单必须选择收款方式");

    // A role permission alone is not enough for store managers: the tenant
    // administrator must explicitly enable the grant for this store.
    if (manager) {
      boolean granted = jdbc.sql("""
        select exists(
          select 1 from store_manager_backfill_permission grant_row
          where grant_row.tenant_id=:tenant and grant_row.store_id=:store
            and grant_row.manager_id=:manager and grant_row.is_active=true)
        """).param("tenant", TENANT_ID).param("store", storeId).param("manager", actor.userId())
        .query(Boolean.class).single();
      if (!granted) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "当前店长尚未获得历史补单权限");
    }
    if (!adminSessions.hasPermission(authorization, "HISTORICAL_ORDER_CREATE")) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "缺少历史补单权限");
    }
    if (input.memberId() != null) ensureHistoricalMember(storeId, input.memberId());

    OffsetDateTime operatedAt = OffsetDateTime.now();
    String orderNo = nextOrderNo(operatedAt);
    String settlementNo = "JS" + java.time.ZonedDateTime.now(java.time.ZoneId.of("Asia/Shanghai"))
      .format(java.time.format.DateTimeFormatter.ofPattern("yyMMdd"))
      + String.format(java.util.Locale.ROOT, "%07d", jdbc.sql("select nextval('settlement_number_seq')").query(Long.class).single());
    UUID orderId = UUID.randomUUID();
    List<ResolvedHistoricalLine> resolvedLines = new ArrayList<>();
    long receivable = 0;
    for (HistoricalBackfillLineInput line : input.lines()) {
      if (line == null || line.serviceItemId() == null) throw bad("请选择有效的服务项目");
      ResolvedServiceItem item = itemVersions.activeItem(storeId, line.serviceItemId(), input.backfillDate())
        .orElseThrow(() -> bad("该服务项目在补单日期不可用"));
      short duration = line.durationMinutes() == null ? item.defaultDurationMinutes() : line.durationMinutes();
      if (duration < 15 || duration > 360) throw bad("服务时长必须在 15 到 360 分钟之间");
      String clockType = normalizeHistoricalClockType(line.clockType());
      List<HistoricalTechnicianAllocation> allocations = normalizeHistoricalAllocations(storeId, line);
      int allocationTotal = allocations.stream().mapToInt(allocation -> allocation.allocationBp()).sum();
      if (allocationTotal != 10000) throw bad("同一项目的技师分配比例必须合计 100%");
      if (line.roomId() != null) {
        boolean roomExists = jdbc.sql("select exists(select 1 from room where id=:room and store_id=:store and active=true)")
          .param("room", line.roomId()).param("store", storeId).query(Boolean.class).single();
        if (!roomExists) throw bad("所选房间不可用或不属于当前门店");
      }
      resolvedLines.add(new ResolvedHistoricalLine(item, duration, clockType, allocations, line.roomId()));
      receivable = Math.addExact(receivable, item.priceCents());
    }
    if (input.settlementAmountCents() > receivable) throw bad("补单金额不能超过项目合计");
    long paid = input.payments().stream().mapToLong(PaymentInput::amountCents).sum();
    if (paid != input.settlementAmountCents()) throw bad("各收款方式合计必须等于补单金额");

    jdbc.sql("""
      insert into sales_order(
        id,tenant_id,store_id,member_id,order_no,settlement_no,cashier_name_snapshot,status,
        receivable_cents,paid_cents,settled_at,business_date,is_historical_backfill,
        backfill_date,backfill_by,backfill_at)
      values(:id,:tenant,:store,:member,:no,:settlement,:cashier,'SETTLED',:receivable,:paid,
             :settled,:businessDate,true,:backfillDate,:backfillBy,:backfillAt)
      """).param("id", orderId).param("tenant", TENANT_ID).param("store", storeId)
      .param("member", input.memberId()).param("no", orderNo).param("settlement", settlementNo)
      .param("cashier", actor.displayName()).param("receivable", receivable).param("paid", paid)
      .param("settled", operatedAt).param("businessDate", input.backfillDate())
      .param("backfillDate", input.backfillDate()).param("backfillBy", actor.userId()).param("backfillAt", operatedAt).update();

    List<String> paymentNames = new ArrayList<>();
    for (ResolvedHistoricalLine line : resolvedLines) {
      UUID orderLineId = UUID.randomUUID();
      jdbc.sql("insert into sales_order_line(id,order_id,service_item_id,item_name_snapshot,unit_price_cents,duration_minutes,line_amount_cents) values(:id,:order,:service,:name,:price,:duration,:amount)")
        .param("id", orderLineId).param("order", orderId).param("service", line.item().id())
        .param("name", line.item().name()).param("price", line.item().priceCents()).param("duration", line.durationMinutes()).param("amount", line.item().priceCents()).update();
      List<ManualTechnicianAllocation> technicians = line.allocations().stream()
        .map(allocation -> new ManualTechnicianAllocation(allocation.technicianId(), allocation.allocationBp()))
        .toList();
      UUID commissionRuleVersionId = itemVersions.commissionRule(storeId, line.item().id(), input.backfillDate()).id();
      Line materialized = materializeManualLine(storeId,
        new Line(line.item().id(), line.item().name(), line.item().priceCents(), line.durationMinutes(), null,
          input.backfillDate(), line.clockType(), line.roomId(), technicians, line.item().priceVersionId(),
          commissionRuleVersionId, line.item().countsAsClock()), operatedAt, input.backfillDate());
      linkServiceSession(storeId, orderId, orderLineId, materialized.serviceSessionId());
      createCommissionRecords(storeId, orderId, orderLineId, orderNo, settlementNo,
        materialized.serviceSessionId(), operatedAt, input.backfillDate());
    }
    for (PaymentInput payment : input.payments()) {
      PaymentMethod method = paymentMethod(storeId, payment.method());
      if ("MEMBER_BALANCE".equals(method.methodKind())) consumeHistoricalWallet(storeId, input.memberId(), payment.amountCents(), orderId, input.backfillDate());
      paymentNames.add(method.name());
      jdbc.sql("insert into payment_record(id,tenant_id,store_id,order_id,payment_method,payment_method_name_snapshot,amount_cents) values(:id,:tenant,:store,:order,:method,:name,:amount)")
        .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("order", orderId)
        .param("method", method.code()).param("name", method.name()).param("amount", payment.amountCents()).update();
    }
    HistoricalBackfillResult result = new HistoricalBackfillResult(orderId, orderNo, settlementNo,
      input.backfillDate(), receivable, paid, actor.userId(), actor.displayName());
    audits.record(authorization, storeId, "SALES", "HISTORICAL_ORDER_BACKFILLED", "sales_order", orderId,
      "历史补单日期=" + input.backfillDate() + ";订单号=" + orderNo + ";金额=" + paid + ";支付方式=" + String.join(",", paymentNames), null, result);
    return result;
  }

  private void validateHistoricalPayload(@NotEmpty List<@Valid HistoricalBackfillLineInput> lines,
                                         @Min(1) Long amountCents) {
    if (lines == null || lines.isEmpty()) throw bad("补单必须至少选择一个服务项目和技师");
    if (amountCents == null || amountCents <= 0) throw bad("补单金额必须大于 0");
  }

  private List<HistoricalTechnicianAllocation> normalizeHistoricalAllocations(UUID storeId, HistoricalBackfillLineInput line) {
    List<HistoricalTechnicianAllocation> requested = line.technicians() == null ? List.of() : line.technicians();
    if (requested.isEmpty() && line.technicianId() != null) {
      requested = List.of(new HistoricalTechnicianAllocation(line.technicianId(), line.allocationBp() == null ? 10000 : line.allocationBp()));
    }
    if (requested.isEmpty()) throw bad("每个补单项目必须至少选择一名技师");
    if (requested.size() > 4) throw bad("一个项目最多选择 4 位技师");
    Set<UUID> unique = new HashSet<>();
    List<HistoricalTechnicianAllocation> resolved = new ArrayList<>();
    for (HistoricalTechnicianAllocation allocation : requested) {
      if (allocation == null || allocation.technicianId() == null || !unique.add(allocation.technicianId())) {
        throw bad("补单项目技师必须有效且不能重复");
      }
      int bp = allocation.allocationBp() == null ? 0 : allocation.allocationBp();
      if (bp < 1 || bp > 10000) throw bad("技师分配比例必须在 1% 到 100% 之间");
      TechnicianSnapshot technician = jdbc.sql("select id,name from technician where id=:id and store_id=:store and active=true")
        .param("id", allocation.technicianId()).param("store", storeId).query(TechnicianSnapshot.class).optional()
        .orElseThrow(() -> bad("所选技师已停用或不属于当前门店"));
      resolved.add(new HistoricalTechnicianAllocation(technician.id(), bp, technician.name()));
    }
    return resolved;
  }

  private String normalizeHistoricalClockType(String value) {
    String normalized = value == null ? "QUEUE" : value.trim().toUpperCase();
    if (!List.of("QUEUE", "CALL", "SELECTED", "BOOKED_QUEUE", "BOOKED_CALL", "EXTENSION").contains(normalized)) {
      throw bad("钟类不受支持");
    }
    return normalized;
  }

  @PostMapping("/settle")
  @Transactional
  Order settle(@Valid @RequestBody SettleInput input,
               @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
               @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    monthlyTiers.lockStore(storeId);
    Order existingOrder = input.correctedFromOrderId() == null ? findExistingSettledOrder(storeId, input.lines()) : null;
    if (existingOrder != null) return existingOrder;
    CorrectionSource correctionSource = null;
    String correctionReason = input.correctionReason() == null ? "" : input.correctionReason().trim();
    if (input.correctedFromOrderId() != null) {
      if (correctionReason.isBlank()) throw bad("修正原因不能为空");
      correctionSource = jdbc.sql("select id,order_no,status,refund_status from sales_order where id=:id and store_id=:store for update")
        .param("id", input.correctedFromOrderId()).param("store", storeId).query(CorrectionSource.class).optional()
        .orElseThrow(() -> bad("原订单不存在或不属于当前门店"));
      if (!"CANCELLED".equals(correctionSource.status()) && !"FULL".equals(correctionSource.refundStatus())) {
        throw conflict("原订单必须先作废或完成整单红冲");
      }
      boolean activeCorrectionExists = jdbc.sql("select exists(select 1 from sales_order where corrected_from_order_id=:source and status <> 'CANCELLED' and refund_status <> 'FULL')")
        .param("source", correctionSource.id()).query(Boolean.class).single();
      if (activeCorrectionExists) throw conflict("该原订单已经生成有效修正单");
    }
    if (input.memberId() != null) ensureMember(input.memberId());
    List<Line> lines = input.lines().stream().map(line -> line(storeId, line)).toList();
    Set<UUID> linkedSessions = new HashSet<>();
    for (Line line : lines) {
      if (line.serviceSessionId() != null && !linkedSessions.add(line.serviceSessionId())) throw bad("同一服务不能在一笔订单中重复结算");
    }
    if (correctionSource != null) validateCorrectionServiceSessions(storeId, correctionSource.id(), lines);
    Set<LocalDate> serviceBusinessDates = new HashSet<>();
    for (Line line : lines) if (line.businessDate() != null) serviceBusinessDates.add(line.businessDate());
    if (serviceBusinessDates.size() > 1) throw conflict("所选服务不属于同一营业日，请分开结算");
    long originalTotal = lines.stream().mapToLong(Line::priceCents).sum();
    long total = input.settlementAmountCents() == null ? originalTotal : input.settlementAmountCents();
    if (total < 0) throw bad("实收金额不能为负数");
    boolean waived = total == 0;
    String waiveReason = input.waiveReason() == null ? "" : input.waiveReason().trim();
    if (waived && waiveReason.isBlank()) throw bad("0.00 元结算必须填写免单原因");
    if (!waived && total < 1) throw bad("普通结算最低实收金额为 0.01 元");
    long paid = input.payments().stream().mapToLong(PaymentInput::amountCents).sum();
    if (waived && !input.payments().isEmpty()) throw bad("免单不能填写收款金额");
    if (total != paid) throw bad("各收款方式合计必须等于实收金额");

    UUID orderId = UUID.randomUUID();
    OffsetDateTime settledAt = OffsetDateTime.now();
    LocalDate businessDate = businessClock.businessDate(storeId, settledAt);
    String orderNo = nextOrderNo(settledAt);
    String settlementNo = "JS" + java.time.ZonedDateTime.now(java.time.ZoneId.of("Asia/Shanghai")).format(java.time.format.DateTimeFormatter.ofPattern("yyMMdd")) + String.format("%07d", jdbc.sql("select nextval('settlement_number_seq')").query(Long.class).single());
    String cashierName = adminSessions.authenticatedIdentity(authorization).displayName();
    jdbc.sql("insert into sales_order(id,tenant_id,store_id,member_id,order_no,settlement_no,cashier_name_snapshot,status,receivable_cents,paid_cents,settled_at,business_date,corrected_from_order_id,correction_reason) values(:id,:tenant,:store,:member,:no,:settlement,:cashier,'SETTLED',:total,:paid,:settled,:businessDate,:correctedFrom,:correctionReason)")
      .param("id", orderId).param("tenant", TENANT_ID).param("store", storeId).param("member", input.memberId()).param("no", orderNo).param("settlement", settlementNo).param("cashier", cashierName).param("total", total).param("paid", paid).param("settled", settledAt).param("businessDate", businessDate).param("correctedFrom", input.correctedFromOrderId()).param("correctionReason", correctionReason.isBlank() ? null : correctionReason).update();
    List<Line> materializedLines = new ArrayList<>(lines.size());
    for (Line line : lines) {
      Line materialized = line.serviceSessionId() == null
        ? materializeManualLine(storeId, line, settledAt, businessDate)
        : line;
      materializedLines.add(materialized);
      UUID orderLineId = UUID.randomUUID();
      jdbc.sql("insert into sales_order_line(id,order_id,service_item_id,item_name_snapshot,unit_price_cents,duration_minutes,line_amount_cents) values(:id,:order,:service,:name,:price,:duration,:amount)")
        .param("id", orderLineId).param("order", orderId).param("service", materialized.serviceItemId()).param("name", materialized.name()).param("price", materialized.priceCents()).param("duration", materialized.durationMinutes()).param("amount", materialized.priceCents()).update();
      if (materialized.serviceSessionId() != null) {
        linkServiceSession(storeId, orderId, orderLineId, materialized.serviceSessionId());
        createCommissionRecords(storeId, orderId, orderLineId, orderNo, settlementNo, materialized.serviceSessionId(), settledAt, businessDate);
      }
    }
    for (PaymentInput payment : input.payments()) {
      PaymentMethod method = paymentMethod(storeId, payment.method());
      if ("MEMBER_BALANCE".equals(method.methodKind())) consumeWallet(storeId, input.memberId(), payment.amountCents(), orderId, businessDate);
      jdbc.sql("insert into payment_record(id,tenant_id,store_id,order_id,payment_method,payment_method_name_snapshot,amount_cents) values(:id,:tenant,:store,:order,:method,:name,:amount)")
        .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("order", orderId).param("method", method.code()).param("name", method.name()).param("amount", payment.amountCents()).update();
    }
    if (correctionSource == null) updateLinkedServiceRoomStates(storeId, materializedLines, orderNo);
    Order settled = new Order(orderId, orderNo, total, paid, "SETTLED", settledAt);
    audits.record(authorization, storeId, "SALES", "ORDER_SETTLED", "sales_order", orderId,
      "Sales order settled; original=" + originalTotal + "; settlement=" + total + (waived ? "; waiveReason=" + waiveReason : "")
        + (correctionSource == null ? "" : "; correctedFrom=" + correctionSource.orderNo() + "; correctionReason=" + correctionReason), null, settled);
    return settled;
  }

  private Order findExistingSettledOrder(UUID storeId, List<LineInput> inputs) {
    List<UUID> sessions = inputs.stream().map(LineInput::serviceSessionId).filter(java.util.Objects::nonNull).distinct().sorted().toList();
    if (sessions.isEmpty()) return null;
    for (UUID sessionId : sessions) {
      jdbc.sql("select id from service_session where id=:id and store_id=:store for update")
        .param("id", sessionId).param("store", storeId).query(UUID.class).optional();
    }
    List<ExistingSessionOrder> rows = jdbc.sql("""
      select link.service_session_id,order_header.id,order_header.order_no,order_header.receivable_cents,
             order_header.paid_cents,order_header.status,order_header.settled_at
      from sales_order_service_session link
      join sales_order order_header on order_header.id=link.order_id
      where link.store_id=:store and link.service_session_id in (:sessions)
        and order_header.status='SETTLED' and order_header.refund_status <> 'FULL'
      order by order_header.settled_at desc
      """).param("store", storeId).param("sessions", sessions).query(ExistingSessionOrder.class).list();
    if (rows.size() != sessions.size()) return null;
    UUID orderId = rows.getFirst().id();
    if (rows.stream().anyMatch(row -> !orderId.equals(row.id()))) return null;
    ExistingSessionOrder row = rows.getFirst();
    return new Order(row.id(), row.orderNo(), row.receivableCents(), row.paidCents(), row.status(), row.settledAt());
  }

  private String nextOrderNo(OffsetDateTime settledAt) {
    long sequence = jdbc.sql("select nextval('order_number_seq')").query(Long.class).single();
    String date = java.time.ZonedDateTime.ofInstant(settledAt.toInstant(), java.time.ZoneId.of("Asia/Shanghai"))
      .format(java.time.format.DateTimeFormatter.ofPattern("yyMMdd"));
    return "SO" + date + String.format(java.util.Locale.ROOT, "%08d", sequence);
  }

  @PostMapping("/{id}/financial-corrections")
  @Transactional
  FinancialCorrectionResult correctFinancials(@PathVariable UUID id, @Valid @RequestBody FinancialCorrectionInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    FinancialCorrectionOrder order = jdbc.sql("select id,member_id,order_no,status,refund_status,paid_cents,financial_correction_version,business_date from sales_order where id=:id and store_id=:store for update")
      .param("id", id).param("store", storeId).query(FinancialCorrectionOrder.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "订单不存在"));
    if (!"SETTLED".equals(order.status())) throw conflict("只有已结算订单可以更正收款信息");
    if (!"NONE".equals(order.refundStatus())) throw conflict("订单已有退款或红冲结果，不能直接更正收款信息");
    boolean refundHistory = jdbc.sql("select exists(select 1 from sales_refund where order_id=:order)")
      .param("order", id).query(Boolean.class).single();
    if (refundHistory) throw conflict("订单已有退款申请记录，请通过退款流程处理");
    if (!input.expectedVersion().equals(order.financialCorrectionVersion())) throw conflict("订单已被其他人修改，请刷新后重试");
    String reason = input.reason().trim();
    if (reason.isBlank()) throw bad("更正原因不能为空");
    long newPaid = input.settlementAmountCents();
    long paymentTotal = input.payments().stream().mapToLong(PaymentInput::amountCents).sum();
    if (newPaid != paymentTotal) throw bad("支付方式合计必须等于修改后的实收金额");
    List<Payment> beforePayments = jdbc.sql("select id,payment_method,payment_method_name_snapshot,amount_cents,created_at from payment_record where order_id=:order order by created_at,id")
      .param("order", id).query(Payment.class).list();
    List<ResolvedCorrectionPayment> afterPayments = new ArrayList<>();
    Set<String> correctionMethods = new HashSet<>();
    for (PaymentInput payment : input.payments()) {
      PaymentMethod method = paymentMethod(storeId, payment.method());
      if (!correctionMethods.add(method.code())) throw bad("同一收款方式不能重复填写");
      afterPayments.add(new ResolvedCorrectionPayment(method.code(), method.name(), method.methodKind(), payment.amountCents()));
    }
    long oldMemberPayment = beforePayments.stream().filter(payment -> "MEMBER_BALANCE".equals(payment.paymentMethod())).mapToLong(Payment::amountCents).sum();
    long newMemberPayment = afterPayments.stream().filter(payment -> "MEMBER_BALANCE".equals(payment.methodKind())).mapToLong(ResolvedCorrectionPayment::amountCents).sum();
    if (newMemberPayment > 0 && order.memberId() == null) throw bad("使用会员余额时订单必须关联会员");
    long memberDelta = newMemberPayment - oldMemberPayment;
    LocalDate correctionBusinessDate = businessClock.businessDate(storeId, OffsetDateTime.now());
    if (memberDelta > 0) consumeWallet(storeId, order.memberId(), memberDelta, id, correctionBusinessDate);
    else if (memberDelta < 0) restoreWalletForCorrection(storeId, order.memberId(), -memberDelta, id, correctionBusinessDate);

    int version = order.financialCorrectionVersion() + 1;
    UUID correctionId = UUID.randomUUID();
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    jdbc.sql("insert into sales_order_financial_correction(id,tenant_id,store_id,order_id,correction_version,old_paid_cents,new_paid_cents,reason,corrected_by_user_id,corrected_by_name_snapshot) values(:id,:tenant,:store,:order,:version,:oldPaid,:newPaid,:reason,:actor,:actorName)")
      .param("id", correctionId).param("tenant", TENANT_ID).param("store", storeId).param("order", id).param("version", version)
      .param("oldPaid", order.paidCents()).param("newPaid", newPaid).param("reason", reason).param("actor", actor.userId()).param("actorName", actor.displayName()).update();
    for (Payment payment : beforePayments) snapshotCorrectionPayment(correctionId, "BEFORE", payment.paymentMethod(), payment.paymentMethodNameSnapshot(), payment.amountCents());
    for (ResolvedCorrectionPayment payment : afterPayments) snapshotCorrectionPayment(correctionId, "AFTER", payment.code(), payment.name(), payment.amountCents());
    jdbc.sql("delete from payment_record where order_id=:order").param("order", id).update();
    for (ResolvedCorrectionPayment payment : afterPayments) {
      jdbc.sql("insert into payment_record(id,tenant_id,store_id,order_id,payment_method,payment_method_name_snapshot,amount_cents) values(:id,:tenant,:store,:order,:method,:name,:amount)")
        .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("order", id)
        .param("method", payment.code()).param("name", payment.name()).param("amount", payment.amountCents()).update();
    }
    jdbc.sql("update sales_order set paid_cents=:paid,financial_correction_version=:version where id=:id and store_id=:store")
      .param("paid", newPaid).param("version", version).param("id", id).param("store", storeId).update();
    FinancialCorrectionResult result = new FinancialCorrectionResult(id, order.orderNo(), version, order.paidCents(), newPaid, memberDelta, reason);
    audits.record(authorization, storeId, "SALES", "ORDER_FINANCIAL_CORRECTED", "sales_order", id, "已结算订单收款信息更正", order, result);
    return result;
  }

  private void snapshotCorrectionPayment(UUID correctionId, String side, String method, String name, long amount) {
    jdbc.sql("insert into sales_order_financial_correction_payment(id,correction_id,snapshot_side,payment_method,payment_method_name_snapshot,amount_cents) values(:id,:correction,:side,:method,:name,:amount)")
      .param("id", UUID.randomUUID()).param("correction", correctionId).param("side", side).param("method", method).param("name", name).param("amount", amount).update();
  }

  @PostMapping("/{id}/business-corrections")
  @Transactional
  BusinessCorrectionResult correctBusiness(@PathVariable UUID id, @Valid @RequestBody BusinessCorrectionInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    monthlyTiers.lockStore(storeId);
    BusinessCorrectionState state = jdbc.sql("""
      select o.id order_id,o.order_no,o.settlement_no,o.status,o.refund_status,o.business_date,o.business_correction_version,
             line.id order_line_id,link.service_session_id,session.technician_id old_technician_id,technician.name old_technician_name,
             session.clock_type old_clock_type,session.status session_status,
             (select count(*) from service_session_participant participant where participant.service_session_id=session.id) participant_count,
             (select count(*) from service_session_extension extension where extension.service_session_id=session.id and extension.technician_id<>session.technician_id) foreign_extension_count
      from sales_order o
      join sales_order_line line on line.order_id=o.id
      join sales_order_service_session link on link.order_line_id=line.id
      join service_session session on session.id=link.service_session_id
      join technician technician on technician.id=session.technician_id
      where o.id=:order and o.store_id=:store and line.id=:line
      for update of o,session
      """).param("order", id).param("store", storeId).param("line", input.orderLineId()).query(BusinessCorrectionState.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "订单项目或服务记录不存在"));
    if (!"SETTLED".equals(state.status())) throw conflict("只有已结算订单可以修改技师和钟类");
    if (!"NONE".equals(state.refundStatus())) throw conflict("订单已有退款结果，不能修改技师和钟类");
    boolean refundHistory = jdbc.sql("select exists(select 1 from sales_refund where order_id=:order)")
      .param("order", id).query(Boolean.class).single();
    if (refundHistory) throw conflict("订单已有退款申请记录，不能修改技师和钟类");
    if (!input.expectedVersion().equals(state.businessCorrectionVersion())) throw conflict("订单已被其他人修改，请刷新后重试");
    if (!"COMPLETED".equals(state.sessionStatus())) throw conflict("只有已完成服务可以修改技师和钟类");
    if (state.participantCount() != 1 || state.foreignExtensionCount() != 0) throw conflict("多人服务或中途换技师的订单请通过红冲后重新结算处理");
    String clockType = normalizeCorrectionClockType(input.clockType());
    String reason = input.reason().trim();
    TechnicianSnapshot target = jdbc.sql("select id,name from technician where id=:id and store_id=:store and active=true")
      .param("id", input.technicianId()).param("store", storeId).query(TechnicianSnapshot.class).optional()
      .orElseThrow(() -> bad("所选技师已停用或不属于当前门店"));
    if (state.oldTechnicianId().equals(target.id()) && state.oldClockType().equals(clockType)) throw bad("技师和钟类均未发生变化");

    int version = state.businessCorrectionVersion() + 1;
    UUID correctionId = UUID.randomUUID();
    OffsetDateTime correctedAt = OffsetDateTime.now();
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    jdbc.sql("insert into sales_order_business_correction(id,tenant_id,store_id,order_id,order_line_id,service_session_id,correction_version,old_technician_id,old_technician_name_snapshot,new_technician_id,new_technician_name_snapshot,old_clock_type,new_clock_type,reason,corrected_by_user_id,corrected_by_name_snapshot,corrected_at) values(:id,:tenant,:store,:order,:line,:session,:version,:oldTechnician,:oldName,:newTechnician,:newName,:oldClock,:newClock,:reason,:actor,:actorName,:correctedAt)")
      .param("id", correctionId).param("tenant", TENANT_ID).param("store", storeId).param("order", id).param("line", state.orderLineId()).param("session", state.serviceSessionId()).param("version", version)
      .param("oldTechnician", state.oldTechnicianId()).param("oldName", state.oldTechnicianName()).param("newTechnician", target.id()).param("newName", target.name())
      .param("oldClock", state.oldClockType()).param("newClock", clockType).param("reason", reason).param("actor", actor.userId()).param("actorName", actor.displayName()).param("correctedAt", correctedAt).update();

    reverseCurrentCommissionsForBusinessCorrection(id, state.orderLineId(), correctionId, correctedAt, state.businessDate());
    jdbc.sql("update service_session_participant set technician_id=:technician where service_session_id=:session")
      .param("technician", target.id()).param("session", state.serviceSessionId()).update();
    jdbc.sql("update service_session_extension set technician_id=:technician where service_session_id=:session")
      .param("technician", target.id()).param("session", state.serviceSessionId()).update();
    jdbc.sql("update service_session set technician_id=:technician,clock_type=:clock,updated_at=now(),version=version+1 where id=:session and store_id=:store")
      .param("technician", target.id()).param("clock", clockType).param("session", state.serviceSessionId()).param("store", storeId).update();
    createCommissionRecords(storeId, id, state.orderLineId(), state.orderNo(), state.settlementNo(), state.serviceSessionId(), correctedAt, state.businessDate(), "BUSINESS_CORRECTION", correctionId);
    jdbc.sql("update sales_order set business_correction_version=:version where id=:order and store_id=:store")
      .param("version", version).param("order", id).param("store", storeId).update();
    BusinessCorrectionResult result = new BusinessCorrectionResult(id, state.orderLineId(), version, state.oldTechnicianId(), state.oldTechnicianName(), target.id(), target.name(), state.oldClockType(), clockType, reason);
    audits.record(authorization, storeId, "SALES", "ORDER_BUSINESS_CORRECTED", "sales_order", id, "已结算订单技师及钟类更正", state, result);
    return result;
  }

  private String normalizeCorrectionClockType(String value) {
    String normalized = value == null ? "" : value.trim().toUpperCase();
    if (!List.of("QUEUE", "CALL").contains(normalized)) throw bad("钟类只支持排钟或点钟");
    return normalized;
  }

  private void restoreWalletForCorrection(UUID transactionStoreId, UUID memberId, long amount, UUID orderId, LocalDate businessDate) {
    if (memberId == null) throw bad("原订单没有关联会员余额");
    Wallet wallet = jdbc.sql("select w.id,w.balance_cents from member_wallet w join member m on m.id=w.member_id where w.member_id=:member and m.tenant_id=:tenant for update")
      .param("member", memberId).param("tenant", TENANT_ID).query(Wallet.class).single();
    long after = wallet.balanceCents() + amount;
    jdbc.sql("update member_wallet set balance_cents=:balance,updated_at=now(),version=version+1 where id=:id")
      .param("balance", after).param("id", wallet.id()).update();
    jdbc.sql("insert into wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,note,business_date) values(:id,:tenant,:store,:wallet,:member,'REFUND',:amount,:before,:after,'ORDER_CORRECTION',:note,:businessDate)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", transactionStoreId).param("wallet", wallet.id()).param("member", memberId)
      .param("amount", amount).param("before", wallet.balanceCents()).param("after", after).param("note", orderId.toString()).param("businessDate", businessDate).update();
  }

  private void createCommissionRecords(UUID storeId, UUID orderId, UUID orderLineId, String orderNo, String settlementNo, UUID serviceSessionId, OffsetDateTime settledAt, LocalDate businessDate) {
    createCommissionRecords(storeId, orderId, orderLineId, orderNo, settlementNo, serviceSessionId, settledAt, businessDate, "SETTLEMENT", null);
  }

  private void createCommissionRecords(UUID storeId, UUID orderId, UUID orderLineId, String orderNo, String settlementNo, UUID serviceSessionId, OffsetDateTime settledAt, LocalDate businessDate, String recordType, UUID businessCorrectionId) {
    COMMISSION_LOG.info("createCommissionRecords entry storeId={} orderId={} orderLineId={} orderNo={} settlementNo={} serviceSessionId={} settledAt={} businessDate={} recordType={} businessCorrectionId={}",
      storeId, orderId, orderLineId, orderNo, settlementNo, serviceSessionId, settledAt, businessDate, recordType, businessCorrectionId);
    List<ParticipantCommissionBase> participants = List.of();
    List<CommissionBase> allocated = List.of();
    List<CommissionBase> extensions = List.of();
    try {
      participants = jdbc.sql("select participant.id service_participant_id,ss.id service_session_id,ss.service_item_id,participant.technician_id,technician.name technician_name,ss.service_name_snapshot,ss.service_price_cents,ss.clock_type,ss.commission_rule_version_id,ss.business_date,ss.counts_as_clock_snapshot,ss.planned_duration_minutes,participant.slot_no,participant.sequence_no,participant.allocation_bp,greatest(0,extract(epoch from (participant.service_ended_at-participant.service_started_at))::integer) served_seconds from service_session_participant participant join service_session ss on ss.id=participant.service_session_id join technician technician on technician.id=participant.technician_id where participant.service_session_id=:session and participant.store_id=:store and participant.status='COMPLETED' order by participant.slot_no,participant.sequence_no")
        .param("session", serviceSessionId).param("store", storeId).query(ParticipantCommissionBase.class).list();
      COMMISSION_LOG.info("createCommissionRecords participants count={} values={}", participants.size(), participants);
      allocated = allocatedMainCommissions(participants);
      COMMISSION_LOG.info("createCommissionRecords main allocation count={} values={}", allocated.size(), allocated);
      for (CommissionBase main : allocated) {
        String sourceType = "EXTENSION".equals(main.clockType()) ? "EXTENSION" : "MAIN";
        insertCommissionRecord(storeId, orderId, orderLineId, orderNo, settlementNo, main, sourceType, settledAt, businessDate, recordType, businessCorrectionId);
      }
      extensions = jdbc.sql("select e.service_session_id,e.id service_session_extension_id,e.service_item_id,e.technician_id,t.name technician_name,e.service_name_snapshot,e.service_price_cents base_amount_cents,'EXTENSION' clock_type,e.commission_rule_version_id,ss.business_date,e.counts_as_clock_snapshot,0::smallint duration_minutes,null::uuid service_participant_id,10000 allocation_bp_snapshot,0 served_seconds_snapshot,0::smallint clock_adjustment,10000 fixed_scale_bp from service_session_extension e join technician t on t.id=e.technician_id join service_session ss on ss.id=e.service_session_id where e.service_session_id=:session and e.store_id=:store order by e.added_at")
        .param("session", serviceSessionId).param("store", storeId).query(CommissionBase.class).list();
      COMMISSION_LOG.info("createCommissionRecords extensions count={} values={}", extensions.size(), extensions);
      for (CommissionBase extension : extensions) insertCommissionRecord(storeId, orderId, orderLineId, orderNo, settlementNo, extension, "EXTENSION", settledAt, businessDate, recordType, businessCorrectionId);
      COMMISSION_LOG.info("createCommissionRecords exit orderId={} mainCount={} extensionCount={}", orderId, allocated.size(), extensions.size());
    } catch (RuntimeException exception) {
      COMMISSION_LOG.error("createCommissionRecords exception state={storeId=" + storeId + ", orderId=" + orderId + ", orderLineId=" + orderLineId + ", orderNo=" + orderNo + ", settlementNo=" + settlementNo + ", serviceSessionId=" + serviceSessionId + ", businessDate=" + businessDate + ", recordType=" + recordType + ", businessCorrectionId=" + businessCorrectionId + ", participants=" + participants + ", allocated=" + allocated + ", extensions=" + extensions + "}", exception);
      throw exception;
    }
  }

  List<CommissionBase> allocatedMainCommissions(List<ParticipantCommissionBase> participants) {
    COMMISSION_LOG.info("allocatedMainCommissions entry participants={}", participants);
    Map<Short,List<ParticipantCommissionBase>> slots = new LinkedHashMap<>();
    int serviceAmount = 0;
    int allocatedService = 0;
    int slotIndex = 0;
    List<CommissionBase> result = new ArrayList<>();
    try {
      if (participants.isEmpty()) throw conflict("Service participant records are missing");
      for (ParticipantCommissionBase participant : participants) slots.computeIfAbsent(participant.slotNo(), ignored -> new ArrayList<>()).add(participant);
      serviceAmount = participants.getFirst().servicePriceCents();
      COMMISSION_LOG.info("allocatedMainCommissions grouped slotCount={} serviceAmount={} slots={}", slots.size(), serviceAmount, slots);
      for (List<ParticipantCommissionBase> slot : slots.values()) {
        slotIndex++;
        int slotAllocation = slot.getFirst().allocationBp();
        int slotAmount = slotIndex == slots.size() ? serviceAmount - allocatedService : proportional(serviceAmount, slotAllocation, 10000);
        allocatedService += slotAmount;
        int totalSeconds = slot.stream().mapToInt(ParticipantCommissionBase::servedSeconds).sum();
        int allocatedSlotAmount = 0;
        int allocatedTimeBp = 0;
        ParticipantCommissionBase clockOwner = slot.stream().max((left,right) -> {
          int duration = Integer.compare(left.servedSeconds(), right.servedSeconds());
          return duration != 0 ? duration : Short.compare(right.sequenceNo(), left.sequenceNo());
        }).orElse(slot.getFirst());
        COMMISSION_LOG.info("allocatedMainCommissions slot index={} slotNo={} participantCount={} slotAllocationBp={} slotAmount={} allocatedService={} totalSeconds={} clockOwner={}",
          slotIndex, slot.getFirst().slotNo(), slot.size(), slotAllocation, slotAmount, allocatedService, totalSeconds, clockOwner.serviceParticipantId());
        for (int index = 0; index < slot.size(); index++) {
          ParticipantCommissionBase participant = slot.get(index);
          int timeBp = index == slot.size() - 1 ? 10000 - allocatedTimeBp
            : totalSeconds == 0 ? 10000 / slot.size() : proportional(participant.servedSeconds(), 10000, totalSeconds);
          allocatedTimeBp += timeBp;
          int participantAmount = index == slot.size() - 1 ? slotAmount - allocatedSlotAmount : proportional(slotAmount, timeBp, 10000);
          allocatedSlotAmount += participantAmount;
          int overallBp = proportional(slotAllocation, timeBp, 10000);
          short clock = (short) (Boolean.TRUE.equals(participant.countsAsClockSnapshot()) && participant.serviceParticipantId().equals(clockOwner.serviceParticipantId()) ? 1 : 0);
          short duration = (short) Math.min(720, (participant.servedSeconds() + 30) / 60);
          COMMISSION_LOG.info("allocatedMainCommissions participant slotNo={} sequenceNo={} participantId={} technicianId={} servedSeconds={} timeBp={} participantAmount={} overallBp={} clockAdjustment={} durationMinutes={} allocatedSlotAmount={} allocatedTimeBp={}",
            participant.slotNo(), participant.sequenceNo(), participant.serviceParticipantId(), participant.technicianId(), participant.servedSeconds(), timeBp, participantAmount, overallBp, clock, duration, allocatedSlotAmount, allocatedTimeBp);
          result.add(new CommissionBase(participant.serviceSessionId(), null, participant.serviceItemId(), participant.technicianId(), participant.technicianName(),
            participant.serviceNameSnapshot(), participantAmount, participant.clockType(), participant.commissionRuleVersionId(), participant.businessDate(),
            participant.countsAsClockSnapshot(), duration, participant.serviceParticipantId(), overallBp, participant.servedSeconds(), clock, timeBp));
        }
      }
      COMMISSION_LOG.info("allocatedMainCommissions exit resultCount={} result={} allocatedService={} serviceAmount={}", result.size(), result, allocatedService, serviceAmount);
      return result;
    } catch (RuntimeException exception) {
      COMMISSION_LOG.error("allocatedMainCommissions exception state={participants=" + participants + ", slots=" + slots + ", serviceAmount=" + serviceAmount + ", allocatedService=" + allocatedService + ", slotIndex=" + slotIndex + ", result=" + result + "}", exception);
      throw exception;
    }
  }

  private int proportional(int value, int numerator, int denominator) {
    COMMISSION_LOG.debug("proportional entry value={} numerator={} denominator={}", value, numerator, denominator);
    try {
      int result = denominator == 0 ? 0 : (int) (((long) value * numerator + denominator / 2L) / denominator);
      COMMISSION_LOG.info("proportional exit value={} numerator={} denominator={} result={}", value, numerator, denominator, result);
      return result;
    } catch (RuntimeException exception) {
      COMMISSION_LOG.error("proportional exception state={value=" + value + ", numerator=" + numerator + ", denominator=" + denominator + "}", exception);
      throw exception;
    }
  }

  private void insertCommissionRecord(UUID storeId, UUID orderId, UUID orderLineId, String orderNo, String settlementNo, CommissionBase base, String sourceType, OffsetDateTime settledAt, LocalDate businessDate) {
    insertCommissionRecord(storeId, orderId, orderLineId, orderNo, settlementNo, base, sourceType, settledAt, businessDate, "SETTLEMENT", null);
  }

  private void insertCommissionRecord(UUID storeId, UUID orderId, UUID orderLineId, String orderNo, String settlementNo, CommissionBase base, String sourceType, OffsetDateTime settledAt, LocalDate businessDate, String recordType, UUID businessCorrectionId) {
    COMMISSION_LOG.info("insertCommissionRecord entry storeId={} orderId={} orderLineId={} sourceType={} recordType={} base={}", storeId, orderId, orderLineId, sourceType, recordType, base);
    CommissionRule rule = null;
    MonthlyCommissionTierService.TierSnapshot tier = null;
    long baseAmount = 0;
    long fixed = 0;
    int rate = 0;
    long baseCommission = 0;
    long commission = 0;
    short clockAdjustment = base.clockAdjustment();
    try {
      rule = commissionRule(storeId, base, sourceType);
      baseAmount = base.baseAmountCents() == null ? 0 : base.baseAmountCents();
      fixed = rule.fixedCents() == null ? 0 : rule.fixedCents();
      rate = rule.rateBp() == null ? 0 : rule.rateBp();
      COMMISSION_LOG.info("insertCommissionRecord rule type={} fixedCents={} rateBp={} baseAmountCents={} fixedScaleBp={}", rule.ruleType(), fixed, rate, baseAmount, base.fixedScaleBp());
      baseCommission = switch (rule.ruleType()) {
        case "FIXED" -> (fixed * base.fixedScaleBp() + 5000) / 10000;
        case "PERCENT" -> (baseAmount * rate + 5000) / 10000;
        default -> 0;
      };
      COMMISSION_LOG.info("insertCommissionRecord base commission computed ruleType={} baseCommission={}", rule.ruleType(), baseCommission);
      tier = monthlyTiers.resolve(storeId, base.technicianId(), businessDate, base.clockAdjustment());
      commission = (baseCommission * tier.multiplierBp() + 5000) / 10000;
      COMMISSION_LOG.info("insertCommissionRecord final commission={} tier={} multiplierBp={} monthlyClockCount={} clockAdjustment={} durationMinutes={}", commission, tier.tierName(), tier.multiplierBp(), tier.monthlyClockCount(), clockAdjustment, base.durationMinutes());
      int rows = jdbc.sql("insert into technician_commission_record(id,tenant_id,store_id,order_id,order_line_id,service_session_id,service_session_extension_id,service_item_id,technician_id,source_type,clock_type,order_no_snapshot,settlement_no_snapshot,technician_name_snapshot,service_name_snapshot,rule_type,rule_rate_bp,rule_fixed_cents,base_amount_cents,commission_cents,settled_at,business_date,record_type,business_correction_id,clock_count_adjustment,duration_minutes_adjustment,service_participant_id,allocation_bp_snapshot,served_seconds_snapshot,commission_tier_policy_version_id,commission_tier_id,commission_tier_name_snapshot,commission_tier_minimum_clock_count_snapshot,commission_multiplier_bp_snapshot,monthly_clock_count_snapshot) values(:id,:tenant,:store,:order,:line,:session,:extension,:service,:technician,:source,:clockType,:orderNo,:settlementNo,:technicianName,:serviceName,:ruleType,:rate,:fixed,:baseAmount,:commission,:settled,:businessDate,:recordType,:businessCorrection,:clockAdjustment,:durationAdjustment,:participant,:allocation,:servedSeconds,:tierPolicy,:tier,:tierName,:tierMinimum,:tierMultiplier,:monthlyClockCount)")
        .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("order", orderId).param("line", orderLineId)
        .param("session", base.serviceSessionId()).param("extension", base.serviceSessionExtensionId()).param("service", base.serviceItemId()).param("technician", base.technicianId())
        .param("source", sourceType).param("clockType", base.clockType()).param("orderNo", orderNo).param("settlementNo", settlementNo).param("technicianName", base.technicianName()).param("serviceName", base.serviceNameSnapshot())
        .param("ruleType", rule.ruleType()).param("rate", rate).param("fixed", fixed).param("baseAmount", baseAmount).param("commission", commission).param("settled", settledAt).param("businessDate", businessDate).param("recordType", recordType).param("businessCorrection", businessCorrectionId).param("clockAdjustment", clockAdjustment).param("durationAdjustment", base.durationMinutes())
        .param("participant", base.serviceParticipantId()).param("allocation", base.allocationBpSnapshot()).param("servedSeconds", base.servedSecondsSnapshot())
        .param("tierPolicy", tier.policyVersionId()).param("tier", tier.tierId()).param("tierName", tier.tierName()).param("tierMinimum", tier.minimumMonthlyClockCount()).param("tierMultiplier", tier.multiplierBp()).param("monthlyClockCount", tier.monthlyClockCount()).update();
      COMMISSION_LOG.info("insertCommissionRecord exit rows={} orderId={} technicianId={} commission={}", rows, orderId, base.technicianId(), commission);
    } catch (RuntimeException exception) {
      COMMISSION_LOG.error("insertCommissionRecord exception state={storeId=" + storeId + ", orderId=" + orderId + ", orderLineId=" + orderLineId + ", sourceType=" + sourceType + ", recordType=" + recordType + ", base=" + base + ", rule=" + rule + ", baseAmount=" + baseAmount + ", fixed=" + fixed + ", rate=" + rate + ", baseCommission=" + baseCommission + ", tier=" + tier + ", commission=" + commission + "}", exception);
      throw exception;
    }
  }

  private CommissionRule commissionRule(UUID storeId, CommissionBase base, String sourceType) {
    COMMISSION_LOG.debug("commissionRule entry storeId={} serviceItemId={} versionId={} sourceType={} clockType={} businessDate={}", storeId, base.serviceItemId(), base.commissionRuleVersionId(), sourceType, base.clockType(), base.businessDate());
    try {
      CommissionRuleVersion rule = base.commissionRuleVersionId() == null
        ? itemVersions.commissionRule(storeId, base.serviceItemId(), base.businessDate())
        : itemVersions.commissionRule(storeId, base.commissionRuleVersionId());
      if (!rule.active()) {
        COMMISSION_LOG.info("commissionRule inactive versionId={} -> NONE", rule.id());
        return new CommissionRule("NONE", 0L, 0);
      }
      CommissionRule selected;
      String branch;
      if ("EXTENSION".equals(sourceType)) { selected = new CommissionRule(rule.extensionRuleType(), rule.extensionFixedCents(), rule.extensionRateBp()); branch = "EXTENSION"; }
      else if ("CALL".equals(base.clockType()) || "BOOKED_CALL".equals(base.clockType())) { selected = new CommissionRule(rule.callRuleType(), rule.callFixedCents(), rule.callRateBp()); branch = "CALL"; }
      else { selected = new CommissionRule(rule.queueRuleType(), rule.queueFixedCents(), rule.queueRateBp()); branch = "QUEUE"; }
      COMMISSION_LOG.info("commissionRule exit versionId={} branch={} selected={}", rule.id(), branch, selected);
      return selected;
    } catch (RuntimeException exception) {
      COMMISSION_LOG.error("commissionRule exception state={storeId=" + storeId + ", base=" + base + ", sourceType=" + sourceType + "}", exception);
      throw exception;
    }
  }

  private void updateLinkedServiceRoomStates(UUID storeId, List<Line> lines, String orderNo) {
    Set<UUID> roomIds = new HashSet<>();
    for (Line line : lines) {
      if (line.serviceSessionId() == null) continue;
      UUID roomId = jdbc.sql("select room_id from service_session where id=:session and store_id=:store")
        .param("session", line.serviceSessionId()).param("store", storeId).query(UUID.class).optional().orElse(null);
      if (roomId == null) continue;
      roomIds.add(roomId);
    }
    List<UUID> orderedRoomIds = roomIds.stream().sorted().toList();
    lockRoomsForSettlement(storeId, orderedRoomIds);
    for (UUID roomId : orderedRoomIds) {
      boolean hasUnsettledServices = jdbc.sql("select exists(select 1 from service_session session where session.store_id=:store and session.room_id=:room and session.status='COMPLETED' and not exists(select 1 from sales_order_service_session link join sales_order linked_order on linked_order.id=link.order_id where link.service_session_id=session.id and linked_order.status <> 'CANCELLED' and linked_order.refund_status <> 'FULL'))")
        .param("store", storeId).param("room", roomId).query(Boolean.class).single();
      String nextStatus = roomStatusAfterSettlement(hasUnsettledServices);
      String reason = hasUnsettledServices
        ? "Partial payment settled: " + orderNo + "; services remain pending"
        : "Payment settled: " + orderNo + "; awaiting cleaning";
      jdbc.sql("insert into room_status_event(id,tenant_id,store_id,room_id,status,reason,source,occurred_at) values(:id,:tenant,:store,:room,:status,:reason,'ORDER_SETTLEMENT',clock_timestamp())")
        .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("room", roomId)
        .param("status", nextStatus).param("reason", reason).update();
    }
  }

  private void lockRoomsForSettlement(UUID storeId, List<UUID> roomIds) {
    if (roomIds.isEmpty()) return;
    List<UUID> locked = jdbc.sql("select id from room where store_id=:store and id in (:rooms) order by id for update")
      .param("store", storeId).param("rooms", roomIds).query(UUID.class).list();
    if (locked.size() != roomIds.size()) throw bad("Room is unavailable");
  }

  String roomStatusAfterSettlement(boolean hasUnsettledServices) {
    return hasUnsettledServices ? "PENDING_PAYMENT" : "CLEANING";
  }

  private void ensureMember(UUID memberId) {
    boolean exists = jdbc.sql("select exists(select 1 from member where id=:id and tenant_id=:tenant and active=true)")
      .param("id", memberId).param("tenant", TENANT_ID).query(Boolean.class).single();
    if (!exists) throw bad("Member is unavailable");
  }

  /** Historical backfills use the tenant-shared member wallet, just like ordinary settlement. */
  private void ensureHistoricalMember(UUID storeId, UUID memberId) {
    boolean exists = jdbc.sql("select exists(select 1 from member where id=:id and tenant_id=:tenant and active=true)")
      .param("id", memberId).param("tenant", TENANT_ID).query(Boolean.class).single();
    if (!exists) throw bad("会员不存在或已停用");
  }

  private Line line(UUID storeId, LineInput input) {
    if (input.serviceSessionId() != null) {
      ServiceSessionForSettlement session = jdbc.sql("select ss.id,ss.service_item_id,ss.service_name_snapshot,ss.service_price_cents + coalesce((select sum(extension.service_price_cents) from service_session_extension extension where extension.service_session_id=ss.id),0) service_price_cents,ss.planned_duration_minutes,coalesce((select string_agg(extension.service_name_snapshot || ' ' || extension.planned_duration_minutes || '分钟', '、' order by extension.added_at) from service_session_extension extension where extension.service_session_id=ss.id),'') extension_summary,ss.business_date from service_session ss where ss.id=:id and ss.store_id=:store and ss.status='COMPLETED' for update of ss")
        .param("id", input.serviceSessionId()).param("store", storeId).query(ServiceSessionForSettlement.class).optional()
        .orElseThrow(() -> bad("服务不存在、尚未完成或已经作废，请刷新待结算列表"));
      boolean alreadyLinked = jdbc.sql("select exists(select 1 from sales_order_service_session link join sales_order linked_order on linked_order.id=link.order_id where link.service_session_id=:session and linked_order.status <> 'CANCELLED' and linked_order.refund_status <> 'FULL')")
        .param("session", session.id()).query(Boolean.class).single();
      if (alreadyLinked) throw conflict("该服务已经结算，不能重复收款");
      List<SettlementParticipant> participants = jdbc.sql("select id,slot_no,sequence_no,participation_type,allocation_bp,status,replaced_participant_id from service_session_participant where service_session_id=:session and store_id=:store order by slot_no,sequence_no")
        .param("session", session.id()).param("store", storeId).query(SettlementParticipant.class).list();
      validateSettlementParticipants(participants);
      String name = session.extensionSummary().isBlank() ? session.serviceNameSnapshot() : session.serviceNameSnapshot() + "（加钟：" + session.extensionSummary() + "）";
      return new Line(session.serviceItemId(), name, session.servicePriceCents(), session.plannedDurationMinutes(), session.id(), session.businessDate(), null, null, List.of(), null, null, null);
    }
    if (input.serviceItemId() == null) throw bad("请选择服务项目");
    ResolvedServiceItem item = itemVersions.activeItem(storeId, input.serviceItemId(), businessClock.currentBusinessDate(storeId))
      .orElseThrow(() -> bad("该服务项目已删除、停用或尚未生效"));
    short duration = input.durationMinutes() == null ? item.defaultDurationMinutes() : input.durationMinutes();
    if (duration < 15 || duration > 360) throw bad("服务时长必须在 15 到 360 分钟之间");

    // Keep the legacy three-field manual line contract working.  New clients
    // send technician/clock metadata, which is materialized into a completed
    // service session below so all reports use the normal service-session path.
    boolean attributed = input.clockType() != null || input.roomId() != null
      || (input.technicians() != null && !input.technicians().isEmpty());
    if (!attributed) {
      return new Line(item.id(), item.name(), item.priceCents(), duration, null, null, null, null, List.of(), item.priceVersionId(), null, item.countsAsClock());
    }
    List<ManualTechnicianAllocation> allocations = normalizeManualAllocations(storeId, input.technicians());
    String clockType = normalizeClockType(input.clockType());
    if (input.roomId() != null) {
      boolean roomExists = jdbc.sql("""
        select exists(
          select 1 from room room
          where room.id=:room and room.store_id=:store and room.active=true
            and not exists(
              select 1 from service_session active_session
              where active_session.store_id=:store and active_session.room_id=room.id
                and active_session.status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE'))
            and coalesce((select event.status from room_status_event event
                          where event.store_id=:store and event.room_id=room.id
                          order by event.occurred_at desc,event.id desc limit 1),'IDLE')='IDLE')
        """)
        .param("room", input.roomId()).param("store", storeId).query(Boolean.class).single();
      if (!roomExists) throw bad("所选房间不可用、非空闲或不属于当前门店");
    }
    UUID commissionRuleVersionId = itemVersions.commissionRule(storeId, item.id(), businessClock.currentBusinessDate(storeId)).id();
    return new Line(item.id(), item.name(), item.priceCents(), duration, null, null, clockType, input.roomId(), allocations,
      item.priceVersionId(), commissionRuleVersionId, item.countsAsClock());
  }

  private List<ManualTechnicianAllocation> normalizeManualAllocations(UUID storeId, List<ManualTechnicianAllocation> requested) {
    if (requested == null || requested.isEmpty()) throw bad("手工项目必须选择至少一名技师");
    if (requested.size() > 4) throw bad("一个项目最多选择 4 位技师");
    Set<UUID> unique = new HashSet<>();
    List<ManualTechnicianAllocation> resolved = new ArrayList<>();
    boolean missingAllocation = requested.stream().anyMatch(item -> item == null || item.allocationBp() == null);
    int defaultBp = requested.isEmpty() ? 0 : 10000 / requested.size();
    int remainder = requested.isEmpty() ? 0 : 10000 - defaultBp * requested.size();
    for (int index = 0; index < requested.size(); index++) {
      ManualTechnicianAllocation allocation = requested.get(index);
      if (allocation == null || allocation.technicianId() == null || !unique.add(allocation.technicianId())) {
        throw bad("手工项目技师必须有效且不能重复");
      }
      int bp = missingAllocation ? defaultBp + (index == 0 ? remainder : 0) : allocation.allocationBp();
      if (bp < 1 || bp > 10000) throw bad("技师分配比例必须在 1% 到 100% 之间");
      jdbc.sql("select id from technician where id=:id and store_id=:store and active=true")
        .param("id", allocation.technicianId()).param("store", storeId).query(UUID.class).optional()
        .orElseThrow(() -> bad("所选技师已停用或不属于当前门店"));
      resolved.add(new ManualTechnicianAllocation(allocation.technicianId(), bp));
    }
    if (resolved.stream().mapToInt(ManualTechnicianAllocation::allocationBp).sum() != 10000) {
      throw bad("同一项目的技师分配比例必须合计 100%");
    }
    return resolved;
  }

  private Line materializeManualLine(UUID storeId, Line line, OffsetDateTime settledAt, LocalDate businessDate) {
    if (line.technicians() == null || line.technicians().isEmpty()) return line;
    UUID sessionId = UUID.randomUUID();
    OffsetDateTime startedAt = settledAt.minusMinutes(line.durationMinutes());
    jdbc.sql("insert into service_session(id,tenant_id,store_id,technician_id,room_id,bed_id,service_item_id,service_name_snapshot,service_price_cents,planned_duration_minutes,started_at,expected_end_at,ended_at,status,note,clock_type,price_version_id,commission_rule_version_id,counts_as_clock_snapshot,business_date) values(:id,:tenant,:store,:technician,:room,null,:service,:name,:price,:duration,:started,:expected,:ended,'COMPLETED',:note,:clockType,:priceVersion,:commissionVersion,:countsAsClock,:businessDate)")
      .param("id", sessionId).param("tenant", TENANT_ID).param("store", storeId)
      .param("technician", line.technicians().getFirst().technicianId()).param("room", line.roomId())
      .param("service", line.serviceItemId()).param("name", line.name()).param("price", line.priceCents())
      .param("duration", line.durationMinutes()).param("started", startedAt).param("expected", settledAt)
      .param("ended", settledAt).param("note", "手工添加项目").param("clockType", line.clockType())
      .param("priceVersion", line.priceVersionId()).param("commissionVersion", line.commissionRuleVersionId())
      .param("countsAsClock", line.countsAsClock()).param("businessDate", businessDate).update();
    for (int index = 0; index < line.technicians().size(); index++) {
      ManualTechnicianAllocation allocation = line.technicians().get(index);
      jdbc.sql("insert into service_session_participant(id,tenant_id,store_id,service_session_id,technician_id,slot_no,sequence_no,participation_type,allocation_bp,status,joined_at,accepted_at,service_started_at,service_ended_at) values(:id,:tenant,:store,:session,:technician,:slot,1,:type,:allocation,'COMPLETED',:started,:started,:started,:ended)")
        .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("session", sessionId)
        .param("technician", allocation.technicianId()).param("slot", index + 1)
        .param("type", index == 0 ? "PRIMARY" : "ADDITIONAL").param("allocation", allocation.allocationBp())
        .param("started", startedAt).param("ended", settledAt).update();
    }
    return new Line(line.serviceItemId(), line.name(), line.priceCents(), line.durationMinutes(), sessionId, businessDate,
      line.clockType(), line.roomId(), line.technicians(), line.priceVersionId(), line.commissionRuleVersionId(), line.countsAsClock());
  }

  void validateSettlementParticipants(List<SettlementParticipant> participants) {
    Map<Short, List<SettlementParticipant>> slots = new LinkedHashMap<>();
    for (SettlementParticipant participant : participants) slots.computeIfAbsent(participant.slotNo(), ignored -> new ArrayList<>()).add(participant);
    if (slots.isEmpty()) throw conflict("服务技师记录缺失，请先作废未结算服务并重新开钟");

    int allocationTotal = 0;
    boolean hasCompletedParticipant = false;
    for (List<SettlementParticipant> slot : slots.values()) {
      SettlementParticipant previous = null;
      SettlementParticipant current = null;
      for (SettlementParticipant participant : slot) {
        if (previous == null) {
          if (participant.sequenceNo() != 1 || "REPLACEMENT".equals(participant.participationType())) {
            throw conflict("服务技师记录异常，请先作废未结算服务并重新开钟");
          }
        } else if (!"REPLACEMENT".equals(participant.participationType()) || !previous.id().equals(participant.replacedParticipantId())) {
          throw conflict("服务技师记录异常，请先作废未结算服务并重新开钟");
        }
        previous = participant;
        if ("COMPLETED".equals(participant.status())) hasCompletedParticipant = true;
        if (!Set.of("REJECTED", "EXPIRED", "VOIDED", "CANCELLED").contains(participant.status())) current = participant;
      }
      if (current == null || !"COMPLETED".equals(current.status())) {
        throw conflict("服务技师记录未完成或状态异常，请刷新待结算列表");
      }
      allocationTotal += current.allocationBp();
    }
    if (!hasCompletedParticipant || allocationTotal != 10000) {
      throw conflict("服务技师分配异常，请先作废未结算服务并重新开钟");
    }
  }

  private void validateCorrectionServiceSessions(UUID storeId, UUID sourceOrderId, List<Line> lines) {
    Set<UUID> sourceSessions = new HashSet<>(jdbc.sql("select link.service_session_id from sales_order_service_session link where link.order_id=:order and link.store_id=:store")
      .param("order", sourceOrderId).param("store", storeId).query(UUID.class).list());
    Set<UUID> correctionSessions = new HashSet<>();
    for (Line line : lines) if (line.serviceSessionId() != null) correctionSessions.add(line.serviceSessionId());
    if (sourceSessions.equals(correctionSessions)) return;
    if (sourceSessions.containsAll(correctionSessions)) throw conflict("重新结算必须包含原订单的全部服务记录");
    throw conflict("重新结算只能使用原订单对应的服务记录");
  }

  private void linkServiceSession(UUID storeId, UUID orderId, UUID orderLineId, UUID serviceSessionId) {
    boolean alreadyLinked = jdbc.sql("select exists(select 1 from sales_order_service_session link join sales_order linked_order on linked_order.id=link.order_id where link.service_session_id=:session and linked_order.status <> 'CANCELLED' and linked_order.refund_status <> 'FULL')")
      .param("session", serviceSessionId).query(Boolean.class).single();
    if (alreadyLinked) throw conflict("该服务已经在有效订单中结算");
    try {
      jdbc.sql("insert into sales_order_service_session(id,tenant_id,store_id,order_id,order_line_id,service_session_id) values(:id,:tenant,:store,:order,:line,:session)")
        .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("order", orderId).param("line", orderLineId).param("session", serviceSessionId).update();
    } catch (DuplicateKeyException exception) {
      throw conflict("该服务关联冲突，请刷新后重试");
    }
  }

  private void reverseCurrentCommissionsForBusinessCorrection(UUID orderId, UUID orderLineId, UUID correctionId, OffsetDateTime correctedAt, LocalDate businessDate) {
    COMMISSION_LOG.info("businessCorrection.reverseCommissions entry orderId={} orderLineId={} correctionId={} correctedAt={} businessDate={}", orderId, orderLineId, correctionId, correctedAt, businessDate);
    List<VoidCommission> originals = null;
    int inserted = 0;
    try {
      originals = jdbc.sql("select record.id,record.tenant_id,record.store_id,record.order_id,record.order_line_id,record.service_session_id,record.service_session_extension_id,record.service_item_id,record.technician_id,record.source_type,record.clock_type,record.order_no_snapshot,record.technician_name_snapshot,record.service_name_snapshot,record.rule_type,record.rule_rate_bp,record.rule_fixed_cents,record.base_amount_cents,record.commission_cents,record.clock_count_adjustment,record.duration_minutes_adjustment,record.service_participant_id,record.allocation_bp_snapshot,record.served_seconds_snapshot,record.commission_tier_policy_version_id,record.commission_tier_id,record.commission_tier_name_snapshot,record.commission_tier_minimum_clock_count_snapshot,record.commission_multiplier_bp_snapshot,record.monthly_clock_count_snapshot from technician_commission_record record where record.order_id=:order and record.order_line_id=:line and record.record_type in ('SETTLEMENT','BUSINESS_CORRECTION') and not exists(select 1 from technician_commission_record reversal where reversal.original_commission_record_id=record.id and reversal.record_type='BUSINESS_CORRECTION_REVERSAL') order by record.created_at,record.id")
        .param("order", orderId).param("line", orderLineId).query(VoidCommission.class).list();
      COMMISSION_LOG.info("businessCorrection.reverseCommissions originals count={} values={}", originals.size(), originals);
      if (originals.isEmpty()) throw conflict("订单当前提成记录不存在，请先核对订单数据");
      for (VoidCommission original : originals) {
        long baseReversal = -original.baseAmountCents();
        long commissionReversal = -original.commissionCents();
        short clockReversal = (short) -original.clockCountAdjustment();
        short durationReversal = (short) -original.durationMinutesAdjustment();
        int rows = jdbc.sql("insert into technician_commission_record(id,tenant_id,store_id,order_id,order_line_id,service_session_id,service_session_extension_id,service_item_id,technician_id,source_type,clock_type,order_no_snapshot,settlement_no_snapshot,technician_name_snapshot,service_name_snapshot,rule_type,rule_rate_bp,rule_fixed_cents,base_amount_cents,commission_cents,settled_at,business_date,record_type,business_correction_id,original_commission_record_id,clock_count_adjustment,duration_minutes_adjustment,service_participant_id,allocation_bp_snapshot,served_seconds_snapshot,commission_tier_policy_version_id,commission_tier_id,commission_tier_name_snapshot,commission_tier_minimum_clock_count_snapshot,commission_multiplier_bp_snapshot,monthly_clock_count_snapshot) values(:id,:tenant,:store,:order,:line,:session,:extension,:service,:technician,:source,:clockType,:orderNo,:correctionNo,:technicianName,:serviceName,:ruleType,:rate,:fixed,:base,:commission,:settled,:businessDate,'BUSINESS_CORRECTION_REVERSAL',:businessCorrection,:original,:clock,:duration,:participant,:allocation,:servedSeconds,:tierPolicy,:tier,:tierName,:tierMinimum,:tierMultiplier,:monthlyClockCount)")
          .param("id", UUID.randomUUID()).param("tenant", original.tenantId()).param("store", original.storeId()).param("order", original.orderId()).param("line", original.orderLineId())
          .param("session", original.serviceSessionId()).param("extension", original.serviceSessionExtensionId()).param("service", original.serviceItemId()).param("technician", original.technicianId())
          .param("source", original.sourceType()).param("clockType", original.clockType()).param("orderNo", original.orderNoSnapshot()).param("correctionNo", "业务更正")
          .param("technicianName", original.technicianNameSnapshot()).param("serviceName", original.serviceNameSnapshot()).param("ruleType", original.ruleType()).param("rate", original.ruleRateBp()).param("fixed", original.ruleFixedCents())
          .param("base", baseReversal).param("commission", commissionReversal).param("settled", correctedAt).param("businessDate", businessDate).param("businessCorrection", correctionId).param("original", original.id())
          .param("clock", clockReversal).param("duration", durationReversal).param("participant", original.serviceParticipantId()).param("allocation", original.allocationBpSnapshot()).param("servedSeconds", original.servedSecondsSnapshot())
          .param("tierPolicy", original.commissionTierPolicyVersionId()).param("tier", original.commissionTierId()).param("tierName", original.commissionTierNameSnapshot()).param("tierMinimum", original.commissionTierMinimumClockCountSnapshot()).param("tierMultiplier", original.commissionMultiplierBpSnapshot()).param("monthlyClockCount", original.monthlyClockCountSnapshot()).update();
        inserted += rows;
        COMMISSION_LOG.info("businessCorrection.reverseCommissions reversal originalId={} rows={} base={} commission={} clock={} duration={}", original.id(), rows, baseReversal, commissionReversal, clockReversal, durationReversal);
      }
      COMMISSION_LOG.info("businessCorrection.reverseCommissions exit originalCount={} insertedRows={}", originals.size(), inserted);
    } catch (RuntimeException exception) {
      COMMISSION_LOG.error("businessCorrection.reverseCommissions exception state={orderId=" + orderId + ", orderLineId=" + orderLineId + ", correctionId=" + correctionId + ", correctedAt=" + correctedAt + ", businessDate=" + businessDate + ", originals=" + originals + ", inserted=" + inserted + "}", exception);
      throw exception;
    }
  }

  private void reverseCommissionsForVoid(UUID orderId, String orderNo, OffsetDateTime reversedAt, LocalDate businessDate) {
    COMMISSION_LOG.info("orderVoid.reverseCommissions entry orderId={} orderNo={} reversedAt={} businessDate={}", orderId, orderNo, reversedAt, businessDate);
    List<VoidCommission> originals = null;
    int inserted = 0;
    try {
      originals = jdbc.sql("select record.id,record.tenant_id,record.store_id,record.order_id,record.order_line_id,record.service_session_id,record.service_session_extension_id,record.service_item_id,record.technician_id,record.source_type,record.clock_type,record.order_no_snapshot,record.technician_name_snapshot,record.service_name_snapshot,record.rule_type,record.rule_rate_bp,record.rule_fixed_cents,record.base_amount_cents,record.commission_cents,record.clock_count_adjustment,record.duration_minutes_adjustment,record.service_participant_id,record.allocation_bp_snapshot,record.served_seconds_snapshot,record.commission_tier_policy_version_id,record.commission_tier_id,record.commission_tier_name_snapshot,record.commission_tier_minimum_clock_count_snapshot,record.commission_multiplier_bp_snapshot,record.monthly_clock_count_snapshot from technician_commission_record record where record.order_id=:order and record.record_type in ('SETTLEMENT','BUSINESS_CORRECTION') and not exists(select 1 from technician_commission_record correction_reversal where correction_reversal.original_commission_record_id=record.id and correction_reversal.record_type='BUSINESS_CORRECTION_REVERSAL') order by record.created_at,record.id")
        .param("order", orderId).query(VoidCommission.class).list();
      COMMISSION_LOG.info("orderVoid.reverseCommissions originals count={} values={}", originals.size(), originals);
      for (VoidCommission original : originals) {
        long baseReversal = -original.baseAmountCents();
        long commissionReversal = -original.commissionCents();
        short clockReversal = (short) -original.clockCountAdjustment();
        short durationReversal = (short) -original.durationMinutesAdjustment();
        int rows = jdbc.sql("insert into technician_commission_record(id,tenant_id,store_id,order_id,order_line_id,service_session_id,service_session_extension_id,service_item_id,technician_id,source_type,clock_type,order_no_snapshot,settlement_no_snapshot,technician_name_snapshot,service_name_snapshot,rule_type,rule_rate_bp,rule_fixed_cents,base_amount_cents,commission_cents,settled_at,business_date,record_type,refund_id,original_commission_record_id,clock_count_adjustment,duration_minutes_adjustment,service_participant_id,allocation_bp_snapshot,served_seconds_snapshot,commission_tier_policy_version_id,commission_tier_id,commission_tier_name_snapshot,commission_tier_minimum_clock_count_snapshot,commission_multiplier_bp_snapshot,monthly_clock_count_snapshot) values(:id,:tenant,:store,:order,:line,:session,:extension,:service,:technician,:source,:clockType,:orderNo,:voidNo,:technicianName,:serviceName,:ruleType,:rate,:fixed,:base,:commission,:settled,:businessDate,'ORDER_VOID_REVERSAL',null,:original,:clock,:duration,:participant,:allocation,:servedSeconds,:tierPolicy,:tier,:tierName,:tierMinimum,:tierMultiplier,:monthlyClockCount) on conflict do nothing")
          .param("id", UUID.randomUUID()).param("tenant", original.tenantId()).param("store", original.storeId()).param("order", original.orderId()).param("line", original.orderLineId())
          .param("session", original.serviceSessionId()).param("extension", original.serviceSessionExtensionId()).param("service", original.serviceItemId()).param("technician", original.technicianId())
          .param("source", original.sourceType()).param("clockType", original.clockType()).param("orderNo", original.orderNoSnapshot()).param("voidNo", "VOID-" + orderNo)
          .param("technicianName", original.technicianNameSnapshot()).param("serviceName", original.serviceNameSnapshot()).param("ruleType", original.ruleType()).param("rate", original.ruleRateBp()).param("fixed", original.ruleFixedCents())
          .param("base", baseReversal).param("commission", commissionReversal).param("settled", reversedAt).param("businessDate", businessDate).param("original", original.id())
          .param("clock", clockReversal).param("duration", durationReversal).param("participant", original.serviceParticipantId()).param("allocation", original.allocationBpSnapshot()).param("servedSeconds", original.servedSecondsSnapshot())
          .param("tierPolicy", original.commissionTierPolicyVersionId()).param("tier", original.commissionTierId()).param("tierName", original.commissionTierNameSnapshot()).param("tierMinimum", original.commissionTierMinimumClockCountSnapshot()).param("tierMultiplier", original.commissionMultiplierBpSnapshot()).param("monthlyClockCount", original.monthlyClockCountSnapshot()).update();
        inserted += rows;
        COMMISSION_LOG.info("orderVoid.reverseCommissions reversal originalId={} rows={} base={} commission={} clock={} duration={}", original.id(), rows, baseReversal, commissionReversal, clockReversal, durationReversal);
      }
      COMMISSION_LOG.info("orderVoid.reverseCommissions exit originalCount={} insertedRows={}", originals.size(), inserted);
    } catch (RuntimeException exception) {
      COMMISSION_LOG.error("orderVoid.reverseCommissions exception state={orderId=" + orderId + ", orderNo=" + orderNo + ", reversedAt=" + reversedAt + ", businessDate=" + businessDate + ", originals=" + originals + ", inserted=" + inserted + "}", exception);
      throw exception;
    }
  }

  private void consumeWallet(UUID transactionStoreId, UUID memberId, long amount, UUID orderId, LocalDate businessDate) {
    if (memberId == null) throw bad("使用会员余额付款时必须先选择会员");
    Wallet wallet = jdbc.sql("select w.id,w.balance_cents from member_wallet w join member m on m.id=w.member_id where w.member_id=:member and m.tenant_id=:tenant for update")
      .param("member", memberId).param("tenant", TENANT_ID).query(Wallet.class).single();
    if (wallet.balanceCents() < amount) throw new ResponseStatusException(HttpStatus.CONFLICT, "会员余额不足，请调整付款方式或充值");
    long after = wallet.balanceCents() - amount;
    jdbc.sql("update member_wallet set balance_cents=:balance,updated_at=now(),version=version+1 where id=:id")
      .param("balance", after).param("id", wallet.id()).update();
    jdbc.sql("insert into wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,note,business_date) values(:id,:tenant,:store,:wallet,:member,'CONSUMPTION',:amount,:before,:after,'ORDER',:note,:businessDate)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", transactionStoreId).param("wallet", wallet.id()).param("member", memberId)
      .param("amount", -amount).param("before", wallet.balanceCents()).param("after", after).param("note", orderId.toString()).param("businessDate", businessDate).update();
  }

  private void consumeHistoricalWallet(UUID transactionStoreId, UUID memberId, long amount, UUID orderId, LocalDate businessDate) {
    if (memberId == null) throw bad("使用会员余额付款时必须先选择会员");
    Wallet wallet = jdbc.sql("select w.id,w.balance_cents from member_wallet w join member m on m.id=w.member_id where w.member_id=:member and m.tenant_id=:tenant and m.active=true and w.tenant_id=:tenant for update")
      .param("member", memberId).param("tenant", TENANT_ID).query(Wallet.class).optional()
      .orElseThrow(() -> bad("会员钱包不存在"));
    if (wallet.balanceCents() < amount) throw new ResponseStatusException(HttpStatus.CONFLICT, "会员余额不足，请调整付款方式或充值");
    long after = wallet.balanceCents() - amount;
    jdbc.sql("update member_wallet set balance_cents=:balance,updated_at=now(),version=version+1 where id=:id")
      .param("balance", after).param("id", wallet.id()).update();
    jdbc.sql("insert into wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,note,business_date) values(:id,:tenant,:store,:wallet,:member,'CONSUMPTION',:amount,:before,:after,'ORDER',:note,:businessDate)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", transactionStoreId).param("wallet", wallet.id()).param("member", memberId)
      .param("amount", -amount).param("before", wallet.balanceCents()).param("after", after).param("note", orderId.toString()).param("businessDate", businessDate).update();
  }

  private PaymentMethod paymentMethod(UUID storeId, String code) {
    return jdbc.sql("select code,name,method_kind from store_payment_method where store_id=:store and code=:code and active=true")
      .param("store", storeId).param("code", code).query(PaymentMethod.class).optional()
      .orElseThrow(() -> bad("所选收款方式已停用或不属于当前门店"));
  }

  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }

  private String normalizeClockType(String value) {
    String normalized = value == null || value.isBlank() ? "QUEUE" : value.trim().toUpperCase(java.util.Locale.ROOT);
    if (Set.of("QUEUE", "CALL", "SELECTED", "BOOKED_QUEUE", "BOOKED_CALL").contains(normalized)) return normalized;
    throw bad("钟类不受支持");
  }

  record Item(UUID id, String name, Integer priceCents, Short defaultDurationMinutes) {}
  record Line(UUID serviceItemId, String name, Integer priceCents, Short durationMinutes, UUID serviceSessionId, LocalDate businessDate,
              String clockType, UUID roomId, List<ManualTechnicianAllocation> technicians, UUID priceVersionId,
              UUID commissionRuleVersionId, Boolean countsAsClock) {
    Line(UUID serviceItemId, String name, Integer priceCents, Short durationMinutes, UUID serviceSessionId, LocalDate businessDate) {
      this(serviceItemId, name, priceCents, durationMinutes, serviceSessionId, businessDate, null, null, List.of(), null, null, null);
    }
  }
  record ServiceSessionForSettlement(UUID id, UUID serviceItemId, String serviceNameSnapshot, Integer servicePriceCents, Short plannedDurationMinutes, String extensionSummary, LocalDate businessDate) {}
  record Wallet(UUID id, Long balanceCents) {}
  record Order(UUID id, String orderNo, Long receivableCents, Long paidCents, String status, OffsetDateTime settledAt) {}
  record ExistingSessionOrder(UUID serviceSessionId, UUID id, String orderNo, Long receivableCents, Long paidCents, String status, OffsetDateTime settledAt) {}
  record OrderSummary(UUID id, String orderNo, String settlementNo, String cashierNameSnapshot, String status, String refundStatus, Long receivableCents, Long paidCents, OffsetDateTime createdAt, OffsetDateTime settledAt, String cancelReason, OffsetDateTime cancelledAt, UUID memberId, String memberName, String memberPhone, Long memberBalanceCents, UUID correctedFromOrderId, String correctedFromOrderNo, String correctionReason, Integer financialCorrectionVersion, Integer businessCorrectionVersion, Boolean historicalBackfill, LocalDate backfillDate, UUID backfillBy, OffsetDateTime backfillAt, String backfillByName) {}
  record OrderVoidState(String status, Long paidCents, String orderNo, Long paymentCount, Long commissionCount, Long refundCount) {}
  record OrderLine(UUID id, UUID serviceItemId, String itemNameSnapshot, Long unitPriceCents, Short durationMinutes, Short quantity, Long lineAmountCents,
                   UUID serviceSessionId, UUID technicianId, String technicianName, String roomCode, String roomName, OffsetDateTime serviceEndedAt, String clockType, Long participantCount) {}
  record Payment(UUID id, String paymentMethod, String paymentMethodNameSnapshot, Long amountCents, OffsetDateTime createdAt) {}
  record FinancialCorrectionOrder(UUID id, UUID memberId, String orderNo, String status, String refundStatus, Long paidCents, Integer financialCorrectionVersion, LocalDate businessDate) {}
  record ResolvedCorrectionPayment(String code, String name, String methodKind, Long amountCents) {}
  record FinancialCorrectionInput(@NotNull @Min(0) Long settlementAmountCents, @NotNull List<@Valid PaymentInput> payments,
                                  @NotBlank @Size(max = 240) String reason, @NotNull @Min(0) Integer expectedVersion) {}
  record FinancialCorrectionResult(UUID orderId, String orderNo, Integer version, Long oldPaidCents, Long newPaidCents, Long memberBalanceDeltaCents, String reason) {}
  record BusinessCorrectionInput(@NotNull UUID orderLineId, @NotNull UUID technicianId, @NotBlank String clockType,
                                 @NotBlank @Size(max = 240) String reason, @NotNull @Min(0) Integer expectedVersion) {}
  record BusinessCorrectionState(UUID orderId, String orderNo, String settlementNo, String status, String refundStatus, LocalDate businessDate, Integer businessCorrectionVersion,
                                 UUID orderLineId, UUID serviceSessionId, UUID oldTechnicianId, String oldTechnicianName, String oldClockType, String sessionStatus, Long participantCount, Long foreignExtensionCount) {}
  record BusinessCorrectionResult(UUID orderId, UUID orderLineId, Integer version, UUID oldTechnicianId, String oldTechnicianName, UUID newTechnicianId, String newTechnicianName, String oldClockType, String newClockType, String reason) {}
  record BusinessCorrectionView(UUID id, UUID orderId, UUID orderLineId, UUID serviceSessionId, Integer version,
                                UUID oldTechnicianId, String oldTechnicianName, UUID newTechnicianId, String newTechnicianName,
                                String oldClockType, String newClockType, Long oldBaseAmountCents, Long oldCommissionCents,
                                Long newBaseAmountCents, Long newCommissionCents, String reason, String correctedByNameSnapshot,
                                OffsetDateTime correctedAt) {}
  record TechnicianSnapshot(UUID id, String name) {}
  record PaymentMethod(String code, String name, String methodKind) {}
  record CommissionBase(UUID serviceSessionId, UUID serviceSessionExtensionId, UUID serviceItemId, UUID technicianId, String technicianName, String serviceNameSnapshot, Integer baseAmountCents, String clockType, UUID commissionRuleVersionId, LocalDate businessDate, Boolean countsAsClockSnapshot, Short durationMinutes, UUID serviceParticipantId, Integer allocationBpSnapshot, Integer servedSecondsSnapshot, Short clockAdjustment, Integer fixedScaleBp) {}
  record ParticipantCommissionBase(UUID serviceParticipantId, UUID serviceSessionId, UUID serviceItemId, UUID technicianId, String technicianName, String serviceNameSnapshot, Integer servicePriceCents, String clockType, UUID commissionRuleVersionId, LocalDate businessDate, Boolean countsAsClockSnapshot, Short plannedDurationMinutes, Short slotNo, Short sequenceNo, Integer allocationBp, Integer servedSeconds) {}
  record SettlementParticipant(UUID id, Short slotNo, Short sequenceNo, String participationType, Integer allocationBp, String status, UUID replacedParticipantId) {}
  record CommissionRule(String ruleType, Long fixedCents, Integer rateBp) {}
  record OrderDetail(OrderSummary order, List<OrderLine> lines, List<Payment> payments, List<BusinessCorrectionView> businessCorrections) {}
  record HistoricalBackfillResult(UUID orderId, String orderNo, String settlementNo, LocalDate backfillDate,
                                  Long receivableCents, Long paidCents, UUID backfillBy, String backfillByName) {}
  record MyHistoricalBackfillRecord(UUID orderId, String orderNo, String settlementNo, LocalDate backfillDate,
                                    Long receivableCents, Long paidCents, String paymentMethods,
                                    UUID backfillBy, String backfillByName, OffsetDateTime backfillAt,
                                    String status, String refundStatus) {}
  record ResolvedHistoricalLine(ResolvedServiceItem item, Short durationMinutes, String clockType,
                                List<HistoricalTechnicianAllocation> allocations, UUID roomId) {}
  record PendingServiceSession(UUID id, String serviceNo, UUID serviceItemId, String serviceNameSnapshot, Integer servicePriceCents, Short plannedDurationMinutes, OffsetDateTime endedAt, LocalDate businessDate, String technicianName, UUID roomId, String roomCode, String clockType, String extensionSummary) {}
  record SettleInput(UUID memberId, @NotEmpty List<@Valid LineInput> lines, @NotNull List<@Valid PaymentInput> payments,
                     Long settlementAmountCents, String waiveReason, UUID correctedFromOrderId, @Size(max = 240) String correctionReason) {}
  record CorrectionSource(UUID id, String orderNo, String status, String refundStatus) {}
  record VoidCommission(UUID id, UUID tenantId, UUID storeId, UUID orderId, UUID orderLineId, UUID serviceSessionId, UUID serviceSessionExtensionId, UUID serviceItemId, UUID technicianId, String sourceType, String clockType, String orderNoSnapshot, String technicianNameSnapshot, String serviceNameSnapshot, String ruleType, Integer ruleRateBp, Long ruleFixedCents, Long baseAmountCents, Long commissionCents, Short clockCountAdjustment, Short durationMinutesAdjustment, UUID serviceParticipantId, Integer allocationBpSnapshot, Integer servedSecondsSnapshot, UUID commissionTierPolicyVersionId, UUID commissionTierId, String commissionTierNameSnapshot, Integer commissionTierMinimumClockCountSnapshot, Integer commissionMultiplierBpSnapshot, Integer monthlyClockCountSnapshot) {}
  record VoidInput(@NotBlank String reason) {}
  record LineInput(UUID serviceItemId, UUID serviceSessionId, Short durationMinutes, String clockType, UUID roomId,
                   List<@Valid ManualTechnicianAllocation> technicians) {
    LineInput(UUID serviceItemId, UUID serviceSessionId, Short durationMinutes) {
      this(serviceItemId, serviceSessionId, durationMinutes, null, null, null);
    }
  }
  record ManualTechnicianAllocation(@NotNull UUID technicianId, @Min(1) @Max(10000) Integer allocationBp) {}
  record PaymentInput(@NotBlank String method, @NotNull @Min(1) Long amountCents) {}
  record HistoricalBackfillInput(@NotNull LocalDate backfillDate, UUID memberId,
                                 @NotEmpty List<@Valid HistoricalBackfillLineInput> lines,
                                 @NotNull List<@Valid PaymentInput> payments,
                                 @NotNull @Min(1) Long settlementAmountCents,
                                 @NotNull Boolean confirmed) {}
  record HistoricalBackfillLineInput(@NotNull UUID serviceItemId,
                                     List<@Valid HistoricalTechnicianAllocation> technicians,
                                     UUID technicianId, Integer allocationBp,
                                     @Min(15) @Max(360) Short durationMinutes,
                                     String clockType, UUID roomId) {}
  record HistoricalTechnicianAllocation(UUID technicianId, Integer allocationBp, String technicianName) {
    HistoricalTechnicianAllocation(UUID technicianId, Integer allocationBp) {
      this(technicianId, allocationBp, null);
    }
  }
}
