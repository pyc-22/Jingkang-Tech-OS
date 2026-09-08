package com.chengxin.massage.operations;

import java.util.List;

final class DailyFinancialPolicy {
  private static final String MEMBER_BALANCE = "MEMBER_BALANCE";

  private DailyFinancialPolicy() {}

  static Totals calculate(long settledOrderCents, long completedOrderRefundCents,
                          List<ChannelMovement> channels, long rechargeNetCents) {
    if (settledOrderCents < 0 || completedOrderRefundCents < 0) {
      throw new IllegalArgumentException("Order amounts must be non-negative");
    }
    if (channels == null) throw new IllegalArgumentException("Payment channels are required");

    long channelSettlements = channels.stream().mapToLong(ChannelMovement::settledCents).reduce(0L, Math::addExact);
    long channelRefunds = channels.stream().mapToLong(ChannelMovement::refundedCents).reduce(0L, Math::addExact);
    if (channelSettlements != settledOrderCents) {
      throw new IllegalArgumentException("Order payments must equal settled order amount");
    }
    if (channelRefunds != completedOrderRefundCents) {
      throw new IllegalArgumentException("Refund payments must equal completed order refund amount");
    }

    long turnoverCents = Math.subtractExact(settledOrderCents, completedOrderRefundCents);
    long externalOrderCashFlowCents = channels.stream()
      .filter(channel -> !MEMBER_BALANCE.equalsIgnoreCase(channel.methodKind()))
      .mapToLong(ChannelMovement::netCents)
      .reduce(0L, Math::addExact);
    long cashFlowCents = Math.addExact(externalOrderCashFlowCents, rechargeNetCents);
    return new Totals(turnoverCents, externalOrderCashFlowCents, cashFlowCents);
  }

  record ChannelMovement(String methodKind, long settledCents, long refundedCents) {
    ChannelMovement {
      if (methodKind == null || methodKind.isBlank()) throw new IllegalArgumentException("Payment method kind is required");
      if (settledCents < 0 || refundedCents < 0) throw new IllegalArgumentException("Payment amounts must be non-negative");
    }

    long netCents() {
      return Math.subtractExact(settledCents, refundedCents);
    }
  }

  record Totals(long turnoverCents, long externalOrderCashFlowCents, long cashFlowCents) {}
}
