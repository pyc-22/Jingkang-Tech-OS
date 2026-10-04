package com.chengxin.massage.sales;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class SettlementAmountService {
  // Receipts are independent of the service snapshots used to generate commissions.
  Amounts resolve(List<Long> originals, List<Long> requested, Long declaredTotal,
                  String waiveReason, List<Long> payments) {
    long originalTotal = sum(originals);
    List<Long> unitAmounts = new ArrayList<>(originals.size());
    boolean hasUnitAmounts = requested.stream().anyMatch(Objects::nonNull);
    for (int index = 0; index < originals.size(); index++) {
      Long amount = requested.get(index);
      if (amount != null && amount < 0) throw bad("单元实收金额不得为负数");
      if (amount != null && amount == 0 && waiveReason.isBlank()) throw bad("0.00 元单元实收必须填写免单原因");
      unitAmounts.add(amount == null ? originals.get(index) : amount);
    }
    long unitTotal = sum(unitAmounts);
    long total = declaredTotal == null ? unitTotal : declaredTotal;
    if (total < 0) throw bad("实收金额不得为负数");
    if (hasUnitAmounts && total != unitTotal) throw bad("总实收金额必须等于各单元实收合计");
    if (total == 0 && waiveReason.isBlank()) throw bad("0.00 元结算必须填写免单原因");
    if (total == 0 && !payments.isEmpty()) throw bad("免单请勿填写收款金额");
    if (payments.stream().anyMatch(amount -> amount == null || amount < 1)) throw bad("收款金额必须为正整数分");
    if (sum(payments) != total) throw bad("各收款方式合计必须等于实收金额");

    // Legacy clients can still adjust only the header. Do not invent per-unit allocations.
    if (!hasUnitAmounts && total != originalTotal) {
      Long legacyUnitAmount = null;
      if (total == 0 || originals.size() == 1) legacyUnitAmount = total;
      unitAmounts = Collections.nCopies(originals.size(), legacyUnitAmount);
    }
    return new Amounts(Collections.unmodifiableList(unitAmounts), new Totals(originalTotal, total, originalTotal - total));
  }

  Totals totals(List<Long> originals, long actualTotal) {
    long originalTotal = sum(originals);
    return new Totals(originalTotal, actualTotal, originalTotal - actualTotal);
  }

  private long sum(List<Long> amounts) {
    try {
      return amounts.stream().reduce(0L, Math::addExact);
    } catch (ArithmeticException exception) {
      throw bad("金额合计超出支持范围");
    }
  }

  private ResponseStatusException bad(String message) {
    return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
  }

  record Amounts(List<Long> unitAmountsCents, Totals totals) {}
  record Totals(long originalTotalCents, long settlementAmountCents, long adjustmentCents) {}
}
