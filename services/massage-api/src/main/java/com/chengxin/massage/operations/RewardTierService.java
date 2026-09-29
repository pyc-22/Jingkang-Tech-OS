package com.chengxin.massage.operations;

import java.math.BigDecimal;
import java.util.List;

/** Fixed, auditable reward rules. Values are cents; inputs are the raw daily counts. */
public final class RewardTierService {
  private static final List<Tier> CASH_FLOW = List.of(
      cashTier(0, -2000, "低于 8000"), cashTier(8000, 2000), cashTier(9000, 3000), cashTier(10000, 4000),
      cashTier(11000, 6000), cashTier(12000, 8000), cashTier(13000, 10000), cashTier(14000, 13000),
      cashTier(15000, 16000), cashTier(16000, 20000), cashTier(17000, 24000), cashTier(18000, 30000),
      cashTier(19000, 35000), cashTier(20000, 40000));
  private static final List<Tier> YUE = List.of(
      countTier(0, -1000, "低于 5 人"), countTier(5, 500), countTier(6, 1000), countTier(7, 1500), countTier(8, 2000),
      countTier(9, 2500), countTier(10, 3000), countTier(11, 4000), countTier(12, 5000), countTier(13, 6000),
      countTier(14, 7000), countTier(15, 8000), countTier(16, 9000), countTier(17, 10000));
  private static final List<Tier> BIG_PROJECT = List.of(
      countTier(0, -1000, "低于 10 个"), countTier(10, 500), countTier(12, 1000), countTier(14, 1500),
      countTier(16, 2000), countTier(20, 3000), countTier(24, 4000), countTier(28, 5000), countTier(32, 6000),
      countTier(35, 7000), countTier(40, 8000), countTier(45, 10000), countTier(50, 12000), countTier(55, 14000));
  private static final List<Tier> RECHARGE = List.of(
      countTier(0, -1000, "0 张"), countTier(1, 1000), countTier(2, 2000), countTier(3, 3000), countTier(4, 4000),
      countTier(5, 5000), countTier(6, 10000), countTier(7, 12000), countTier(8, 15000), countTier(9, 18000),
      countTier(10, 22000), countTier(11, 26000), countTier(12, 30000), countTier(13, 35000));

  private RewardTierService() {}

  public static Evaluation cashFlow(long cents) { return evaluateCents("现金流", cents, CASH_FLOW); }
  public static Evaluation yue(long count) { return evaluateCount("约客", count, YUE); }
  public static Evaluation bigProject(long count) { return evaluateCount("大项目", count, BIG_PROJECT); }
  public static Evaluation recharge(long count) { return evaluateCount("充卡", count, RECHARGE); }

  public static Evaluation evaluate(String metric, double value, List<Tier> tiers) {
    long cents = BigDecimal.valueOf(value).movePointRight(2).longValueExact();
    return evaluateCents(metric, cents, tiers);
  }

  private static Evaluation evaluateCents(String metric, long cents, List<Tier> tiers) {
    Tier selected = tiers.getFirst();
    for (Tier tier : tiers) if (cents >= tier.minimumCents()) selected = tier;
    return new Evaluation(metric, cents / 100.0, selected.minimumCents() / 100.0, selected.rewardCents(), selected.label());
  }

  private static Evaluation evaluateCount(String metric, long count, List<Tier> tiers) {
    Tier selected = tiers.getFirst();
    for (Tier tier : tiers) if (count >= tier.minimumCount()) selected = tier;
    return new Evaluation(metric, count, selected.minimumCount(), selected.rewardCents(), selected.label());
  }

  public record Tier(long minimumCents, long minimumCount, long rewardCents, String label) {
    public long minimum() { return minimumCount; }
  }
  public record Evaluation(String metric, double value, double tierMinimum, long rewardCents, String tierLabel) {
    public boolean positive() { return rewardCents >= 0; }
  }

  private static Tier cashTier(double minimum, long rewardCents) { return cashTier(minimum, rewardCents, null); }
  private static Tier cashTier(double minimum, long rewardCents, String label) {
    return new Tier(Math.round(minimum * 100), 0, rewardCents, label == null ? "达到 " + format(minimum) + " 档" : label);
  }
  private static Tier countTier(long minimum, long rewardCents) { return countTier(minimum, rewardCents, null); }
  private static Tier countTier(long minimum, long rewardCents, String label) {
    return new Tier(0, minimum, rewardCents, label == null ? "达到 " + minimum + " 档" : label);
  }
  private static String format(double value) { return value == Math.rint(value) ? Long.toString((long) value) : Double.toString(value); }
}
