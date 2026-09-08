package com.chengxin.massage.sales;

import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.BusinessClockService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
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
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/commissions/monthly-tiers")
@CrossOrigin(origins = "*")
public class MonthlyCommissionTierController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AuditService audits;
  private final BusinessClockService businessClock;

  MonthlyCommissionTierController(JdbcClient jdbc, StoreContextService storeContext, AuditService audits,
                                  BusinessClockService businessClock) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.audits = audits;
    this.businessClock = businessClock;
  }

  @GetMapping
  MonthlyTierPolicies policies(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                               @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate date = businessClock.currentBusinessDate(storeId);
    MonthlyTierPolicy current = policyAt(storeId, date);
    MonthlyTierPolicy scheduled = jdbc.sql("select id,active,effective_business_date,created_at from store_commission_tier_policy_version where store_id=:store and effective_business_date>:date order by effective_business_date limit 1")
      .param("store", storeId).param("date", date).query(PolicyBase.class).optional().map(base -> policy(storeId, base)).orElse(null);
    return new MonthlyTierPolicies(current, scheduled);
  }

  @GetMapping("/versions")
  List<MonthlyTierPolicy> versions(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                   @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql("select id,active,effective_business_date,created_at from store_commission_tier_policy_version where store_id=:store order by effective_business_date desc")
      .param("store", storeId).query(PolicyBase.class).list().stream().map(base -> policy(storeId, base)).toList();
  }

  @PutMapping
  @Transactional
  MonthlyTierPolicy save(@Valid @RequestBody MonthlyTierPolicyInput input,
                         @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                         @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate businessDate = businessClock.currentBusinessDate(storeId);
    LocalDate effectiveDate = input.effectiveBusinessDate() == null ? businessDate : input.effectiveBusinessDate();
    if (effectiveDate.isBefore(businessDate)) throw bad("Effective business date cannot be in the past");
    List<NormalizedTier> tiers = normalize(input.tiers());
    PolicyBase before = jdbc.sql("select id,active,effective_business_date,created_at from store_commission_tier_policy_version where store_id=:store and effective_business_date=:date")
      .param("store", storeId).param("date", effectiveDate).query(PolicyBase.class).optional().orElse(null);
    MonthlyTierPolicy beforeSnapshot = before == null ? null : policy(storeId, before);
    UUID policyId = before == null ? UUID.randomUUID() : before.id();
    if (before == null) {
      jdbc.sql("insert into store_commission_tier_policy_version(id,tenant_id,store_id,active,effective_business_date) values(:id,:tenant,:store,:active,:effective)")
        .param("id", policyId).param("tenant", TENANT_ID).param("store", storeId).param("active", input.active()).param("effective", effectiveDate).update();
    } else {
      jdbc.sql("update store_commission_tier_policy_version set active=:active,updated_at=now(),version=version+1 where id=:id and store_id=:store")
        .param("active", input.active()).param("id", policyId).param("store", storeId).update();
      jdbc.sql("delete from store_commission_tier where policy_version_id=:policy").param("policy", policyId).update();
    }
    for (int index = 0; index < tiers.size(); index++) {
      NormalizedTier tier = tiers.get(index);
      jdbc.sql("insert into store_commission_tier(id,tenant_id,store_id,policy_version_id,tier_name,minimum_monthly_clock_count,commission_multiplier_bp,sort_order) values(:id,:tenant,:store,:policy,:name,:minimum,:multiplier,:sort)")
        .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("policy", policyId)
        .param("name", tier.name()).param("minimum", tier.minimumMonthlyClockCount()).param("multiplier", tier.commissionMultiplierBp()).param("sort", index + 1).update();
    }
    MonthlyTierPolicy saved = policy(storeId, policyId);
    audits.record(authorization, storeId, "COMMISSION", "MONTHLY_COMMISSION_TIER_POLICY_UPDATED", "store_commission_tier_policy_version", policyId,
      "Updated monthly commission tier policy", beforeSnapshot, saved);
    return saved;
  }

  private MonthlyTierPolicy policyAt(UUID storeId, LocalDate date) {
    PolicyBase base = jdbc.sql("select id,active,effective_business_date,created_at from store_commission_tier_policy_version where store_id=:store and effective_business_date<=:date order by effective_business_date desc limit 1")
      .param("store", storeId).param("date", date).query(PolicyBase.class).optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Monthly tier policy not found"));
    return policy(storeId, base);
  }

  private MonthlyTierPolicy policy(UUID storeId, UUID policyId) {
    PolicyBase base = jdbc.sql("select id,active,effective_business_date,created_at from store_commission_tier_policy_version where id=:id and store_id=:store")
      .param("id", policyId).param("store", storeId).query(PolicyBase.class).single();
    return policy(storeId, base);
  }

  private MonthlyTierPolicy policy(UUID storeId, PolicyBase base) {
    List<MonthlyTier> tiers = jdbc.sql("select id,tier_name,minimum_monthly_clock_count,commission_multiplier_bp,sort_order from store_commission_tier where store_id=:store and policy_version_id=:policy order by minimum_monthly_clock_count,sort_order")
      .param("store", storeId).param("policy", base.id()).query(MonthlyTier.class).list();
    return new MonthlyTierPolicy(base.id(), base.active(), base.effectiveBusinessDate(), base.createdAt(), tiers);
  }

  private List<NormalizedTier> normalize(List<MonthlyTierInput> input) {
    List<NormalizedTier> tiers = new ArrayList<>();
    Set<Integer> minimums = new HashSet<>();
    for (MonthlyTierInput tier : input) {
      String name = tier.tierName().trim();
      if (!minimums.add(tier.minimumMonthlyClockCount())) throw bad("Monthly clock thresholds must be unique");
      tiers.add(new NormalizedTier(name, tier.minimumMonthlyClockCount(), tier.commissionMultiplierBp()));
    }
    if (!minimums.contains(0)) throw bad("A monthly tier policy must include a zero-clock base tier");
    tiers.sort(Comparator.comparing(NormalizedTier::minimumMonthlyClockCount));
    return tiers;
  }

  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }

  record MonthlyTierPolicyInput(boolean active, LocalDate effectiveBusinessDate,
                                @NotEmpty @Size(max = 12) List<@Valid MonthlyTierInput> tiers) {}
  record MonthlyTierInput(@NotBlank @Size(max = 80) String tierName, @NotNull @Min(0) Integer minimumMonthlyClockCount,
                          @NotNull @Min(0) @Max(30000) Integer commissionMultiplierBp) {}
  record NormalizedTier(String name, Integer minimumMonthlyClockCount, Integer commissionMultiplierBp) {}
  record PolicyBase(UUID id, Boolean active, LocalDate effectiveBusinessDate, java.time.OffsetDateTime createdAt) {}
  record MonthlyTier(UUID id, String tierName, Integer minimumMonthlyClockCount, Integer commissionMultiplierBp, Short sortOrder) {}
  record MonthlyTierPolicy(UUID id, Boolean active, LocalDate effectiveBusinessDate, java.time.OffsetDateTime createdAt, List<MonthlyTier> tiers) {}
  record MonthlyTierPolicies(MonthlyTierPolicy current, MonthlyTierPolicy scheduled) {}
}
