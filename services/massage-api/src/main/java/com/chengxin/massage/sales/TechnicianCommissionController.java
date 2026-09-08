package com.chengxin.massage.sales;

import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.BusinessClockService;

@RestController
@RequestMapping("/api/v1/commissions")
@CrossOrigin(origins = "*")
public class TechnicianCommissionController {
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
  private final StoreContextService storeContext;
  private final AuditService audits;
  private final BusinessClockService businessClock;
  TechnicianCommissionController(JdbcClient jdbc, StoreContextService storeContext, AuditService audits, BusinessClockService businessClock) { this.jdbc = jdbc; this.storeContext = storeContext; this.audits = audits; this.businessClock = businessClock; }

  @GetMapping("/service-item-rules")
  List<ServiceItemCommissionRule> serviceItemRules(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                                   @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate businessDate = businessClock.currentBusinessDate(storeId);
    return jdbc.sql("select item.id service_item_id,item.code service_item_code,item.name service_item_name,item.dispatch_type,coalesce(price.price_cents,item.price_cents) price_cents,current_rule.queue_rule_type,current_rule.queue_fixed_cents,current_rule.queue_rate_bp,current_rule.call_rule_type,current_rule.call_fixed_cents,current_rule.call_rate_bp,current_rule.extension_rule_type,current_rule.extension_fixed_cents,current_rule.extension_rate_bp,current_rule.active,current_rule.effective_business_date,next_rule.effective_business_date scheduled_effective_business_date from service_item item left join lateral (select version.price_cents from service_item_price_version version where version.service_item_id=item.id and version.effective_business_date<=:date order by version.effective_business_date desc limit 1) price on true join lateral (select version.* from service_item_commission_rule_version version where version.service_item_id=item.id and version.effective_business_date<=:date order by version.effective_business_date desc limit 1) current_rule on true left join lateral (select version.effective_business_date from service_item_commission_rule_version version where version.service_item_id=item.id and version.effective_business_date>:date order by version.effective_business_date limit 1) next_rule on true where item.store_id=:store order by item.active desc,item.code")
      .param("store", storeId).param("date", businessDate).query(ServiceItemCommissionRule.class).list();
  }

  @GetMapping("/service-item-rules/{serviceItemId}/versions")
  List<CommissionRuleVersionView> versions(@PathVariable UUID serviceItemId,
                                           @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                           @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql("select id,queue_rule_type,queue_fixed_cents,queue_rate_bp,call_rule_type,call_fixed_cents,call_rate_bp,extension_rule_type,extension_fixed_cents,extension_rate_bp,active,effective_business_date,created_at from service_item_commission_rule_version where store_id=:store and service_item_id=:service order by effective_business_date desc")
      .param("store", storeId).param("service", serviceItemId).query(CommissionRuleVersionView.class).list();
  }

  @PutMapping("/service-item-rules/{serviceItemId}")
  @Transactional
  ServiceItemCommissionRule saveServiceItemRule(@PathVariable UUID serviceItemId,
                                                @Valid @RequestBody CommissionRuleInput input,
                                                @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                                @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    if (!jdbc.sql("select exists(select 1 from service_item where id=:id and store_id=:store)").param("id", serviceItemId).param("store", storeId).query(Boolean.class).single()) throw notFound("Service item not found");
    ServiceItemCommissionRule before = serviceItemRules(authorization, requestedStoreId).stream().filter(rule -> rule.serviceItemId().equals(serviceItemId)).findFirst().orElseThrow();
    String queueType = ruleType(input.queueRuleType()); String callType = ruleType(input.callRuleType()); String extensionType = ruleType(input.extensionRuleType());
    LocalDate businessDate = businessClock.currentBusinessDate(storeId);
    LocalDate effectiveDate = input.effectiveBusinessDate() == null ? businessDate : input.effectiveBusinessDate();
    if (effectiveDate.isBefore(businessDate)) throw bad("Effective business date cannot be in the past");
    jdbc.sql("insert into service_item_commission_rule_version(id,tenant_id,store_id,service_item_id,queue_rule_type,queue_fixed_cents,queue_rate_bp,call_rule_type,call_fixed_cents,call_rate_bp,extension_rule_type,extension_fixed_cents,extension_rate_bp,active,effective_business_date) values(:id,:tenant,:store,:service,:queueType,:queueFixed,:queueRate,:callType,:callFixed,:callRate,:extensionType,:extensionFixed,:extensionRate,:active,:effective) on conflict(service_item_id,effective_business_date) do update set queue_rule_type=excluded.queue_rule_type,queue_fixed_cents=excluded.queue_fixed_cents,queue_rate_bp=excluded.queue_rate_bp,call_rule_type=excluded.call_rule_type,call_fixed_cents=excluded.call_fixed_cents,call_rate_bp=excluded.call_rate_bp,extension_rule_type=excluded.extension_rule_type,extension_fixed_cents=excluded.extension_fixed_cents,extension_rate_bp=excluded.extension_rate_bp,active=excluded.active,updated_at=now(),version=service_item_commission_rule_version.version+1")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("service", serviceItemId)
      .param("queueType", queueType).param("queueFixed", cents(input.queueFixedCents())).param("queueRate", bp(input.queueRateBp()))
      .param("callType", callType).param("callFixed", cents(input.callFixedCents())).param("callRate", bp(input.callRateBp()))
      .param("extensionType", extensionType).param("extensionFixed", cents(input.extensionFixedCents())).param("extensionRate", bp(input.extensionRateBp()))
      .param("active", input.active()).param("effective", effectiveDate).update();
    if (effectiveDate.equals(businessDate)) saveLegacyProjection(storeId, serviceItemId, queueType, callType, extensionType, input);
    ServiceItemCommissionRule saved = serviceItemRules(authorization, requestedStoreId).stream().filter(rule -> rule.serviceItemId().equals(serviceItemId)).findFirst().orElseThrow();
    audits.record(authorization, storeId, "COMMISSION", "COMMISSION_RULE_UPDATED", "service_item_commission_rule", serviceItemId, "修改项目提成规则", before, saved);
    return saved;
  }

  @GetMapping("/records")
  List<CommissionRecord> records(@RequestParam(required = false) LocalDate from,
                                 @RequestParam(required = false) LocalDate to,
                                 @RequestParam(required = false) UUID technicianId,
                                 @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                 @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate end = to == null ? businessClock.currentBusinessDate(storeId) : to;
    LocalDate start = from == null ? end.withDayOfMonth(1) : from;
    String techFilter = technicianId == null ? "" : " and technician_id=:technician";
    JdbcClient.StatementSpec sql = jdbc.sql(EFFECTIVE_RECORD_CTE + "select id,order_id,order_no_snapshot,settlement_no_snapshot,technician_id,technician_name_snapshot,service_name_snapshot,source_type,clock_type,rule_type,rule_rate_bp,rule_fixed_cents,effective_base_amount_cents base_amount_cents,effective_commission_cents commission_cents,settled_at,record_type,refund_id,original_commission_record_id,effective_clock_count_adjustment clock_count_adjustment,effective_duration_minutes_adjustment duration_minutes_adjustment,service_participant_id,allocation_bp_snapshot,served_seconds_snapshot,commission_tier_name_snapshot,commission_tier_minimum_clock_count_snapshot,commission_multiplier_bp_snapshot,monthly_clock_count_snapshot from effective_records where store_id=:store and business_date between :from and :to and (effective_base_amount_cents>0 or effective_commission_cents>0 or effective_clock_count_adjustment>0 or effective_duration_minutes_adjustment>0)" + techFilter + " order by settled_at desc,created_at desc limit 500")
      .param("store", storeId).param("from", start).param("to", end);
    if (technicianId != null) sql.param("technician", technicianId);
    return sql.query(CommissionRecord.class).list();
  }

  @GetMapping("/adjustments")
  List<CommissionAdjustment> adjustments(@RequestParam(required = false) LocalDate from,
                                         @RequestParam(required = false) LocalDate to,
                                         @RequestParam(required = false) UUID technicianId,
                                         @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                         @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate end = to == null ? businessClock.currentBusinessDate(storeId) : to;
    LocalDate start = from == null ? end.withDayOfMonth(1) : from;
    String techFilter = technicianId == null ? "" : " and record.technician_id=:technician";
    JdbcClient.StatementSpec sql = jdbc.sql("""
      SELECT record.id,record.order_id,record.order_no_snapshot,record.settlement_no_snapshot,
             record.technician_id,record.technician_name_snapshot,record.service_name_snapshot,
             record.source_type,record.clock_type,record.base_amount_cents,record.commission_cents,
             record.settled_at,record.record_type,record.refund_id,record.original_commission_record_id,
             record.clock_count_adjustment,record.duration_minutes_adjustment,
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
      WHERE record.store_id=:store
        AND record.business_date BETWEEN :from AND :to
        AND record.record_type IN ('REFUND_REVERSAL','ORDER_VOID_REVERSAL','BUSINESS_CORRECTION_REVERSAL')
      """ + techFilter + " ORDER BY record.settled_at DESC,record.created_at DESC LIMIT 500")
      .param("store", storeId).param("from", start).param("to", end);
    if (technicianId != null) sql.param("technician", technicianId);
    return sql.query(CommissionAdjustment.class).list();
  }

  @GetMapping("/summary")
  List<CommissionSummary> summary(@RequestParam(required = false) LocalDate from,
                                  @RequestParam(required = false) LocalDate to,
                                  @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                  @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate end = to == null ? businessClock.currentBusinessDate(storeId) : to;
    LocalDate start = from == null ? end.withDayOfMonth(1) : from;
    return jdbc.sql(EFFECTIVE_RECORD_CTE + "select technician_id,technician_name_snapshot,count(*) record_count,coalesce(sum(effective_base_amount_cents),0) base_amount_cents,coalesce(sum(effective_commission_cents),0) commission_cents from effective_records where store_id=:store and business_date between :from and :to and (effective_base_amount_cents>0 or effective_commission_cents>0 or effective_clock_count_adjustment>0 or effective_duration_minutes_adjustment>0) group by technician_id,technician_name_snapshot order by commission_cents desc,technician_name_snapshot")
      .param("store", storeId).param("from", start).param("to", end).query(CommissionSummary.class).list();
  }

  private String ruleType(String value) { String normalized = value == null || value.isBlank() ? "NONE" : value.trim().toUpperCase(Locale.ROOT); if (!List.of("NONE", "FIXED", "PERCENT").contains(normalized)) throw bad("Unsupported commission rule type"); return normalized; }
  private void saveLegacyProjection(UUID storeId, UUID serviceItemId, String queueType, String callType, String extensionType, CommissionRuleInput input) {
    jdbc.sql("insert into service_item_commission_rule(id,tenant_id,store_id,service_item_id,queue_rule_type,queue_fixed_cents,queue_rate_bp,call_rule_type,call_fixed_cents,call_rate_bp,extension_rule_type,extension_fixed_cents,extension_rate_bp,active) values(:id,:tenant,:store,:service,:queueType,:queueFixed,:queueRate,:callType,:callFixed,:callRate,:extensionType,:extensionFixed,:extensionRate,:active) on conflict(store_id,service_item_id) do update set queue_rule_type=excluded.queue_rule_type,queue_fixed_cents=excluded.queue_fixed_cents,queue_rate_bp=excluded.queue_rate_bp,call_rule_type=excluded.call_rule_type,call_fixed_cents=excluded.call_fixed_cents,call_rate_bp=excluded.call_rate_bp,extension_rule_type=excluded.extension_rule_type,extension_fixed_cents=excluded.extension_fixed_cents,extension_rate_bp=excluded.extension_rate_bp,active=excluded.active,updated_at=now(),version=service_item_commission_rule.version+1")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("service", serviceItemId)
      .param("queueType", queueType).param("queueFixed", cents(input.queueFixedCents())).param("queueRate", bp(input.queueRateBp()))
      .param("callType", callType).param("callFixed", cents(input.callFixedCents())).param("callRate", bp(input.callRateBp()))
      .param("extensionType", extensionType).param("extensionFixed", cents(input.extensionFixedCents())).param("extensionRate", bp(input.extensionRateBp()))
      .param("active", input.active()).update();
  }
  private long cents(Long value) { return value == null ? 0 : value; }
  private int bp(Integer value) { return value == null ? 0 : value; }
  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException notFound(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }

  record ServiceItemCommissionRule(UUID serviceItemId, String serviceItemCode, String serviceItemName, String dispatchType, Integer priceCents, String queueRuleType, Long queueFixedCents, Integer queueRateBp, String callRuleType, Long callFixedCents, Integer callRateBp, String extensionRuleType, Long extensionFixedCents, Integer extensionRateBp, Boolean active, LocalDate effectiveBusinessDate, LocalDate scheduledEffectiveBusinessDate) {}
  record CommissionRuleInput(String queueRuleType, @Min(0) Long queueFixedCents, @Min(0) @Max(10000) Integer queueRateBp, String callRuleType, @Min(0) Long callFixedCents, @Min(0) @Max(10000) Integer callRateBp, String extensionRuleType, @Min(0) Long extensionFixedCents, @Min(0) @Max(10000) Integer extensionRateBp, boolean active, LocalDate effectiveBusinessDate) {}
  record CommissionRuleVersionView(UUID id, String queueRuleType, Long queueFixedCents, Integer queueRateBp, String callRuleType, Long callFixedCents, Integer callRateBp, String extensionRuleType, Long extensionFixedCents, Integer extensionRateBp, Boolean active, LocalDate effectiveBusinessDate, java.time.OffsetDateTime createdAt) {}
  record CommissionRecord(UUID id, UUID orderId, String orderNoSnapshot, String settlementNoSnapshot, UUID technicianId, String technicianNameSnapshot, String serviceNameSnapshot, String sourceType, String clockType, String ruleType, Integer ruleRateBp, Long ruleFixedCents, Long baseAmountCents, Long commissionCents, java.time.OffsetDateTime settledAt, String recordType, UUID refundId, UUID originalCommissionRecordId, Short clockCountAdjustment, Short durationMinutesAdjustment, UUID serviceParticipantId, Integer allocationBpSnapshot, Integer servedSecondsSnapshot, String commissionTierNameSnapshot, Integer commissionTierMinimumClockCountSnapshot, Integer commissionMultiplierBpSnapshot, Integer monthlyClockCountSnapshot) {}
  record CommissionAdjustment(UUID id, UUID orderId, String orderNoSnapshot, String settlementNoSnapshot, UUID technicianId, String technicianNameSnapshot, String serviceNameSnapshot, String sourceType, String clockType, Long baseAmountCents, Long commissionCents, java.time.OffsetDateTime settledAt, String recordType, UUID refundId, UUID originalCommissionRecordId, Short clockCountAdjustment, Short durationMinutesAdjustment, String adjustmentReferenceNo, String adjustmentReason) {}
  record CommissionSummary(UUID technicianId, String technicianNameSnapshot, Long recordCount, Long baseAmountCents, Long commissionCents) {}
}
