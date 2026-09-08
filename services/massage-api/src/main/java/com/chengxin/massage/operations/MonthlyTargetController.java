package com.chengxin.massage.operations;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Keeps store, project, and technician monthly revenue targets on the same business-month boundary. */
@RestController
@RequestMapping("/api/v1/monthly-targets")
@CrossOrigin(origins = "*")
public class MonthlyTargetController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final String EFFECTIVE_COMMISSION_CTE = """
    WITH adjustment_totals AS (
      SELECT original_commission_record_id original_id,
             COALESCE(SUM(base_amount_cents),0) base_delta,
             COALESCE(SUM(commission_cents),0) commission_delta,
             COALESCE(SUM(clock_count_adjustment),0) clock_delta,
             COALESCE(SUM(duration_minutes_adjustment),0) duration_delta
      FROM technician_commission_record
      WHERE record_type IN ('REFUND_REVERSAL','ORDER_VOID_REVERSAL','BUSINESS_CORRECTION_REVERSAL')
      GROUP BY original_commission_record_id
    ), effective_records AS (
      SELECT base.store_id,base.business_date,base.technician_id,
             GREATEST(0,base.base_amount_cents+COALESCE(adjustment.base_delta,0)) effective_base_amount_cents,
             GREATEST(0,base.commission_cents+COALESCE(adjustment.commission_delta,0)) effective_commission_cents,
             (base.clock_count_adjustment+COALESCE(adjustment.clock_delta,0))::smallint effective_clock_count_adjustment,
             (base.duration_minutes_adjustment+COALESCE(adjustment.duration_delta,0))::smallint effective_duration_minutes_adjustment
      FROM technician_commission_record base
      LEFT JOIN adjustment_totals adjustment ON adjustment.original_id=base.id
      WHERE base.record_type IN ('SETTLEMENT','BUSINESS_CORRECTION')
    )
    """;
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final AuditService audits;

  MonthlyTargetController(JdbcClient jdbc, StoreContextService storeContext, AdminSessionService adminSessions, AuditService audits) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.audits = audits;
  }

  @GetMapping
  TargetPlanView get(@RequestParam(defaultValue = "") String month,
                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    requireView(authorization);
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return view(storeId, parseMonth(month), canConfigure(authorization));
  }

  @PutMapping
  @Transactional
  TargetPlanView save(@RequestBody TargetPlanInput input,
                      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    adminSessions.requirePermission(authorization, "DAILY_REPORT_CONFIG");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    UUID actor = adminSessions.requireAuthenticatedUserId(authorization);
    LocalDate month = parseMonth(input.targetMonth());
    long storeTarget = requireAmount(input.storeTargetCents(), "Store target");
    List<TargetAllocationInput> projects = input.projects() == null ? List.of() : input.projects();
    List<TargetAllocationInput> technicians = input.technicians() == null ? List.of() : input.technicians();
    validateAllocations(storeId, projects, "PROJECT", storeTarget);
    validateAllocations(storeId, technicians, "TECHNICIAN", storeTarget);
    TargetPlanView before = view(storeId, month, true);

    jdbc.sql("insert into daily_report_month_target(id,tenant_id,store_id,target_month,monthly_target_cents,updated_by_user_id) values(:id,:tenant,:store,:month,:target,:actor) on conflict(store_id,target_month) do update set monthly_target_cents=excluded.monthly_target_cents,updated_by_user_id=excluded.updated_by_user_id,updated_at=now(),version=daily_report_month_target.version+1")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("month", month).param("target", storeTarget).param("actor", actor).update();
    jdbc.sql("delete from monthly_target_allocation where store_id=:store and target_month=:month")
      .param("store", storeId).param("month", month).update();
    insertAllocations(storeId, month, actor, projects, "PROJECT");
    insertAllocations(storeId, month, actor, technicians, "TECHNICIAN");

    TargetPlanView saved = view(storeId, month, true);
    audits.record(authorization, storeId, "MONTHLY_TARGET", "MONTHLY_TARGET_PLAN_UPDATED", "monthly_target_allocation", storeId,
      "Monthly target plan updated", before, saved);
    return saved;
  }

  private void insertAllocations(UUID storeId, LocalDate month, UUID actor, List<TargetAllocationInput> inputs, String type) {
    for (TargetAllocationInput input : inputs) {
      long target = requireAmount(input.targetCents(), type + " target");
      if (target == 0) continue;
      String itemColumn = "PROJECT".equals(type) ? "service_item_id" : "technician_id";
      jdbc.sql("insert into monthly_target_allocation(id,tenant_id,store_id,target_month,allocation_type," + itemColumn + ",target_cents,updated_by_user_id) values(:id,:tenant,:store,:month,:type,:item,:target,:actor)")
        .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("month", month).param("type", type)
        .param("item", input.id()).param("target", target).param("actor", actor).update();
    }
  }

  private void validateAllocations(UUID storeId, List<TargetAllocationInput> inputs, String type, long storeTarget) {
    Set<UUID> seen = new HashSet<>();
    long total = 0;
    for (TargetAllocationInput input : inputs) {
      if (input == null || input.id() == null || !seen.add(input.id())) throw bad("Each " + type + " can only appear once");
      total = Math.addExact(total, requireAmount(input.targetCents(), type + " target"));
    }
    if (total > storeTarget) throw bad(type + " target allocation cannot exceed the store target");
    if (inputs.isEmpty()) return;
    String table = "PROJECT".equals(type) ? "service_item" : "technician";
    long active = jdbc.sql("select count(*) from " + table + " where store_id=:store and active=true and id = any(cast(:ids as uuid[]))")
      .param("store", storeId).param("ids", inputs.stream().map(TargetAllocationInput::id).toArray(UUID[]::new)).query(Long.class).single();
    if (active != inputs.size()) throw bad("Target allocation contains an unavailable " + type.toLowerCase());
  }

  private TargetPlanView view(UUID storeId, LocalDate month, boolean canConfigure) {
    long storeTarget = jdbc.sql("select coalesce(monthly_target_cents,0) from daily_report_month_target where store_id=:store and target_month=:month")
      .param("store", storeId).param("month", month).query(Long.class).optional().orElse(0L);
    long storeActual = jdbc.sql("select coalesce(sum(greatest(0,sales.paid_cents-coalesce(order_refund.refunded_cents,0))),0) from sales_order sales left join lateral (select coalesce(sum(refund.total_cents),0) refunded_cents from sales_refund refund where refund.order_id=sales.id and refund.status='COMPLETED') order_refund on true where sales.store_id=:store and sales.status='SETTLED' and sales.business_date between :from and :to")
      .param("store", storeId).param("from", month).param("to", month.plusMonths(1).minusDays(1)).query(Long.class).single();
    List<ProjectTargetRow> projects = jdbc.sql("""
      select item.id project_id,item.code project_code,item.name project_name,item.category,
        coalesce(plan.target_cents,0) target_cents,coalesce(actual.amount_cents,0) actual_cents
      from service_item item
      left join monthly_target_allocation plan on plan.service_item_id=item.id and plan.store_id=:store and plan.target_month=:month and plan.allocation_type='PROJECT'
      left join (
        select line.service_item_id,sum(greatest(0,line.line_amount_cents-coalesce(refund_totals.refunded_cents,0))) amount_cents
        from sales_order sales join sales_order_line line on line.order_id=sales.id
        left join lateral (
          select coalesce(sum(refund_line.refund_cents),0)::bigint refunded_cents
          from sales_refund_line refund_line
          join sales_refund refund on refund.id=refund_line.refund_id
          where refund_line.order_line_id=line.id and refund.status='COMPLETED'
        ) refund_totals on true
        where sales.store_id=:store and sales.status='SETTLED' and sales.business_date between :from and :to
        group by line.service_item_id
      ) actual on actual.service_item_id=item.id
      where item.store_id=:store and item.active=true
      order by item.category,item.code
      """).param("store", storeId).param("month", month).param("from", month).param("to", month.plusMonths(1).minusDays(1)).query(ProjectTargetRow.class).list();
    List<TechnicianTargetRow> technicians = jdbc.sql(EFFECTIVE_COMMISSION_CTE + """
      select technician.id technician_id,technician.code technician_code,technician.name technician_name,
        coalesce(plan.target_cents,0) target_cents,coalesce(actual.amount_cents,0) actual_cents
      from technician
      left join monthly_target_allocation plan on plan.technician_id=technician.id and plan.store_id=:store and plan.target_month=:month and plan.allocation_type='TECHNICIAN'
      left join (
        select technician_id,sum(effective_base_amount_cents) amount_cents
        from effective_records
        where store_id=:store and business_date between :from and :to
          and (effective_base_amount_cents>0 or effective_commission_cents>0 or effective_clock_count_adjustment>0 or effective_duration_minutes_adjustment>0)
        group by technician_id
      ) actual on actual.technician_id=technician.id
      where technician.store_id=:store and technician.active=true
      order by technician.code
      """).param("store", storeId).param("month", month).param("from", month).param("to", month.plusMonths(1).minusDays(1)).query(TechnicianTargetRow.class).list();
    long projectAllocated = projects.stream().mapToLong(ProjectTargetRow::targetCents).sum();
    long technicianAllocated = technicians.stream().mapToLong(TechnicianTargetRow::targetCents).sum();
    return new TargetPlanView(month, storeTarget, storeActual, rate(storeActual, storeTarget), projectAllocated,
      Math.max(0, storeTarget - projectAllocated), technicianAllocated, Math.max(0, storeTarget - technicianAllocated),
      projects.stream().map(row -> row.withRate(rate(row.actualCents(), row.targetCents()))).toList(),
      technicians.stream().map(row -> row.withRate(rate(row.actualCents(), row.targetCents()))).toList(), canConfigure);
  }

  private void requireView(String authorization) {
    if (!adminSessions.hasPermission(authorization, "REPORT_VIEW") && !adminSessions.hasPermission(authorization, "DAILY_REPORT_CONFIG")) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Monthly target view permission is required");
    }
  }
  private boolean canConfigure(String authorization) { return adminSessions.hasPermission(authorization, "DAILY_REPORT_CONFIG"); }
  private LocalDate parseMonth(String value) {
    try { return YearMonth.parse(value == null || value.isBlank() ? YearMonth.now().toString() : value.substring(0, 7)).atDay(1); }
    catch (RuntimeException exception) { throw bad("Month must use YYYY-MM"); }
  }
  private long requireAmount(Long value, String field) { if (value == null || value < 0) throw bad(field + " must be a non-negative integer"); return value; }
  private BigDecimal rate(long actual, long target) { return target == 0 ? BigDecimal.ZERO.setScale(2) : BigDecimal.valueOf(actual * 100.0 / target).setScale(2, RoundingMode.HALF_UP); }
  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }

  record TargetPlanInput(String targetMonth, Long storeTargetCents, List<TargetAllocationInput> projects, List<TargetAllocationInput> technicians) {}
  record TargetAllocationInput(UUID id, Long targetCents) {}
  record TargetPlanView(LocalDate targetMonth, long storeTargetCents, long storeActualCents, BigDecimal storeCompletionRate,
                        long projectAllocatedCents, long projectUnallocatedCents, long technicianAllocatedCents, long technicianUnallocatedCents,
                        List<ProjectTargetView> projects, List<TechnicianTargetView> technicians, boolean canConfigure) {}
  record ProjectTargetRow(UUID projectId, String projectCode, String projectName, String category, long targetCents, long actualCents) {
    ProjectTargetView withRate(BigDecimal completionRate) { return new ProjectTargetView(projectId, projectCode, projectName, category, targetCents, actualCents, completionRate); }
  }
  record TechnicianTargetRow(UUID technicianId, String technicianCode, String technicianName, long targetCents, long actualCents) {
    TechnicianTargetView withRate(BigDecimal completionRate) { return new TechnicianTargetView(technicianId, technicianCode, technicianName, targetCents, actualCents, completionRate); }
  }
  record ProjectTargetView(UUID projectId, String projectCode, String projectName, String category, long targetCents, long actualCents, BigDecimal completionRate) {}
  record TechnicianTargetView(UUID technicianId, String technicianCode, String technicianName, long targetCents, long actualCents, BigDecimal completionRate) {}
}
