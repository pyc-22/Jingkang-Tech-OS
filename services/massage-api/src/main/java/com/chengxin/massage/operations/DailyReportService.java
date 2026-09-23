package com.chengxin.massage.operations;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import java.util.function.Supplier;

/**
 * Single source for operational daily metrics. Orders use their settlement business date;
 * completed refunds remain on the original order business date.
 */
@Service
public class DailyReportService {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;

  public DailyReportService(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional(isolation = Isolation.REPEATABLE_READ, readOnly = true)
  public <T> T snapshot(Supplier<T> report) { return report.get(); }

  @Transactional(isolation = Isolation.REPEATABLE_READ, readOnly = true)
  public DailyMetrics daily(UUID storeId, LocalDate businessDate) {
    OrderTotals orders = jdbc.sql("""
      select count(distinct o.id) filter (where coalesce(o.refund_status,'NONE') <> 'FULL') settled_order_count,
             count(distinct o.id) filter (where coalesce(o.refund_status,'NONE') <> 'FULL') customer_count,
             coalesce(sum(p.amount_cents),0)::bigint sales_amount_cents
      from sales_order o
      left join payment_record p on p.order_id=o.id
      where o.store_id=:store and o.status='SETTLED' and o.paid_cents>0 and o.business_date=:date
      """).param("store", storeId).param("date", businessDate).query(OrderTotals.class).single();

    RefundTotals refunds = jdbc.sql("""
      select coalesce(sum(total_cents),0)::bigint refund_amount_cents
      from sales_refund where store_id=:store and status='COMPLETED' and business_date=:date
      """).param("store", storeId).param("date", businessDate).query(RefundTotals.class).single();

    WalletTotals wallet = jdbc.sql("""
      with ranked_recharges as (
        select wt.store_id,wt.member_id,wt.business_date,coalesce(wt.corrected_amount_cents,wt.amount_cents) amount_cents,
               row_number() over(partition by wt.tenant_id,wt.member_id order by wt.created_at,wt.id) recharge_number
        from reporting_wallet_transaction wt
        where wt.tenant_id=:tenant and wt.transaction_type='RECHARGE'
      )
      select
        coalesce((select sum(coalesce(wt.corrected_amount_cents,wt.amount_cents)) from reporting_wallet_transaction wt
          where wt.store_id=:store and wt.business_date=:date and wt.transaction_type='RECHARGE'),0)::bigint recharge_amount_cents,
        coalesce((select sum(wt.amount_cents) from reporting_wallet_transaction wt
          where wt.store_id=:store and wt.business_date=:date and (wt.transaction_type='BONUS'
            or (wt.transaction_type='ADJUSTMENT' and wt.source='RECHARGE_REFUND_BONUS'))),0)::bigint bonus_amount_cents,
        coalesce((select sum(abs(wt.amount_cents)) from wallet_transaction wt
          where wt.store_id=:store and wt.business_date=:date and wt.transaction_type='CONSUMPTION' and wt.source='ORDER'
            and wt.note ~* '^[0-9a-f-]{36}$'
            and exists(select 1 from sales_order o where o.id=wt.note::uuid and o.store_id=wt.store_id
              and o.status='SETTLED' and o.paid_cents>0)),0)::bigint consumption_debit_cents,
        coalesce((select sum(wt.amount_cents) from wallet_transaction wt
          where wt.store_id=:store and wt.business_date=:date and wt.transaction_type='REFUND'
            and ((wt.source='ORDER_REFUND' and exists(select 1 from sales_refund r
                    where r.store_id=wt.store_id and r.refund_no=wt.note and r.status='COMPLETED'))
              or (wt.source='ORDER_CORRECTION' and wt.note ~* '^[0-9a-f-]{36}$'
                  and exists(select 1 from sales_order o where o.id=wt.note::uuid and o.store_id=wt.store_id
                    and o.status='SETTLED')))),0)::bigint consumption_refund_cents,
        coalesce((select sum(r.amount_cents) from ranked_recharges r
          where r.store_id=:store and r.business_date=:date and r.recharge_number=1),0)::bigint card_open_cents,
        coalesce((select sum(r.amount_cents) from ranked_recharges r
          where r.store_id=:store and r.business_date=:date and r.recharge_number>1),0)::bigint card_renew_cents,
        coalesce((select count(*) from ranked_recharges r
          where r.store_id=:store and r.business_date=:date and r.recharge_number=1),0)::bigint card_open_count
      """).param("tenant", TENANT_ID).param("store", storeId).param("date", businessDate).query(WalletTotals.class).single();

    List<ChannelMetrics> channels = channels(storeId, businessDate);
    long consumption = cardConsumptionCents(
      wallet.consumptionDebitCents(), wallet.consumptionRefundCents());
    long netSales = Math.subtractExact(orders.salesAmountCents(), refunds.refundAmountCents());
    long externalCash = channels.stream().filter(c -> !"MEMBER_BALANCE".equalsIgnoreCase(c.methodKind()))
      .mapToLong(ChannelMetrics::orderNetCents).sum();
    long rechargeNet = channels.stream().mapToLong(ChannelMetrics::rechargeNetCents).reduce(0L, Math::addExact);
    long customerCount = jdbc.sql("select customer_count from daily_customer_count_override where store_id=:store and business_date=:date")
      .param("store", storeId).param("date", businessDate).query(Long.class).optional().orElse(orders.customerCount());
    List<RefundOccurrence> refundOccurrences = jdbc.sql("""
      select r.id,r.refund_no,o.order_no,r.total_cents amount_cents,r.completed_at,
             r.business_date refund_business_date,o.business_date original_order_business_date
      from sales_refund r join sales_order o on o.id=r.order_id
      where r.store_id=:store and r.status='COMPLETED' and r.business_date=:date
      order by r.completed_at,r.id
      """).param("store", storeId).param("date", businessDate).query(RefundOccurrence.class).list();
    long cashFlow = Math.addExact(externalCash, rechargeNet);
    return new DailyMetrics(businessDate, orders.settledOrderCount(), customerCount, orders.customerCount(), orders.salesAmountCents(),
      wallet.rechargeAmountCents(), wallet.bonusAmountCents(), consumption, refunds.refundAmountCents(), netSales,
      wallet.cardOpenCents(), wallet.cardOpenCount(), wallet.cardRenewCents(), rechargeNet, externalCash, cashFlow,
      channels, refundOccurrences);
  }

  @Transactional(isolation = Isolation.REPEATABLE_READ, readOnly = true)
  public List<ChannelMetrics> channels(UUID storeId, LocalDate date) {
    Map<String, ChannelMetrics> result = new LinkedHashMap<>();
    jdbc.sql("select code,name,method_kind,active,cash_counted,sort_order from store_payment_method where store_id=:store order by sort_order,code")
      .param("store", storeId).query(ChannelDefinition.class).list().forEach(m ->
        result.put(m.code(), new ChannelMetrics(m.code(), m.name(), m.methodKind(), Boolean.TRUE.equals(m.active()),
          Boolean.TRUE.equals(m.cashCounted()), 0, 0, m.sortOrder())));
    jdbc.sql("""
      select p.payment_method code,max(p.payment_method_name_snapshot) name,coalesce(sum(p.amount_cents),0)::bigint amount_cents
      from payment_record p join sales_order o on o.id=p.order_id
      where p.store_id=:store and o.status='SETTLED' and o.paid_cents>0 and o.business_date=:date
      group by p.payment_method
      """).param("store", storeId).param("date", date).query(NamedAmount.class).list().forEach(row -> {
        ChannelMetrics old = result.get(row.code());
        result.put(row.code(), old == null ? new ChannelMetrics(row.code(), row.name(), "MEMBER_BALANCE".equals(row.code()) ? "MEMBER_BALANCE" : "EXTERNAL", false, false, row.amountCents(), 0, Short.MAX_VALUE)
          : old.withSales(row.amountCents()));
      });
    jdbc.sql("""
      select rp.payment_method code,max(op.payment_method_name_snapshot) name,coalesce(sum(rp.amount_cents),0)::bigint amount_cents
      from refund_payment_record rp join sales_refund r on r.id=rp.refund_id
      join payment_record op on op.id=rp.original_payment_id
      where r.store_id=:store and r.status='COMPLETED' and rp.status='COMPLETED' and r.business_date=:date
      group by rp.payment_method
      """).param("store", storeId).param("date", date).query(NamedAmount.class).list().forEach(row -> {
        ChannelMetrics old = result.get(row.code());
        result.put(row.code(), old == null ? new ChannelMetrics(row.code(), row.name(), "MEMBER_BALANCE".equals(row.code()) ? "MEMBER_BALANCE" : "EXTERNAL", false, false, 0, row.amountCents(), Short.MAX_VALUE)
          : old.withRefunds(row.amountCents()));
      });
    jdbc.sql("""
      select coalesce(wt.payment_method,'UNSPECIFIED') code,
             coalesce(max(wt.payment_method_name_snapshot),case when wt.payment_method is null then '未指定' else wt.payment_method end) name,
             coalesce(sum(coalesce(wt.corrected_amount_cents,wt.amount_cents)),0)::bigint amount_cents
      from reporting_wallet_transaction wt
      where wt.store_id=:store and wt.business_date=:date and wt.transaction_type='RECHARGE'
      group by wt.payment_method
      """).param("store", storeId).param("date", date).query(NamedAmount.class).list().forEach(row -> {
        ChannelMetrics old = result.get(row.code());
        result.put(row.code(), old == null ? new ChannelMetrics(row.code(), row.name(), "EXTERNAL", false, false, 0, 0, row.amountCents(), 0, Short.MAX_VALUE)
          : old.withRecharges(row.amountCents()));
      });
    jdbc.sql("""
      select coalesce(wt.payment_method,'UNSPECIFIED') code,
             coalesce(max(wt.payment_method_name_snapshot),case when wt.payment_method is null then '未指定' else wt.payment_method end) name,
             coalesce(sum(-wt.amount_cents),0)::bigint amount_cents
      from reporting_wallet_transaction wt
      where wt.store_id=:store and wt.business_date=:date and wt.transaction_type='ADJUSTMENT' and wt.source='RECHARGE_REFUND'
      group by wt.payment_method
      """).param("store", storeId).param("date", date).query(NamedAmount.class).list().forEach(row -> {
        ChannelMetrics old = result.get(row.code());
        result.put(row.code(), old == null ? new ChannelMetrics(row.code(), row.name(), "EXTERNAL", false, false, 0, 0, 0, row.amountCents(), Short.MAX_VALUE)
          : old.withRechargeRefunds(row.amountCents()));
      });
    return result.values().stream().sorted(Comparator.comparingInt(ChannelMetrics::sortOrder).thenComparing(ChannelMetrics::code)).toList();
  }

  static long cardConsumptionCents(long consumptionDebitCents, long eligibleRefundCents) {
    if (consumptionDebitCents < 0 || eligibleRefundCents < 0) {
      throw new IllegalArgumentException("Card activity amounts must be non-negative");
    }
    return Math.subtractExact(consumptionDebitCents, eligibleRefundCents);
  }

  public record DailyMetrics(LocalDate businessDate, long settledOrderCount, long customerCount,
                             long automaticCustomerCount, long salesAmountCents,
                             long rechargeAmountCents, long bonusAmountCents, long consumptionAmountCents,
                             long refundAmountCents, long netSalesAmountCents, long cardOpenCents, long cardOpenCount, long cardRenewCents,
                             long rechargeNetCents, long externalOrderCashFlowCents, long cashFlowCents,
                             List<ChannelMetrics> channels, List<RefundOccurrence> refundOccurrences) {}
  public record ChannelMetrics(String code, String name, String methodKind, boolean active, boolean cashCounted,
                               long salesCents, long refundCents, long rechargeCents, long rechargeRefundCents, short sortOrder) {
    public ChannelMetrics(String code, String name, String methodKind, boolean active, boolean cashCounted,
                          long salesCents, long refundCents, short sortOrder) {
      this(code, name, methodKind, active, cashCounted, salesCents, refundCents, 0, 0, sortOrder);
    }
    @JsonProperty("orderNetCents")
    public long orderNetCents() { return salesCents - refundCents; }
    @JsonProperty("rechargeNetCents")
    public long rechargeNetCents() { return rechargeCents - rechargeRefundCents; }
    @JsonProperty("netCents")
    public long netCents() { return orderNetCents() + rechargeNetCents(); }
    ChannelMetrics withSales(long amount) { return new ChannelMetrics(code, name == null || name.isBlank() ? code : name, methodKind, active, cashCounted, amount, refundCents, rechargeCents, rechargeRefundCents, sortOrder); }
    ChannelMetrics withRefunds(long amount) { return new ChannelMetrics(code, name == null || name.isBlank() ? code : name, methodKind, active, cashCounted, salesCents, amount, rechargeCents, rechargeRefundCents, sortOrder); }
    ChannelMetrics withRecharges(long amount) { return new ChannelMetrics(code, name == null || name.isBlank() ? code : name, methodKind, active, cashCounted, salesCents, refundCents, amount, rechargeRefundCents, sortOrder); }
    ChannelMetrics withRechargeRefunds(long amount) { return new ChannelMetrics(code, name == null || name.isBlank() ? code : name, methodKind, active, cashCounted, salesCents, refundCents, rechargeCents, amount, sortOrder); }
  }
  public record RefundOccurrence(UUID id, String refundNo, String orderNo, long amountCents,
                                 OffsetDateTime completedAt, LocalDate refundBusinessDate,
                                 LocalDate originalOrderBusinessDate) {}
  private record OrderTotals(Long settledOrderCount, Long customerCount, Long salesAmountCents) {}
  private record RefundTotals(Long refundAmountCents) {}
  private record WalletTotals(Long rechargeAmountCents, Long bonusAmountCents, Long consumptionDebitCents,
                              Long consumptionRefundCents, Long cardOpenCents, Long cardRenewCents, Long cardOpenCount) {}
  private record NamedAmount(String code, String name, Long amountCents) {}
  private record ChannelDefinition(String code, String name, String methodKind, Boolean active, Boolean cashCounted, Short sortOrder) {}
}
