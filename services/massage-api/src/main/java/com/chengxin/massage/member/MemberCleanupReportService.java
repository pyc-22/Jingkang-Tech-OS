package com.chengxin.massage.member;

import com.chengxin.massage.operations.DailyReportService;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MemberCleanupReportService implements ApplicationRunner {
  private final JdbcClient jdbc;
  private final DailyReportService reports;

  MemberCleanupReportService(JdbcClient jdbc, DailyReportService reports) {
    this.jdbc = jdbc;
    this.reports = reports;
  }

  @Override
  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  public void run(ApplicationArguments args) {
    // Recheck on restart: a failed repair rolls back and is retried, never marked complete early.
    // A targeted Flyway rehearsal before V102 has no reporting metadata yet.
    if (!jdbc.sql("select exists(select 1 from flyway_schema_history where version='102' and success)").query(Boolean.class).single()) return;
    List<Report> affected = jdbc.sql("""
      select r.id,r.store_id,r.business_date from daily_operating_report r
      where exists (
        select 1 from wallet_transaction wt where wt.tenant_id=r.tenant_id
          and wt.store_id=r.store_id and wt.business_date=r.business_date
          and exists(select 1 from wallet_transaction cleared where cleared.tenant_id=wt.tenant_id
            and cleared.member_id=wt.member_id and cleared.report_excluded)
      ) order by r.store_id,r.business_date for update of r
      """).query(Report.class).list();
    for (Report report : affected) refresh(report, null);
    LoggerFactory.getLogger(getClass()).info("Member cleanup report repair checked {} report(s)", affected.size());
  }

  // Match correction/refund lock order: recharge, report, then wallet.
  @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
  public List<Report> lockReports(UUID tenant, UUID member) {
    jdbc.sql("select id from wallet_transaction where tenant_id=:tenant and member_id=:member and transaction_type='RECHARGE' order by id for update")
      .param("tenant", tenant).param("member", member).query(UUID.class).list();
    return jdbc.sql("""
      select r.id,r.store_id,r.business_date from daily_operating_report r where r.tenant_id=:tenant
        and exists(select 1 from wallet_transaction wt where wt.member_id=:member
          and wt.tenant_id=:tenant and wt.store_id=r.store_id and wt.business_date=r.business_date)
      order by r.store_id,r.business_date for update of r
      """).param("tenant", tenant).param("member", member).query(Report.class).list();
  }

  @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
  public void exclude(UUID tenant, UUID member, List<Report> affected, UUID actor) {
    jdbc.sql("""
      update wallet_transaction set report_excluded=true where tenant_id=:tenant and member_id=:member
        and not report_excluded and (transaction_type in ('RECHARGE','BONUS')
          or (transaction_type='ADJUSTMENT' and source in ('RECHARGE_REFUND','RECHARGE_REFUND_BONUS')))
      """).param("tenant", tenant).param("member", member).update();
    for (Report report : affected) refresh(report, actor);
  }

  private void refresh(Report report, UUID actor) {
    DailyReportService.DailyMetrics metrics = reports.daily(report.storeId(), report.businessDate());
    long cancellation = jdbc.sql("""
      select coalesce(sum(r.amount_cents),0) from member_recharge_refund r
      join reporting_wallet_transaction wt on wt.id=r.original_transaction_id
      where r.store_id=:store and r.business_date=:date and r.status='COMPLETED'
      """).param("store", report.storeId()).param("date", report.businessDate()).query(Long.class).single();
    jdbc.sql("""
      with before_row as materialized (select * from daily_operating_report where id=:id),
      changed as (
        update daily_operating_report set daily_cash_flow_cents=:cashFlow,daily_card_sale_cents=:sale,
          daily_card_open_cents=:open,daily_card_renew_cents=:renew,daily_card_cancellation_cents=:cancellation,
          daily_cash_cents=:cash,daily_alipay_cents=:alipay,daily_douyin_cents=:douyin,daily_meituan_cents=:meituan,
          daily_free_order_cents=:free,daily_entertainment_cents=:entertainment,updated_at=now(),version=version+1
        where id=:id and (daily_cash_flow_cents,daily_card_sale_cents,daily_card_open_cents,daily_card_renew_cents,
          daily_card_cancellation_cents,daily_cash_cents,daily_alipay_cents,daily_douyin_cents,daily_meituan_cents,
          daily_free_order_cents,daily_entertainment_cents)
          is distinct from (:cashFlow,:sale,:open,:renew,:cancellation,:cash,:alipay,:douyin,:meituan,:free,:entertainment)
        returning *
      ) insert into member_cleanup_report_repair(id,report_id,tenant_id,store_id,business_date,before_data,after_data,actor_user_id)
        select :repair,c.id,c.tenant_id,c.store_id,c.business_date,to_jsonb(b),to_jsonb(c),:actor
        from changed c join before_row b on b.id=c.id
      """).param("id", report.id()).param("repair", UUID.randomUUID()).param("actor", actor)
      .param("cashFlow", Math.max(0, metrics.cashFlowCents())).param("sale", metrics.rechargeAmountCents())
      .param("open", metrics.cardOpenCents()).param("renew", metrics.cardRenewCents()).param("cancellation", cancellation)
      .param("cash", channel(metrics, "CASH")).param("alipay", channel(metrics, "ALIPAY"))
      .param("douyin", channel(metrics, "DOUYIN")).param("meituan", channel(metrics, "MEITUAN"))
      .param("free", channel(metrics, "FREE_ORDER")).param("entertainment", channel(metrics, "ENTERTAINMENT")).update();
  }

  private long channel(DailyReportService.DailyMetrics metrics, String code) {
    return Math.max(0, metrics.channels().stream().filter(c -> code.equals(c.code())).mapToLong(DailyReportService.ChannelMetrics::netCents).sum());
  }

  record Report(UUID id, UUID storeId, LocalDate businessDate) {}
}
