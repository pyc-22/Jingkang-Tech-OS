package com.chengxin.massage.sales;

import java.time.LocalDate;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Resolves the prospective monthly tier before each settlement commission is written. */
@Service
public class MonthlyCommissionTierService {
  private static final Logger COMMISSION_LOG = LoggerFactory.getLogger("COMMISSION");
  private final JdbcClient jdbc;

  MonthlyCommissionTierService(JdbcClient jdbc) { this.jdbc = jdbc; }

  @Transactional(propagation = Propagation.MANDATORY)
  public void lockStore(UUID storeId) {
    // A store gate gives multi-technician orders and reversals one lock order.
    jdbc.sql("select pg_advisory_xact_lock(hashtextextended(:key,0))")
      .param("key", "commission-store:" + storeId).query((rs, row) -> true).single();
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public TierSnapshot resolve(UUID storeId, UUID technicianId, LocalDate businessDate, short clockAdjustment) {
    lockStore(storeId);
    jdbc.sql("select pg_advisory_xact_lock(hashtextextended(:key,0))")
      .param("key", "commission-month:" + storeId + ":" + technicianId + ":" + businessDate.withDayOfMonth(1))
      .query((rs, row) -> true).single();
    COMMISSION_LOG.info("monthlyTier.resolve entry storeId={} technicianId={} businessDate={} clockAdjustment={}", storeId, technicianId, businessDate, clockAdjustment);
    LocalDate monthStart = businessDate.withDayOfMonth(1);
    int priorClockCount = 0;
    int monthlyClockCount = 0;
    Policy policy = null;
    Tier tier = null;
    try {
      priorClockCount = jdbc.sql("select coalesce(sum(clock_count_adjustment),0)::integer from technician_commission_record where store_id=:store and technician_id=:technician and business_date>=:month and business_date<:nextMonth and source_type='MAIN'")
        .param("store", storeId).param("technician", technicianId).param("month", monthStart).param("nextMonth", monthStart.plusMonths(1)).query(Integer.class).single();
      monthlyClockCount = Math.max(0, priorClockCount + Math.max(0, clockAdjustment));
      COMMISSION_LOG.info("monthlyTier.resolve clock counts prior={} monthly={}", priorClockCount, monthlyClockCount);
      policy = jdbc.sql("select id,active from store_commission_tier_policy_version where store_id=:store and effective_business_date<=:date order by effective_business_date desc limit 1")
        .param("store", storeId).param("date", businessDate).query(Policy.class).optional().orElse(null);
      COMMISSION_LOG.info("monthlyTier.resolve policy exists={} active={} policyId={}", policy != null, policy != null && policy.active(), policy == null ? null : policy.id());
      if (policy == null || !policy.active()) {
        TierSnapshot result = TierSnapshot.baseline(monthlyClockCount);
        COMMISSION_LOG.info("monthlyTier.resolve exit baseline={}", result);
        return result;
      }
      tier = jdbc.sql("select id,tier_name,minimum_monthly_clock_count,commission_multiplier_bp from store_commission_tier where policy_version_id=:policy and minimum_monthly_clock_count<=:count order by minimum_monthly_clock_count desc limit 1")
        .param("policy", policy.id()).param("count", monthlyClockCount).query(Tier.class).optional().orElse(null);
      COMMISSION_LOG.info("monthlyTier.resolve tier exists={} tier={}", tier != null, tier);
      TierSnapshot result = tier == null ? TierSnapshot.baseline(monthlyClockCount) : new TierSnapshot(policy.id(), tier.id(), tier.tierName(), tier.minimumMonthlyClockCount(), tier.commissionMultiplierBp(), monthlyClockCount);
      COMMISSION_LOG.info("monthlyTier.resolve exit snapshot={}", result);
      return result;
    } catch (RuntimeException exception) {
      COMMISSION_LOG.error("monthlyTier.resolve exception state={storeId=" + storeId + ", technicianId=" + technicianId + ", businessDate=" + businessDate + ", clockAdjustment=" + clockAdjustment + ", monthStart=" + monthStart + ", priorClockCount=" + priorClockCount + ", monthlyClockCount=" + monthlyClockCount + ", policy=" + policy + ", tier=" + tier + "}", exception);
      throw exception;
    }
  }

  record Policy(UUID id, Boolean active) {}
  record Tier(UUID id, String tierName, Integer minimumMonthlyClockCount, Integer commissionMultiplierBp) {}
  public record TierSnapshot(UUID policyVersionId, UUID tierId, String tierName, Integer minimumMonthlyClockCount,
                             Integer multiplierBp, Integer monthlyClockCount) {
    static TierSnapshot baseline(int monthlyClockCount) {
      return new TierSnapshot(null, null, "基础档", 0, 10000, monthlyClockCount);
    }
  }
}
