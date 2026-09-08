package com.chengxin.massage.operations;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Single source for operational daily metrics. All dates are the store business_date;
 * completed refunds therefore belong to the business day on which they were completed.
 */
@Service
public class DailyReportService {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;

  public DailyReportService(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  public DailyMetrics daily(UUID storeId, LocalDate businessDate) {
    OrderTotals orders = jdbc.sql("""
      select count(distinct o.id) filter (where coalesce(o.refund_status,'NONE') <> 'FULL') settled_order_count,
             count(distinct o.id) filter (where coalesce(o.refund_status,'NONE') <> 'FULL') customer_count,
             coalesce(sum(p.amount_cents),0)::bigint sales_amount_cents
      from sales_order o
      left join payment_record p on p.order_id=o.id
      where o.store_id=:store and o.status='SETTLED' and o.paid_cents>0 and o.business_date=:date
        and (not exists(select 1 from sales_order_service_session link where link.order_id=o.id)
          or exists(select 1 from sales_order_service_session link join service_session ss on ss.id=link.service_session_id
                    where link.order_id=o.id and ss.status<>'VOIDED'))
      """).param("store", storeId).param("date", businessDate).query(OrderTotals.class).single();

    RefundTotals refunds = jdbc.sql("""
      select coalesce(sum(total_cents),0)::bigint refund_amount_cents
      from sales_refund where store_id=:store and status='COMPLETED' and business_date=:date
      """).param("store", storeId).param("date", businessDate).query(RefundTotals.class).single();

    WalletTotals wallet = jdbc.sql("""
      with ranked_recharges as (
        select wt.store_id,wt.member_id,wt.business_date,wt.amount_cents,
               row_number() over(partition by wt.tenant_id,wt.member_id order by wt.created_at,wt.id) recharge_number
        from wallet_transaction wt
        where wt.tenant_id=:tenant and wt.transaction_type='RECHARGE'
      )
      select
        coalesce((select sum(wt.amount_cents) from wallet_transaction wt
          where wt.store_id=:store and wt.business_date=:date and wt.transaction_type='RECHARGE'),0)::bigint recharge_amount_cents,
        coalesce((select sum(wt.amount_cents) from wallet_transaction wt
          where wt.store_id=:store and wt.business_date=:date and (wt.transaction_type='BONUS'
            or (wt.transaction_type='ADJUSTMENT' and wt.source='RECHARGE_REFUND_BONUS'))),0)::bigint bonus_amount_cents,
        coalesce((select sum(abs(wt.amount_cents)) from wallet_transaction wt
          where wt.store_id=:store and wt.business_date=:date and wt.transaction_type='CONSUMPTION' and wt.source='ORDER'
            and wt.note ~* '^[0-9a-f-]{36}$'
            and exists(select 1 from sales_order o where o.id=wt.note::uuid and o.store_id=wt.store_id
              and o.status='SETTLED' and o.paid_cents>0
              and (not exists(select 1 from sales_order_service_session link where link.order_id=o.id)
                or exists(select 1 from sales_order_service_session link join service_session ss on ss.id=link.service_session_id
                          where link.order_id=o.id and ss.status<>'VOIDED')))),0)::bigint consumption_debit_cents,
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
      .mapToLong(ChannelMetrics::netCents).sum();
    long rechargeNet = wallet.rechargeAmountCents()
      + jdbc.sql("select coalesce(sum(amount_cents),0)::bigint from wallet_transaction where store_id=:store and transaction_type='ADJUSTMENT' and source='RECHARGE_REFUND' and business_date=:date")
        .param("store", storeId).param("date", businessDate).query(Long.class).single();
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
    return new DailyMetrics(businessDate, orders.settledOrderCount(), customerCount, orders.customerCount(), netSales,
      wallet.rechargeAmountCents(), wallet.bonusAmountCents(), consumption, refunds.refundAmountCents(), netSales,
      wallet.cardOpenCents(), wallet.cardOpenCount(), wallet.cardRenewCents(), rechargeNet, externalCash, cashFlow,
      channels, refundOccurrences);
  }

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
        and (not exists(select 1 from sales_order_service_session link where link.order_id=o.id)
          or exists(select 1 from sales_order_service_session link join service_session ss on ss.id=link.service_session_id
                    where link.order_id=o.id and ss.status<>'VOIDED'))
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
                               long salesCents, long refundCents, short sortOrder) {
    public long netCents() { return salesCents - refundCents; }
    ChannelMetrics withSales(long amount) { return new ChannelMetrics(code, name == null || name.isBlank() ? code : name, methodKind, active, cashCounted, amount, refundCents, sortOrder); }
    ChannelMetrics withRefunds(long amount) { return new ChannelMetrics(code, name == null || name.isBlank() ? code : name, methodKind, active, cashCounted, salesCents, amount, sortOrder); }
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
