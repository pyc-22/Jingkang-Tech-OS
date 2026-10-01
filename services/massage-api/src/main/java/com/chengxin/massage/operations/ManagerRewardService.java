package com.chengxin.massage.operations;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

/** Computes the four manager reward metrics from the same operational sources as the reports. */
@Service
public class ManagerRewardService {
  static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final DailyReportService dailyReports;
  private final ExpenseAttachmentStorage attachments;
  private final BusinessClockService businessClock;

  ManagerRewardService(JdbcClient jdbc, DailyReportService dailyReports, ExpenseAttachmentStorage attachments,
                       BusinessClockService businessClock) {
    this.jdbc = jdbc;
    this.dailyReports = dailyReports;
    this.attachments = attachments;
    this.businessClock = businessClock;
  }

  @Transactional(readOnly = true)
  public RewardSnapshot daily(UUID storeId, LocalDate date) {
    Optional<RewardSnapshot> locked = lockedDay(storeId, date);
    return locked.orElseGet(() -> calculate(storeId, date));
  }

  @Transactional(readOnly = true)
  public MonthSnapshot month(UUID storeId, YearMonth month) {
    Optional<LockHeader> lock = lockHeader(storeId, month);
    List<RewardSnapshot> rows = lock.map(value -> lockedRows(storeId, month, value.id()))
        .orElseGet(() -> calculateRows(storeId, month));
    return monthResult(storeId, month, lock.isPresent(), lock.map(LockHeader::lockedAt).orElse(null), rows);
  }

  @Transactional(readOnly = true)
  public List<YueOrder> yueOrders(UUID storeId, LocalDate date) {
    return jdbc.sql("""
      select o.id order_id,o.order_no,o.member_id,m.name member_name,m.phone member_phone,
             o.paid_cents,o.refund_status,
             exists(select 1 from manager_yue_record r where r.tenant_id=o.tenant_id and r.store_id=o.store_id and r.order_id=o.id and r.active) submitted
      from sales_order o left join member m on m.id=o.member_id
      where o.tenant_id=:tenant and o.store_id=:store and o.business_date=:date
        and o.status='SETTLED' and o.paid_cents>0 and coalesce(o.refund_status,'NONE')<>'FULL'
      order by o.settled_at desc nulls last,o.id
      """).param("tenant", TENANT_ID).param("store", storeId).param("date", date).query(YueOrder.class).list();
  }

  @Transactional(readOnly = true)
  public List<ManagerCandidate> managerCandidates(UUID storeId, LocalDate date) {
    return candidates(storeId, date).stream()
        .map(item -> new ManagerCandidate(item.userId(), item.name(), item.attendanceStatus(), item.primaryManager()))
        .toList();
  }

  @Transactional(readOnly = true)
  public List<YueRecord> yueRecords(UUID storeId, LocalDate date, boolean includeInactive) {
    String activeClause = includeInactive ? "" : " and r.active";
    return jdbc.sql("""
      select r.id,r.store_id,r.business_date,r.order_id,o.order_no,r.member_id,
             r.manager_user_id,r.manager_name_snapshot,r.customer_name_snapshot,r.customer_phone_snapshot,
             r.submitted_at,r.replaced_at,r.replacement_note,r.active,
             a.id attachment_id,a.original_filename,a.content_type,a.file_size_bytes
      from manager_yue_record r join sales_order o on o.id=r.order_id
      left join manager_yue_attachment a on a.yue_record_id=r.id and a.active
      where r.tenant_id=:tenant and r.store_id=:store and r.business_date=:date""" + activeClause + " order by r.submitted_at desc,r.id")
      .param("tenant", TENANT_ID).param("store", storeId).param("date", date).query(YueRecord.class).list();
  }

  @Transactional(readOnly = true)
  public List<YueRecord> yueRecords(UUID storeId, LocalDate from, LocalDate to, boolean includeInactive) {
    String activeClause = includeInactive ? "" : " and r.active";
    return jdbc.sql("""
      select r.id,r.store_id,r.business_date,r.order_id,o.order_no,r.member_id,
             r.manager_user_id,r.manager_name_snapshot,r.customer_name_snapshot,r.customer_phone_snapshot,
             r.submitted_at,r.replaced_at,r.replacement_note,r.active,
             a.id attachment_id,a.original_filename,a.content_type,a.file_size_bytes
      from manager_yue_record r join sales_order o on o.id=r.order_id
      left join manager_yue_attachment a on a.yue_record_id=r.id and a.active
      where r.tenant_id=:tenant and r.store_id=:store and r.business_date between :from and :to""" + activeClause + " order by r.business_date desc,r.submitted_at desc,r.id")
      .param("tenant", TENANT_ID).param("store", storeId).param("from", from).param("to", to).query(YueRecord.class).list();
  }

  @Transactional
  public YueRecord createYue(UUID storeId, UUID actorId, UUID orderId, MultipartFile file) {
    lockRewardStore(storeId);
    OrderCandidate order = order(storeId, orderId);
    requireCurrentBusinessDate(storeId, order.businessDate());
    requireMonthUnlocked(storeId, order.businessDate());
    ManagerIdentity manager = requireAssignedManager(storeId, order.businessDate());
    UUID id = UUID.randomUUID();
    try {
      jdbc.sql("""
        insert into manager_yue_record(id,tenant_id,store_id,manager_user_id,manager_name_snapshot,business_date,
          order_id,member_id,customer_name_snapshot,customer_phone_snapshot)
        values(:id,:tenant,:store,:manager,:managerName,:date,:order,:member,:name,:phone)
        """).param("id", id).param("tenant", TENANT_ID).param("store", storeId)
          .param("manager", manager.userId()).param("managerName", manager.name()).param("date", order.businessDate())
          .param("order", order.orderId()).param("member", order.memberId()).param("name", order.customerName())
          .param("phone", order.customerPhone()).update();
      storeAttachment(storeId, id, actorId, file, order.businessDate());
    } catch (DuplicateKeyException exception) {
      throw conflict("该订单或会员当天已提交约客记录");
    }
    return findYue(storeId, id);
  }

  @Transactional
  public YueRecord updateYue(UUID storeId, UUID actorId, UUID id, UUID orderId, String customerName,
                             String customerPhone, String note, MultipartFile file) {
    lockRewardStore(storeId);
    YueRecord current = findYue(storeId, id);
    requireCurrentBusinessDate(storeId, current.businessDate());
    requireMonthUnlocked(storeId, current.businessDate());
    ManagerIdentity manager = requireAssignedManager(storeId, current.businessDate());
    if (!manager.userId().equals(current.managerUserId())) throw conflict("当前约客记录不属于本店店长");
    OrderCandidate order = order(storeId, orderId == null ? current.orderId() : orderId);
    requireCurrentBusinessDate(storeId, order.businessDate());
    if (!order.businessDate().equals(current.businessDate())) throw badRequest("只能更正同一营业日的约客记录");
    if (!order.orderId().equals(current.orderId()) || !same(customerName, current.customerNameSnapshot()) || !same(customerPhone, current.customerPhoneSnapshot())) {
      jdbc.sql("""
        insert into manager_yue_record_revision(id,tenant_id,store_id,yue_record_id,previous_order_id,previous_member_id,
          previous_customer_name_snapshot,previous_customer_phone_snapshot,changed_by_user_id,note)
        values(:id,:tenant,:store,:record,:order,:member,:name,:phone,:actor,:note)
        """).param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("record", id)
          .param("order", current.orderId()).param("member", current.memberId()).param("name", current.customerNameSnapshot())
          .param("phone", current.customerPhoneSnapshot()).param("actor", actorId).param("note", note).update();
    }
    try {
      jdbc.sql("""
        update manager_yue_record set order_id=:order,member_id=:member,customer_name_snapshot=:name,
          customer_phone_snapshot=:phone,replaced_at=case when order_id<>:order then now() else replaced_at end,
          replaced_by_user_id=case when order_id<>:order then :actor else replaced_by_user_id end,
          replacement_note=coalesce(:note,replacement_note),updated_at=now(),version=version+1
        where id=:id and store_id=:store and active
        """).param("order", order.orderId()).param("member", order.memberId()).param("name", coalesce(customerName, order.customerName()))
          .param("phone", coalesce(customerPhone, order.customerPhone())).param("actor", actorId).param("note", note)
          .param("id", id).param("store", storeId).update();
      if (file != null && !file.isEmpty()) {
        jdbc.sql("update manager_yue_attachment set active=false,updated_at=now(),version=version+1 where yue_record_id=:record and active")
            .param("record", id).update();
        storeAttachment(storeId, id, actorId, file, current.businessDate());
      }
    } catch (DuplicateKeyException exception) {
      throw conflict("该订单或会员当天已存在其他约客记录");
    }
    return findYue(storeId, id);
  }

  @Transactional(readOnly = true)
  public AttachmentDownload attachment(UUID storeId, UUID id, boolean original) {
    AttachmentRow row = jdbc.sql("select a.original_storage_key,a.watermarked_storage_key,a.original_filename,a.content_type from manager_yue_attachment a join manager_yue_record r on r.id=a.yue_record_id where a.tenant_id=:tenant and r.tenant_id=:tenant and a.yue_record_id=:id and a.store_id=:store and a.active")
        .param("tenant", TENANT_ID).param("id", id).param("store", storeId).query(AttachmentRow.class).optional()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "约客凭证不存在"));
    return new AttachmentDownload(attachments.read(original ? row.originalStorageKey() : row.watermarkedStorageKey()), row.contentType(), row.originalFilename());
  }

  @Transactional
  public MonthSnapshot lockMonth(UUID storeId, UUID actorId, YearMonth month) {
    lockRewardStore(storeId);
    Optional<LockHeader> existing = lockHeader(storeId, month);
    if (existing.isPresent()) return this.month(storeId, month);
    UUID lockId = UUID.randomUUID();
    int inserted = jdbc.sql("insert into manager_reward_month_lock(id,tenant_id,store_id,reward_month,locked_by_user_id) values(:id,:tenant,:store,:month,:actor) on conflict (store_id,reward_month) do nothing")
        .param("id", lockId).param("tenant", TENANT_ID).param("store", storeId).param("month", month.atDay(1)).param("actor", actorId).update();
    if (inserted == 0) return this.month(storeId, month);
    for (LocalDate date = month.atDay(1); !date.isAfter(month.atEndOfMonth()); date = date.plusDays(1)) {
      RewardSnapshot row = calculate(storeId, date);
      jdbc.sql("""
        insert into manager_reward_month_lock_day(id,lock_id,tenant_id,store_id,business_date,manager_user_id,
          manager_name_snapshot,cash_flow_cents,cash_flow_reward_cents,yue_count,yue_reward_cents,big_project_count,
          big_project_reward_cents,recharge_count,recharge_reward_cents,total_reward_cents,attendance_status,on_duty_day)
        values(:id,:lock,:tenant,:store,:date,:manager,:managerName,:cashFlow,:cashReward,:yue,:yueReward,:big,
          :bigReward,:recharge,:rechargeReward,:total,:attendance,:onDuty)
        """).param("id", UUID.randomUUID()).param("lock", lockId).param("tenant", TENANT_ID).param("store", storeId)
          .param("date", row.businessDate()).param("manager", row.managerUserId()).param("managerName", row.managerName())
          .param("cashFlow", row.cashFlowCents()).param("cashReward", row.cashFlowRewardCents()).param("yue", row.yueCount())
          .param("yueReward", row.yueRewardCents()).param("big", row.bigProjectCount()).param("bigReward", row.bigProjectRewardCents())
          .param("recharge", row.rechargeCount()).param("rechargeReward", row.rechargeRewardCents()).param("total", row.totalRewardCents())
          .param("attendance", row.attendanceStatus()).param("onDuty", row.onDutyDay()).update();
    }
    return this.month(storeId, month);
  }

  @Transactional
  public Assignment assign(UUID storeId, UUID actorId, LocalDate date, UUID managerUserId, String note) {
    lockRewardStore(storeId);
    requireMonthUnlocked(storeId, date);
    ManagerIdentity manager = candidate(storeId, date, managerUserId)
        .orElseThrow(() -> badRequest("该员工不是本店已关联账号的有效店长"));
    jdbc.sql("""
      insert into manager_reward_day_assignment(id,tenant_id,store_id,business_date,manager_user_id,manager_name_snapshot,
        attendance_status,assigned_by_user_id,note)
      values(:id,:tenant,:store,:date,:manager,:name,:status,:actor,:note)
      on conflict(store_id,business_date) do update set manager_user_id=excluded.manager_user_id,
        manager_name_snapshot=excluded.manager_name_snapshot,attendance_status=excluded.attendance_status,
        assigned_by_user_id=excluded.assigned_by_user_id,assigned_at=now(),note=excluded.note,
        updated_at=now(),version=manager_reward_day_assignment.version+1
      """).param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("date", date)
        .param("manager", manager.userId()).param("name", manager.name()).param("status", manager.attendanceStatus())
        .param("actor", actorId).param("note", note).update();
    return jdbc.sql("select business_date,manager_user_id,manager_name_snapshot,attendance_status,note from manager_reward_day_assignment where tenant_id=:tenant and store_id=:store and business_date=:date")
        .param("tenant", TENANT_ID).param("store", storeId).param("date", date).query(Assignment.class).single();
  }

  @Transactional
  public ManagerCandidate setPrimaryManager(UUID storeId, UUID managerUserId) {
    lockRewardStore(storeId);
    ManagerIdentity manager = candidate(storeId, businessClock.currentBusinessDate(storeId), managerUserId)
        .orElseThrow(() -> badRequest("该员工不是本店已关联账号的有效店长"));
    jdbc.sql("update store set primary_manager_user_id=:manager,updated_at=now(),version=version+1 where id=:store and tenant_id=:tenant")
        .param("manager", managerUserId).param("store", storeId).param("tenant", TENANT_ID).update();
    return new ManagerCandidate(manager.userId(), manager.name(), manager.attendanceStatus(), true);
  }

  private void storeAttachment(UUID storeId, UUID recordId, UUID actorId, MultipartFile file, LocalDate date) {
    if (file == null || file.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请上传约客截图");
    ExpenseAttachmentStorage.StoredImage stored = attachments.storeManagerYueImage(TENANT_ID, storeId, recordId, file, "靖康约客 " + date);
    try {
      jdbc.sql("""
        insert into manager_yue_attachment(id,yue_record_id,tenant_id,store_id,original_storage_key,watermarked_storage_key,
          original_filename,content_type,file_size_bytes,sha256,watermarked_sha256,uploaded_by_user_id)
        values(:id,:record,:tenant,:store,:original,:watermarked,:name,:type,:size,:sha,:watermarkedSha,:actor)
        """).param("id", UUID.randomUUID()).param("record", recordId).param("tenant", TENANT_ID).param("store", storeId)
          .param("original", stored.originalStorageKey()).param("watermarked", stored.watermarkedStorageKey())
          .param("name", stored.originalFilename()).param("type", stored.contentType()).param("size", stored.fileSizeBytes())
          .param("sha", stored.sha256()).param("watermarkedSha", stored.watermarkedSha256()).param("actor", actorId).update();
    } catch (RuntimeException exception) {
      attachments.delete(stored.originalStorageKey());
      attachments.delete(stored.watermarkedStorageKey());
      throw exception;
    }
  }

  private void requireCurrentBusinessDate(UUID storeId, LocalDate date) {
    if (!businessClock.currentBusinessDate(storeId).equals(date)) {
      throw badRequest("约客只能提交或更正当前营业日订单");
    }
  }

  private void requireMonthUnlocked(UUID storeId, LocalDate date) {
    if (lockHeader(storeId, YearMonth.from(date)).isPresent()) {
      throw conflict("该营业月已锁定，绩效数据不可更改");
    }
  }

  private void lockRewardStore(UUID storeId) {
    jdbc.sql("select id from store where id=:store and tenant_id=:tenant for update")
        .param("store", storeId).param("tenant", TENANT_ID).query(UUID.class).single();
  }

  private RewardSnapshot calculate(UUID storeId, LocalDate date) {
    DailyReportService.DailyMetrics report = dailyReports.daily(storeId, date);
    ManagerIdentity manager = resolveManager(storeId, date).orElse(null);
    long yue = countYue(storeId, date);
    long big = countBigProjects(storeId, date);
    long recharge = countRecharges(storeId, date);
    RewardTierService.Evaluation cash = RewardTierService.cashFlow(report.cashFlowCents());
    RewardTierService.Evaluation yueReward = RewardTierService.yue(yue);
    RewardTierService.Evaluation bigReward = RewardTierService.bigProject(big);
    RewardTierService.Evaluation rechargeReward = RewardTierService.recharge(recharge);
    boolean onDuty = manager != null;
    long total = onDuty ? cash.rewardCents() + yueReward.rewardCents() + bigReward.rewardCents() + rechargeReward.rewardCents() : 0;
    return new RewardSnapshot(storeId, storeName(storeId), date, manager == null ? null : manager.userId(),
        manager == null ? null : manager.name(), manager == null ? null : manager.attendanceStatus(), onDuty,
        report.cashFlowCents(), onDuty ? cash.rewardCents() : 0, cash.tierLabel(), yue, onDuty ? yueReward.rewardCents() : 0,
        yueReward.tierLabel(), big, onDuty ? bigReward.rewardCents() : 0, bigReward.tierLabel(), recharge,
        onDuty ? rechargeReward.rewardCents() : 0, rechargeReward.tierLabel(), total, false);
  }

  private long countYue(UUID storeId, LocalDate date) {
    return jdbc.sql("select count(*) from manager_yue_record where tenant_id=:tenant and store_id=:store and business_date=:date and active")
        .param("tenant", TENANT_ID).param("store", storeId).param("date", date).query(Long.class).single();
  }

  private long countBigProjects(UUID storeId, LocalDate date) {
    return jdbc.sql("""
      select
        (select count(distinct ss.id) from service_session ss join sales_order_service_session link on link.service_session_id=ss.id
          join sales_order o on o.id=link.order_id
         where ss.tenant_id=:tenant and ss.store_id=:store and ss.business_date=:date and ss.status='COMPLETED'
           and ss.service_price_cents>=39900 and o.status='SETTLED' and o.business_date=:date and coalesce(o.refund_status,'NONE')<>'FULL')
        +
        (select count(distinct extension.id) from service_session_extension extension
          join service_session ss on ss.id=extension.service_session_id
          join sales_order_service_session link on link.service_session_id=ss.id
          join sales_order o on o.id=link.order_id
         where extension.tenant_id=:tenant and extension.store_id=:store and ss.tenant_id=:tenant and ss.business_date=:date
           and ss.status='COMPLETED'
           and extension.service_price_cents>=39900 and o.status='SETTLED' and o.business_date=:date
           and coalesce(o.refund_status,'NONE')<>'FULL'
           and not exists(select 1 from service_session_extension_cancel_log cancel
                          where cancel.tenant_id=:tenant and cancel.store_id=extension.store_id and cancel.extension_id=extension.id)) big_count
      """).param("tenant", TENANT_ID).param("store", storeId).param("date", date).query(Long.class).single();
  }

  private long countRecharges(UUID storeId, LocalDate date) {
    return jdbc.sql("""
      select count(*) from reporting_wallet_transaction wt
      where wt.tenant_id=:tenant and wt.store_id=:store and wt.business_date=:date and wt.transaction_type='RECHARGE'
        and coalesce((select sum(refund.amount_cents) from member_recharge_refund refund
                      where refund.tenant_id=wt.tenant_id and refund.store_id=wt.store_id
                        and refund.original_transaction_id=wt.id and refund.status='COMPLETED'),0)
            < coalesce(wt.corrected_amount_cents,wt.amount_cents)
      """).param("tenant", TENANT_ID).param("store", storeId).param("date", date).query(Long.class).single();
  }

  private List<RewardSnapshot> calculateRows(UUID storeId, YearMonth month) {
    List<RewardSnapshot> rows = new ArrayList<>();
    for (LocalDate date = month.atDay(1); !date.isAfter(month.atEndOfMonth()); date = date.plusDays(1)) rows.add(calculate(storeId, date));
    return rows;
  }

  private List<RewardSnapshot> lockedRows(UUID storeId, YearMonth month, UUID lockId) {
    return jdbc.sql("""
      select :store store_id,s.name store_name,d.business_date,d.manager_user_id,d.manager_name_snapshot manager_name,
        d.attendance_status,d.on_duty_day,d.cash_flow_cents,d.cash_flow_reward_cents,d.yue_count,d.yue_reward_cents,
        d.big_project_count,d.big_project_reward_cents,d.recharge_count,d.recharge_reward_cents,d.total_reward_cents
      from manager_reward_month_lock_day d join store s on s.id=d.store_id
      where d.tenant_id=:tenant and d.lock_id=:lock and d.store_id=:store order by d.business_date
      """).param("tenant", TENANT_ID).param("store", storeId).param("lock", lockId).query(LockedRewardRow.class).list().stream().map(this::snapshot).toList();
  }

  private Optional<RewardSnapshot> lockedDay(UUID storeId, LocalDate date) {
    return jdbc.sql("""
      select s.id store_id,s.name store_name,d.business_date,d.manager_user_id,d.manager_name_snapshot manager_name,
        d.attendance_status,d.on_duty_day,d.cash_flow_cents,d.cash_flow_reward_cents,d.yue_count,d.yue_reward_cents,
        d.big_project_count,d.big_project_reward_cents,d.recharge_count,d.recharge_reward_cents,d.total_reward_cents
      from manager_reward_month_lock l join manager_reward_month_lock_day d on d.lock_id=l.id join store s on s.id=d.store_id
      where l.tenant_id=:tenant and d.tenant_id=:tenant and l.store_id=:store and l.reward_month=:month and d.business_date=:date
      """).param("tenant", TENANT_ID).param("store", storeId).param("month", date.withDayOfMonth(1)).param("date", date).query(LockedRewardRow.class).optional().map(this::snapshot);
  }

  private RewardSnapshot snapshot(LockedRewardRow row) {
    RewardTierService.Evaluation cash = RewardTierService.cashFlow(row.cashFlowCents());
    RewardTierService.Evaluation yue = RewardTierService.yue(row.yueCount());
    RewardTierService.Evaluation big = RewardTierService.bigProject(row.bigProjectCount());
    RewardTierService.Evaluation recharge = RewardTierService.recharge(row.rechargeCount());
    return new RewardSnapshot(row.storeId(), row.storeName(), row.businessDate(), row.managerUserId(), row.managerName(), row.attendanceStatus(),
        row.onDutyDay(), row.cashFlowCents(), row.cashFlowRewardCents(), cash.tierLabel(), row.yueCount(), row.yueRewardCents(), yue.tierLabel(),
        row.bigProjectCount(), row.bigProjectRewardCents(), big.tierLabel(), row.rechargeCount(), row.rechargeRewardCents(), recharge.tierLabel(), row.totalRewardCents(), true);
  }

  private MonthSnapshot monthResult(UUID storeId, YearMonth month, boolean locked, java.time.OffsetDateTime lockedAt, List<RewardSnapshot> rows) {
    String name = rows.isEmpty() ? storeName(storeId) : rows.getFirst().storeName();
    return new MonthSnapshot(storeId, name, month, locked, lockedAt, rows,
        rows.stream().mapToLong(RewardSnapshot::cashFlowCents).sum(), rows.stream().mapToLong(RewardSnapshot::yueCount).sum(),
        rows.stream().mapToLong(RewardSnapshot::bigProjectCount).sum(), rows.stream().mapToLong(RewardSnapshot::rechargeCount).sum(),
        rows.stream().mapToLong(RewardSnapshot::totalRewardCents).sum());
  }

  private Optional<LockHeader> lockHeader(UUID storeId, YearMonth month) {
    return jdbc.sql("select id,locked_at from manager_reward_month_lock where tenant_id=:tenant and store_id=:store and reward_month=:month")
        .param("tenant", TENANT_ID).param("store", storeId).param("month", month.atDay(1)).query(LockHeader.class).optional();
  }

  private Optional<ManagerIdentity> resolveManager(UUID storeId, LocalDate date) {
    UUID assignedUserId = jdbc.sql("select manager_user_id from manager_reward_day_assignment where tenant_id=:tenant and store_id=:store and business_date=:date")
        .param("tenant", TENANT_ID).param("store", storeId).param("date", date).query(UUID.class).optional().orElse(null);
    return preferredManager(candidates(storeId, date), assignedUserId);
  }

  private ManagerIdentity requireAssignedManager(UUID storeId, LocalDate date) {
    return resolveManager(storeId, date).orElseThrow(() -> conflict(candidates(storeId, date).isEmpty()
        ? "本店未配置有效店长，请联系管理员在门店/员工配置中补配店长并关联账号"
        : "本店有多位店长，请先指定主店长或当天归属"));
  }

  static Optional<ManagerIdentity> preferredManager(List<ManagerIdentity> candidates, UUID assignedUserId) {
    Optional<ManagerIdentity> assigned = candidates.stream().filter(item -> item.userId().equals(assignedUserId)).findFirst();
    if (assigned.isPresent()) return assigned;
    Optional<ManagerIdentity> primary = candidates.stream().filter(ManagerIdentity::primaryManager).findFirst();
    return primary.isPresent() ? primary : candidates.size() == 1 ? Optional.of(candidates.getFirst()) : Optional.empty();
  }

  private List<ManagerIdentity> candidates(UUID storeId, LocalDate date) {
    return jdbc.sql("""
      select link.user_id,e.full_name name,
        case when a.status in ('PRESENT','LATE','COMPLETED','LEFT_EARLY') then a.status else 'NOT_REQUIRED' end attendance_status,
        coalesce(s.primary_manager_user_id=link.user_id,false) primary_manager
      from employee_user_link link join employee e on e.id=link.employee_id and e.tenant_id=:tenant
      join employee_store_assignment assignment on assignment.tenant_id=:tenant and assignment.employee_id=e.id and assignment.store_id=:store
        and assignment.position_type='STORE_MANAGER' and assignment.active and assignment.employment_status='ACTIVE'
      join store s on s.id=assignment.store_id and s.tenant_id=:tenant
      join app_user u on u.id=link.user_id and u.active
      join user_store_scope scope on scope.user_id=u.id and scope.store_id=:store
      left join lateral (select attendance.status from employee_attendance attendance
        where attendance.tenant_id=:tenant and attendance.employee_id=e.id and attendance.store_id=:store
          and attendance.attendance_date=:date order by attendance.updated_at desc limit 1) a on true
      where e.active and e.employment_status='ACTIVE'
      order by e.full_name,link.user_id
      """)
      .param("tenant", TENANT_ID).param("store", storeId).param("date", date).query(ManagerIdentity.class).list();
  }

  private Optional<ManagerIdentity> candidate(UUID storeId, LocalDate date, UUID userId) {
    return candidates(storeId, date).stream().filter(item -> item.userId().equals(userId)).findFirst();
  }

  private OrderCandidate order(UUID storeId, UUID orderId) {
    if (orderId == null) throw badRequest("请选择订单");
    return jdbc.sql("""
      select o.id order_id,o.business_date,o.member_id,m.name customer_name,m.phone customer_phone
      from sales_order o left join member m on m.id=o.member_id
      where o.tenant_id=:tenant and o.store_id=:store and o.id=:order and o.status='SETTLED' and o.paid_cents>0
        and coalesce(o.refund_status,'NONE')<>'FULL'
      """).param("tenant", TENANT_ID).param("store", storeId).param("order", orderId).query(OrderCandidate.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "订单不存在或不可约客"));
  }

  private YueRecord findYue(UUID storeId, UUID id) {
    return jdbc.sql("""
      select r.id,r.store_id,r.business_date,r.order_id,o.order_no,r.member_id,
             r.manager_user_id,r.manager_name_snapshot,r.customer_name_snapshot,r.customer_phone_snapshot,
             r.submitted_at,r.replaced_at,r.replacement_note,r.active,
             a.id attachment_id,a.original_filename,a.content_type,a.file_size_bytes
      from manager_yue_record r join sales_order o on o.id=r.order_id
      left join manager_yue_attachment a on a.yue_record_id=r.id and a.active
      where r.tenant_id=:tenant and r.store_id=:store and r.id=:id
      """).param("tenant", TENANT_ID).param("store", storeId).param("id", id).query(YueRecord.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "约客记录不存在"));
  }
  private String storeName(UUID storeId) { return jdbc.sql("select name from store where id=:store and tenant_id=:tenant").param("store", storeId).param("tenant", TENANT_ID).query(String.class).single(); }
  private static String coalesce(String value, String fallback) { return value == null || value.isBlank() ? fallback : value; }
  private static boolean same(String left, String right) { return java.util.Objects.equals(coalesce(left, ""), coalesce(right, "")); }
  private static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }
  private static ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }

  public record RewardSnapshot(UUID storeId, String storeName, LocalDate businessDate, UUID managerUserId, String managerName,
      String attendanceStatus, boolean onDutyDay, long cashFlowCents, long cashFlowRewardCents, String cashFlowTierLabel,
      long yueCount, long yueRewardCents, String yueTierLabel, long bigProjectCount, long bigProjectRewardCents,
      String bigProjectTierLabel, long rechargeCount, long rechargeRewardCents, String rechargeTierLabel, long totalRewardCents, boolean locked) {}
  public record MonthSnapshot(UUID storeId, String storeName, YearMonth rewardMonth, boolean locked, java.time.OffsetDateTime lockedAt,
      List<RewardSnapshot> rows, long cashFlowCents, long yueCount, long bigProjectCount, long rechargeCount, long totalRewardCents) {}
  public record YueOrder(UUID orderId, String orderNo, UUID memberId, String memberName, String memberPhone, long paidCents, String refundStatus, boolean submitted) {}
  public record ManagerCandidate(UUID userId, String name, String attendanceStatus, boolean isPrimary) {}
  public record YueRecord(UUID id, UUID storeId, LocalDate businessDate, UUID orderId, String orderNo, UUID memberId,
      UUID managerUserId, String managerNameSnapshot, String customerNameSnapshot, String customerPhoneSnapshot,
      java.time.OffsetDateTime submittedAt, java.time.OffsetDateTime replacedAt, String replacementNote, boolean active,
      UUID attachmentId, String originalFilename, String contentType, Long fileSizeBytes) {}
  public record Assignment(LocalDate businessDate, UUID managerUserId, String managerNameSnapshot, String attendanceStatus, String note) {}
  public record AttachmentDownload(byte[] bytes, String contentType, String filename) {}
  record ManagerIdentity(UUID userId, String name, String attendanceStatus, boolean primaryManager) {}
  private record OrderCandidate(UUID orderId, LocalDate businessDate, UUID memberId, String customerName, String customerPhone) {}
  private record LockHeader(UUID id, java.time.OffsetDateTime lockedAt) {}
  private record AttachmentRow(String originalStorageKey, String watermarkedStorageKey, String originalFilename, String contentType) {}
  private record LockedRewardRow(UUID storeId, String storeName, LocalDate businessDate, UUID managerUserId, String managerName,
      String attendanceStatus, boolean onDutyDay, long cashFlowCents, long cashFlowRewardCents, long yueCount, long yueRewardCents,
      long bigProjectCount, long bigProjectRewardCents, long rechargeCount, long rechargeRewardCents, long totalRewardCents) {}
}
