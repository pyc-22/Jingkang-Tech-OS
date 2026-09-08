package com.chengxin.massage.sales;

import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.BusinessClockService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@RestController
@RequestMapping("/api/v1/commissions/administrative")
@CrossOrigin(origins = "*")
public class AdministrativeReferralCommissionController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final Logger COMMISSION_LOG = LoggerFactory.getLogger("COMMISSION");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AuditService audits;
  private final BusinessClockService businessClock;

  AdministrativeReferralCommissionController(JdbcClient jdbc, StoreContextService storeContext, AuditService audits, BusinessClockService businessClock) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.audits = audits;
    this.businessClock = businessClock;
  }

  @GetMapping("/rules")
  List<RuleView> rules(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                       @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql("select rule.id,rule.employee_id,employee.full_name employee_name,rule.service_item_id,item.name service_item_name,rule.rule_type,rule.fixed_cents,rule.rate_bp,rule.active,rule.effective_business_date from administrative_commission_rule rule left join employee on employee.id=rule.employee_id left join service_item item on item.id=rule.service_item_id where rule.store_id=:store order by rule.active desc,rule.effective_business_date desc,employee.full_name,item.name")
      .param("store", storeId).query(RuleView.class).list();
  }

  @PutMapping("/rules")
  @Transactional
  RuleView saveRule(@Valid @RequestBody RuleInput input,
                    @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                    @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate date = input.effectiveBusinessDate() == null ? businessClock.currentBusinessDate(storeId) : input.effectiveBusinessDate();
    if (!existsEmployee(storeId, input.employeeId())) throw bad("Employee not found in this store");
    if (input.serviceItemId() != null && !existsService(storeId, input.serviceItemId())) throw bad("Service item not found in this store");
    if ("PERCENT".equals(input.ruleType()) && input.rateBp() > 10000) throw bad("Rate cannot exceed 100%");
    jdbc.sql("insert into administrative_commission_rule(id,tenant_id,store_id,employee_id,service_item_id,rule_type,fixed_cents,rate_bp,active,effective_business_date) values(:id,:tenant,:store,:employee,:service,:type,:fixed,:rate,:active,:date) on conflict(store_id,employee_id,service_item_id,effective_business_date) do update set rule_type=excluded.rule_type,fixed_cents=excluded.fixed_cents,rate_bp=excluded.rate_bp,active=excluded.active,updated_at=now(),version=administrative_commission_rule.version+1")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("employee", input.employeeId()).param("service", input.serviceItemId())
      .param("type", normalizeType(input.ruleType())).param("fixed", input.fixedCents() == null ? 0L : input.fixedCents()).param("rate", input.rateBp() == null ? 0 : input.rateBp()).param("active", input.active()).param("date", date).update();
    return rules(authorization, requestedStoreId).stream().filter(item -> java.util.Objects.equals(item.employeeId(), input.employeeId()) && java.util.Objects.equals(item.serviceItemId(), input.serviceItemId()) && item.effectiveBusinessDate().equals(date)).findFirst().orElseThrow();
  }

  @GetMapping("/referrals")
  List<ReferralView> referrals(@RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to,
                              @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                              @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate end = to == null ? businessClock.currentBusinessDate(storeId) : to;
    LocalDate start = from == null ? end.withDayOfMonth(1) : from;
    return jdbc.sql("select id,employee_id,employee_name_snapshot,service_item_id,service_name_snapshot,order_id,order_no_snapshot,business_date,base_amount_cents,rule_type,rule_rate_bp,rule_fixed_cents,commission_cents,status,note,referred_at,paid_at from administrative_referral_record where store_id=:store and business_date between :from and :to order by referred_at desc limit 500")
      .param("store", storeId).param("from", start).param("to", end).query(ReferralView.class).list();
  }

  @PostMapping("/referrals")
  @Transactional
  ReferralView createReferral(@Valid @RequestBody ReferralInput input,
                              @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                              @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate date = input.businessDate() == null ? businessClock.currentBusinessDate(storeId) : input.businessDate();
    COMMISSION_LOG.info("administrative.createReferral entry storeId={} employeeId={} serviceItemId={} orderId={} baseAmountCents={} businessDate={}", storeId, input.employeeId(), input.serviceItemId(), input.orderId(), input.baseAmountCents(), date);
    Employee employee = null;
    Service service = null;
    OrderSnapshot order = null;
    Rule rule = null;
    long commission = 0;
    UUID id = null;
    try {
      employee = jdbc.sql("select id,full_name from employee where id=:id and active=true and exists(select 1 from employee_store_assignment where employee_id=:id and store_id=:store and active=true)")
        .param("id", input.employeeId()).param("store", storeId).query(Employee.class).single();
      service = input.serviceItemId() == null ? new Service(null, "推荐项目") : jdbc.sql("select id,name from service_item where id=:id and store_id=:store").param("id", input.serviceItemId()).param("store", storeId).query(Service.class).single();
      order = input.orderId() == null ? null : jdbc.sql("select id,order_no from sales_order where id=:id and store_id=:store").param("id", input.orderId()).param("store", storeId).query(OrderSnapshot.class).single();
      rule = resolveRule(storeId, input.employeeId(), input.serviceItemId(), date);
      COMMISSION_LOG.info("administrative.createReferral resolved rule={}", rule);
      commission = calculate(rule, input.baseAmountCents());
      id = UUID.randomUUID();
      int rows = jdbc.sql("insert into administrative_referral_record(id,tenant_id,store_id,employee_id,employee_name_snapshot,service_item_id,service_name_snapshot,order_id,order_no_snapshot,business_date,base_amount_cents,rule_type,rule_rate_bp,rule_fixed_cents,commission_cents,note) values(:id,:tenant,:store,:employee,:employeeName,:service,:serviceName,:order,:orderNo,:date,:base,:type,:rate,:fixed,:commission,:note)")
        .param("id", id).param("tenant", TENANT_ID).param("store", storeId).param("employee", employee.id()).param("employeeName", employee.fullName())
        .param("service", service.id()).param("serviceName", service.name()).param("order", order == null ? null : order.id()).param("orderNo", order == null ? null : order.orderNo())
        .param("date", date).param("base", input.baseAmountCents()).param("type", rule.ruleType()).param("rate", rule.rateBp()).param("fixed", rule.fixedCents()).param("commission", commission).param("note", input.note()).update();
      COMMISSION_LOG.info("administrative.createReferral persisted rows={} id={} commission={}", rows, id, commission);
      ReferralView created = referral(storeId, id);
      audits.record(authorization, storeId, "COMMISSION", "ADMINISTRATIVE_REFERRAL_RECORDED", "administrative_referral_record", id, "Recorded administrative referral commission", null, created);
      COMMISSION_LOG.info("administrative.createReferral exit result={}", created);
      return created;
    } catch (RuntimeException exception) {
      COMMISSION_LOG.error("administrative.createReferral exception state={storeId=" + storeId + ", input=" + input + ", date=" + date + ", employee=" + employee + ", service=" + service + ", order=" + order + ", rule=" + rule + ", commission=" + commission + ", id=" + id + "}", exception);
      throw exception;
    }
  }

  @GetMapping("/summary")
  List<Summary> summary(@RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to,
                        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                        @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate end = to == null ? businessClock.currentBusinessDate(storeId) : to;
    LocalDate start = from == null ? end.withDayOfMonth(1) : from;
    return jdbc.sql("select employee_id,employee_name_snapshot,count(*) record_count,coalesce(sum(base_amount_cents),0)::bigint base_amount_cents,coalesce(sum(commission_cents),0)::bigint commission_cents,count(*) filter(where status='PAID')::integer paid_record_count from administrative_referral_record where store_id=:store and business_date between :from and :to and status<>'CANCELLED' group by employee_id,employee_name_snapshot order by commission_cents desc,employee_name_snapshot")
      .param("store", storeId).param("from", start).param("to", end).query(Summary.class).list();
  }

  @PutMapping("/referrals/{id}/paid")
  @Transactional
  ReferralView markPaid(@PathVariable UUID id,
                        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                        @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    int count = jdbc.sql("update administrative_referral_record set status='PAID',paid_at=now(),updated_at=now(),version=version+1 where id=:id and store_id=:store and status='PENDING'").param("id", id).param("store", storeId).update();
    if (count == 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "Referral is not pending");
    return referral(storeId, id);
  }

  private ReferralView referral(UUID storeId, UUID id) { return jdbc.sql("select id,employee_id,employee_name_snapshot,service_item_id,service_name_snapshot,order_id,order_no_snapshot,business_date,base_amount_cents,rule_type,rule_rate_bp,rule_fixed_cents,commission_cents,status,note,referred_at,paid_at from administrative_referral_record where id=:id and store_id=:store").param("id", id).param("store", storeId).query(ReferralView.class).single(); }
  private Rule resolveRule(UUID storeId, UUID employeeId, UUID serviceItemId, LocalDate date) { return jdbc.sql("select rule_type,fixed_cents,rate_bp from administrative_commission_rule where store_id=:store and active=true and effective_business_date<=:date and (employee_id=:employee or employee_id is null) and (service_item_id=:service or service_item_id is null) order by (employee_id is not null) desc,(service_item_id is not null) desc,effective_business_date desc limit 1").param("store", storeId).param("employee", employeeId).param("service", serviceItemId).param("date", date).query(Rule.class).optional().orElse(new Rule("NONE", 0L, 0)); }
  private long calculate(Rule rule, long base) {
    COMMISSION_LOG.info("administrative.calculate entry rule={} baseAmountCents={}", rule, base);
    try {
      long result = switch (rule.ruleType()) {
        case "FIXED" -> rule.fixedCents();
        case "PERCENT" -> Math.round((double) base * rule.rateBp() / 10000d);
        default -> 0L;
      };
      COMMISSION_LOG.info("administrative.calculate exit ruleType={} baseAmountCents={} resultCommissionCents={}", rule.ruleType(), base, result);
      return result;
    } catch (RuntimeException exception) {
      COMMISSION_LOG.error("administrative.calculate exception state={rule=" + rule + ", baseAmountCents=" + base + "}", exception);
      throw exception;
    }
  }
  private boolean existsEmployee(UUID storeId, UUID employeeId) { return employeeId != null && jdbc.sql("select exists(select 1 from employee where id=:id and exists(select 1 from employee_store_assignment where employee_id=:id and store_id=:store))").param("id", employeeId).param("store", storeId).query(Boolean.class).single(); }
  private boolean existsService(UUID storeId, UUID serviceItemId) { return jdbc.sql("select exists(select 1 from service_item where id=:id and store_id=:store)").param("id", serviceItemId).param("store", storeId).query(Boolean.class).single(); }
  private String normalizeType(String value) { String type = value == null ? "NONE" : value.trim().toUpperCase(); if (!List.of("NONE","FIXED","PERCENT").contains(type)) throw bad("Unsupported administrative commission rule type"); return type; }
  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }

  record Employee(UUID id, String fullName) {}
  record Service(UUID id, String name) {}
  record OrderSnapshot(UUID id, String orderNo) {}
  record Rule(String ruleType, Long fixedCents, Integer rateBp) {}
  record RuleInput(UUID employeeId, UUID serviceItemId, String ruleType, @Min(0) Long fixedCents, @Min(0) Integer rateBp, boolean active, LocalDate effectiveBusinessDate) {}
  record ReferralInput(@NotNull UUID employeeId, UUID serviceItemId, UUID orderId, @NotNull @Min(0) Long baseAmountCents, LocalDate businessDate, @Size(max = 240) String note) {}
  record RuleView(UUID id, UUID employeeId, String employeeName, UUID serviceItemId, String serviceItemName, String ruleType, Long fixedCents, Integer rateBp, Boolean active, LocalDate effectiveBusinessDate) {}
  record ReferralView(UUID id, UUID employeeId, String employeeNameSnapshot, UUID serviceItemId, String serviceNameSnapshot, UUID orderId, String orderNoSnapshot, LocalDate businessDate, Long baseAmountCents, String ruleType, Integer ruleRateBp, Long ruleFixedCents, Long commissionCents, String status, String note, OffsetDateTime referredAt, OffsetDateTime paidAt) {}
  record Summary(UUID employeeId, String employeeNameSnapshot, Long recordCount, Long baseAmountCents, Long commissionCents, Integer paidRecordCount) {}
}
