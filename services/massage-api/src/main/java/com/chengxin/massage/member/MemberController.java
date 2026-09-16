package com.chengxin.massage.member;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.BusinessClockService;

@RestController
@RequestMapping("/api/v1/members")
@CrossOrigin(origins = "*")
public class MemberController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final AdminSessionService adminSessions;
  private final StoreContextService storeContext;
  private final AuditService audits;
  private final BusinessClockService businessClock;

  MemberController(JdbcClient jdbc, AdminSessionService adminSessions, StoreContextService storeContext, AuditService audits, BusinessClockService businessClock) {
    this.jdbc = jdbc;
    this.adminSessions = adminSessions;
    this.storeContext = storeContext;
    this.audits = audits;
    this.businessClock = businessClock;
  }

  @GetMapping
  List<Member> list(@RequestParam(defaultValue = "") String query,
                    @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                    @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql("select m.id,m.code,m.name,m.phone,w.balance_cents from member m join member_wallet w on w.member_id=m.id where m.tenant_id=:tenant and m.active=true and (m.name ilike :q or m.phone ilike :q or m.code ilike :q) order by m.created_at desc limit 30")
      .param("tenant", TENANT_ID).param("q", "%" + query + "%").query(Member.class).list();
  }

  @GetMapping("/center")
  List<MemberCenterRow> center(@RequestParam(defaultValue = "") String query,
                                @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql(memberCenterSql(""))
      .param("store", storeId).param("tenant", TENANT_ID).param("q", "%" + query.trim() + "%")
      .query(MemberCenterRow.class).list();
  }

  @GetMapping("/{id}/profile")
  MemberProfile profile(@PathVariable UUID id,
                        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                        @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    MemberCenterRow member = jdbc.sql(memberCenterSql(" and m.id=:member"))
      .param("store", storeId).param("tenant", TENANT_ID).param("q", "%").param("member", id)
      .query(MemberCenterRow.class).optional().orElseThrow(() -> notFound("Member not found"));
    return new MemberProfile(member, memberTransactions(storeId, id));
  }

  @PostMapping
  @Transactional
  MemberWriteResult create(@Valid @RequestBody CreateInput input,
                @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    String name = input.name().trim();
    String phone = input.phone().trim();
    ExistingMember existing = existingMemberByPhoneForUpdate(phone);
    if (existing != null) {
      if (existing.active()) throw conflict("该手机号已经是启用会员");
      Member before = member(existing.id());
      reactivate(existing.id(), name);
      Member restored = member(existing.id());
      audits.record(authorization, storeId, "MEMBER", "MEMBER_REACTIVATED", "member", existing.id(),
        "恢复归档会员档案", before, restored);
      return writeResult(restored, true);
    }
    UUID member = UUID.randomUUID();
    UUID wallet = UUID.randomUUID();
    String code = "M" + System.currentTimeMillis();
    jdbc.sql("insert into member(id,tenant_id,registered_store_id,code,name,phone) values(:id,:tenant,:store,:code,:name,:phone)")
      .param("id", member).param("tenant", TENANT_ID).param("store", storeId).param("code", code).param("name", name).param("phone", phone).update();
    jdbc.sql("insert into member_wallet(id,tenant_id,opened_store_id,member_id) values(:id,:tenant,:store,:member)")
      .param("id", wallet).param("tenant", TENANT_ID).param("store", storeId).param("member", member).update();
    Member created = member(member);
    audits.record(authorization, storeId, "MEMBER", "MEMBER_CREATED", "member", member, "新增会员", null, created);
    return writeResult(created, false);
  }

  @PostMapping("/open-card")
  @Transactional
  MemberWriteResult openCard(@Valid @RequestBody OpenCardInput input,
                  @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                  @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    String name = input.name().trim();
    String phone = input.phone().trim();
    ExistingMember existing = existingMemberByPhoneForUpdate(phone);
    if (existing != null && existing.active()) throw conflict("该手机号已经是启用会员");
    if (input.bonusCents() > 0 && input.amountCents() == 0) throw bad("Bonus requires a paid recharge");
    PaymentMethod paymentMethod = null;
    Technician technician = null;
    Employee employee = null;
    if (input.amountCents() > 0) {
      if (input.paymentMethod() == null || input.paymentMethod().isBlank()) throw bad("Payment method is required");
      paymentMethod = paymentMethod(storeId, input.paymentMethod());
      if (!"EXTERNAL".equals(paymentMethod.methodKind())) throw bad("Member balance cannot be used for card opening");
      technician = input.technicianId() == null ? null : technician(storeId, input.technicianId());
      employee = input.employeeId() == null ? null : employee(storeId, input.employeeId());
    }

    boolean reactivated = existing != null;
    UUID memberId;
    Wallet wallet;
    Member before = null;
    if (reactivated) {
      memberId = existing.id();
      before = member(memberId);
      reactivate(memberId, name);
      wallet = wallet(memberId);
    } else {
      memberId = UUID.randomUUID();
      UUID walletId = UUID.randomUUID();
      String code = "M" + System.currentTimeMillis();
      jdbc.sql("insert into member(id,tenant_id,registered_store_id,code,name,phone) values(:id,:tenant,:store,:code,:name,:phone)")
        .param("id", memberId).param("tenant", TENANT_ID).param("store", storeId).param("code", code)
        .param("name", name).param("phone", phone).update();
      jdbc.sql("insert into member_wallet(id,tenant_id,opened_store_id,member_id) values(:id,:tenant,:store,:member)")
        .param("id", walletId).param("tenant", TENANT_ID).param("store", storeId).param("member", memberId).update();
      wallet = new Wallet(walletId, 0L);
    }

    long balance = wallet.balanceCents() + input.amountCents() + input.bonusCents();
    if (input.amountCents() > 0) {
      long rechargeBalance = wallet.balanceCents() + input.amountCents();
      UUID rechargeId = transaction(storeId, wallet, memberId, "RECHARGE", input.amountCents(), wallet.balanceCents(), rechargeBalance, paymentMethod, technician, employee, input.note(), null);
      if (input.bonusCents() > 0) transaction(storeId, wallet, memberId, "BONUS", input.bonusCents(), rechargeBalance, balance, paymentMethod, technician, employee, input.note(), rechargeId);
      jdbc.sql("update member_wallet set balance_cents=:balance,updated_at=now(),version=version+1 where id=:id")
        .param("balance", balance).param("id", wallet.id()).update();
    }

    Member opened = member(memberId);
    audits.record(authorization, storeId, "MEMBER", reactivated ? "MEMBER_REACTIVATED" : "MEMBER_CREATED", "member", memberId,
      reactivated ? "恢复归档会员并重新开卡" : "新增会员开卡", before, opened);
    if (input.amountCents() > 0) {
      RechargeInput recharge = new RechargeInput(input.amountCents(), input.bonusCents(), input.paymentMethod(), input.technicianId(), input.employeeId(), input.note());
      audits.record(authorization, storeId, "MEMBER", "MEMBER_RECHARGED", "member", memberId,
        reactivated ? "恢复会员储值充值" : "会员首次储值", null, new RechargeAudit(opened, recharge));
    }
    return writeResult(opened, reactivated);
  }

  @PostMapping("/{id}/recharges")
  @Transactional
  Member recharge(@PathVariable UUID id, @Valid @RequestBody RechargeInput input,
                   @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                   @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID transactionStoreId = storeContext.currentStore(authorization, requestedStoreId);
    Member beforeMember = member(id);
    Wallet wallet = wallet(id);
    PaymentMethod paymentMethod = paymentMethod(transactionStoreId, input.paymentMethod());
    if (!"EXTERNAL".equals(paymentMethod.methodKind())) throw bad("Member balance cannot be used for recharge");
    Technician technician = input.technicianId() == null ? null : technician(transactionStoreId, input.technicianId());
    Employee employee = input.employeeId() == null ? null : employee(transactionStoreId, input.employeeId());
    long before = wallet.balanceCents();
    long after = before + input.amountCents() + input.bonusCents();
    UUID rechargeId = transaction(transactionStoreId, wallet, id, "RECHARGE", input.amountCents(), before, before + input.amountCents(), paymentMethod, technician, employee, input.note(), null);
    if (input.bonusCents() > 0) transaction(transactionStoreId, wallet, id, "BONUS", input.bonusCents(), before + input.amountCents(), after, paymentMethod, technician, employee, input.note(), rechargeId);
    jdbc.sql("update member_wallet set balance_cents=:balance,updated_at=now(),version=version+1 where id=:id")
      .param("balance", after).param("id", wallet.id()).update();
    Member recharged = member(id);
    audits.record(authorization, transactionStoreId, "MEMBER", "MEMBER_RECHARGED", "member", id, "会员储值充值", beforeMember, new RechargeAudit(recharged, input));
    return recharged;
  }

  @PutMapping("/{id}")
  @Transactional
  Member update(@PathVariable UUID id, @Valid @RequestBody UpdateInput input,
                @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Member before = member(id);
    String phone = input.phone().trim();
    boolean duplicate = jdbc.sql("select exists(select 1 from member where tenant_id=:tenant and phone=:phone and active=true and id<>:id)")
      .param("tenant", TENANT_ID).param("phone", phone).param("id", id).query(Boolean.class).single();
    if (duplicate) throw new ResponseStatusException(HttpStatus.CONFLICT, "该手机号已被其他会员使用");
    jdbc.sql("update member set name=:name,phone=:phone,updated_at=now(),version=version+1 where id=:id and tenant_id=:tenant and active=true")
      .param("name", input.name().trim()).param("phone", phone).param("id", id).param("tenant", TENANT_ID).update();
    Member updated = member(id);
    audits.record(authorization, storeId, "MEMBER", "MEMBER_UPDATED", "member", id, "修改会员资料", before, updated);
    return updated;
  }

  @DeleteMapping("/{id}")
  @Transactional
  ResponseEntity<Map<String, String>> deactivate(@PathVariable UUID id,
                  @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                  @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Member before = member(id);
    Wallet wallet = wallet(id);
    if (wallet.balanceCents() > 0) return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", "会员仍有余额，请先处理余额后再停用归档"));
    boolean unsettled = jdbc.sql("select exists(select 1 from sales_order where member_id=:member and status not in ('SETTLED','CANCELLED'))")
      .param("member", id).query(Boolean.class).single();
    if (unsettled) return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", "会员存在未结算订单，请先完成结算或取消订单"));
    jdbc.sql("update member set active=false,updated_at=now(),version=version+1 where id=:id and tenant_id=:tenant")
      .param("id", id).param("tenant", TENANT_ID).update();
    audits.record(authorization, storeId, "MEMBER", "MEMBER_DEACTIVATED", "member", id, "停用会员档案，历史流水保留", before, null);
    return ResponseEntity.ok(Map.of("message", "会员已停用归档，历史记录已保留"));
  }

  @DeleteMapping("/{id}/purge")
  @Transactional
  ResponseEntity<Map<String, String>> purge(@PathVariable UUID id,
             @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
             @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    adminSessions.requireTenantAdmin(authorization);
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Member before = member(id);
    Wallet wallet = wallet(id);
    if (wallet.balanceCents() != 0) return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", "会员余额不为零，只能停用归档"));
    boolean hasHistory = jdbc.sql("select exists(select 1 from wallet_transaction where member_id=:member) or exists(select 1 from sales_order where member_id=:member) or exists(select 1 from member_recharge_refund where member_id=:member)")
      .param("member", id).query(Boolean.class).single();
    if (hasHistory) return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", "会员存在资金流水、订单或退款记录，只能停用归档"));
    audits.record(authorization, storeId, "MEMBER", "MEMBER_PURGED", "member", id, "系统管理员彻底清除无业务记录的测试会员", before, null);
    jdbc.sql("delete from member_wallet where member_id=:member and tenant_id=:tenant")
      .param("member", id).param("tenant", TENANT_ID).update();
    jdbc.sql("delete from member where id=:member and tenant_id=:tenant")
      .param("member", id).param("tenant", TENANT_ID).update();
    return ResponseEntity.ok(Map.of("message", "测试会员已彻底清除"));
  }

  @PostMapping("/{id}/clear-test-balance-and-archive")
  @Transactional
  ResponseEntity<Map<String, String>> clearTestBalanceAndArchive(@PathVariable UUID id,
      @Valid @RequestBody TestBalanceCleanupInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    adminSessions.requireTenantAdmin(authorization);
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Member before = member(id);
    Wallet wallet = wallet(id);
    if (wallet.balanceCents() <= 0) return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", "会员余额已为零，请直接停用归档"));
    boolean unsettled = jdbc.sql("select exists(select 1 from sales_order where member_id=:member and status not in ('SETTLED','CANCELLED'))")
      .param("member", id).query(Boolean.class).single();
    if (unsettled) return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", "会员存在未结算订单，请先完成结算或取消订单"));
    long balance = wallet.balanceCents();
    jdbc.sql("insert into wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,note,business_date) values(:id,:tenant,:store,:wallet,:member,'ADJUSTMENT',:amount,:before,0,'ADMIN_TEST_CLEANUP',:note,:businessDate)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("wallet", wallet.id()).param("member", id)
      .param("amount", -balance).param("before", balance).param("note", input.reason().trim()).param("businessDate", businessClock.currentBusinessDate(storeId)).update();
    jdbc.sql("update member_wallet set balance_cents=0,updated_at=now(),version=version+1 where id=:wallet")
      .param("wallet", wallet.id()).update();
    jdbc.sql("update member set active=false,updated_at=now(),version=version+1 where id=:member and tenant_id=:tenant")
      .param("member", id).param("tenant", TENANT_ID).update();
    audits.record(authorization, storeId, "MEMBER", "MEMBER_TEST_BALANCE_CLEARED_AND_DEACTIVATED", "member", id,
      "系统管理员清理测试余额并停用归档", before, Map.of("balanceCents", 0, "active", false, "reason", input.reason().trim()));
    return ResponseEntity.ok(Map.of("message", "测试余额已清零，会员已停用归档"));
  }

  private Member member(UUID id) {
    return jdbc.sql("select m.id,m.code,m.name,m.phone,w.balance_cents from member m join member_wallet w on w.member_id=m.id where m.id=:id and m.tenant_id=:tenant")
      .param("id", id).param("tenant", TENANT_ID).query(Member.class).single();
  }

  private ExistingMember existingMemberByPhoneForUpdate(String phone) {
    return jdbc.sql("select id,active from member where tenant_id=:tenant and phone=:phone for update")
      .param("tenant", TENANT_ID).param("phone", phone).query(ExistingMember.class).optional().orElse(null);
  }

  private void reactivate(UUID memberId, String name) {
    jdbc.sql("update member set name=:name,active=true,updated_at=now(),version=version+1 where id=:id and tenant_id=:tenant and active=false")
      .param("name", name).param("id", memberId).param("tenant", TENANT_ID).update();
  }

  private MemberWriteResult writeResult(Member member, boolean reactivated) {
    return new MemberWriteResult(member.id(), member.code(), member.name(), member.phone(), member.balanceCents(), reactivated);
  }

  private Wallet wallet(UUID memberId) {
    return jdbc.sql("select w.id,w.balance_cents from member_wallet w join member m on m.id=w.member_id where w.member_id=:member and m.tenant_id=:tenant for update")
      .param("member", memberId).param("tenant", TENANT_ID).query(Wallet.class).single();
  }

  private String memberCenterSql(String memberFilter) {
    return "select m.id,m.code,m.name,m.phone,registered.name registered_store_name,w.balance_cents,coalesce(totals.recharge_cents,0) recharge_cents,coalesce(totals.bonus_cents,0) bonus_cents,coalesce(totals.consumption_cents,0) consumption_cents,totals.last_consumption_at,latest.amount_cents last_recharge_cents,latest.technician_name_snapshot last_recharge_technician_name,latest.employee_name_snapshot last_recharge_employee_name,latest.created_at last_recharge_at,activity.transaction_type last_activity_type,activity.created_at last_activity_at,m.created_at from member m join member_wallet w on w.member_id=m.id join store registered on registered.id=m.registered_store_id left join lateral (select sum(amount_cents) filter (where transaction_type='RECHARGE') recharge_cents,sum(amount_cents) filter (where transaction_type='BONUS') bonus_cents,sum(-amount_cents) filter (where transaction_type='CONSUMPTION') consumption_cents,max(created_at) filter (where transaction_type='CONSUMPTION') last_consumption_at from wallet_transaction where member_id=m.id and store_id=:store) totals on true left join lateral (select amount_cents,technician_name_snapshot,employee_name_snapshot,created_at from wallet_transaction where member_id=m.id and store_id=:store and transaction_type='RECHARGE' order by created_at desc limit 1) latest on true left join lateral (select transaction_type,created_at from wallet_transaction where member_id=m.id and store_id=:store order by created_at desc limit 1) activity on true where m.tenant_id=:tenant and m.active=true and (m.code ilike :q or m.name ilike :q or m.phone ilike :q)" + memberFilter + " order by activity.created_at desc nulls last,m.created_at desc limit 300";
  }

  private List<MemberWalletTransaction> memberTransactions(UUID storeId, UUID memberId) {
    return jdbc.sql("select wt.id,wt.transaction_type,wt.amount_cents,wt.balance_before_cents,wt.balance_after_cents,wt.payment_method,wt.payment_method_name_snapshot,wt.technician_id,wt.technician_name_snapshot,wt.employee_id,wt.employee_name_snapshot,wt.source,wt.note,wt.created_at,o.order_no,coalesce((select string_agg(line.item_name_snapshot || case when line.quantity > 1 then ' x' || line.quantity else '' end,'、' order by line.id) from sales_order_line line where line.order_id=o.id),'') service_items,coalesce((select string_agg(distinct technician_name,'、') from (select technician.name technician_name from sales_order_line line join sales_order_service_session link on link.order_line_id=line.id join service_session session on session.id=link.service_session_id left join technician technician on technician.id=session.technician_id where line.order_id=o.id and technician.name is not null) names),'') service_technician_names,coalesce((select string_agg(distinct coalesce(room.code,room.name),'、') from sales_order_line line join sales_order_service_session link on link.order_line_id=line.id join service_session session on session.id=link.service_session_id left join room room on room.id=session.room_id where line.order_id=o.id and room.id is not null),'') room_names,(select max(session.ended_at) from sales_order_line line join sales_order_service_session link on link.order_line_id=line.id join service_session session on session.id=link.service_session_id where line.order_id=o.id) service_ended_at from wallet_transaction wt left join sales_order o on wt.transaction_type='CONSUMPTION' and o.id=case when wt.note ~* '^[0-9a-f-]{36}$' then wt.note::uuid end and o.store_id=wt.store_id where wt.store_id=:store and wt.member_id=:member order by wt.created_at desc limit 200")
      .param("store", storeId).param("member", memberId).query(MemberWalletTransaction.class).list();
  }

  private PaymentMethod paymentMethod(UUID storeId, String code) {
    return jdbc.sql("select code,name,method_kind from store_payment_method where store_id=:store and code=:code and active=true")
      .param("store", storeId).param("code", code.trim().toUpperCase()).query(PaymentMethod.class).optional().orElseThrow(() -> bad("Payment method not found"));
  }

  private Technician technician(UUID storeId, UUID technicianId) {
    return jdbc.sql("select id,name from technician where id=:id and store_id=:store and active=true")
      .param("id", technicianId).param("store", storeId).query(Technician.class).optional().orElseThrow(() -> bad("Technician not found"));
  }

  private Employee employee(UUID storeId, UUID employeeId) {
    return jdbc.sql("select e.id,e.full_name from employee e join employee_store_assignment assignment on assignment.employee_id=e.id where e.id=:id and e.active=true and assignment.store_id=:store and assignment.active=true")
      .param("id", employeeId).param("store", storeId).query(Employee.class).optional().orElseThrow(() -> bad("Employee not found"));
  }

  private UUID transaction(UUID transactionStoreId, Wallet wallet, UUID member, String type, long amount, long before, long after, PaymentMethod paymentMethod, Technician technician, Employee employee, String note, UUID rechargeId) {
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,payment_method,payment_method_name_snapshot,technician_id,technician_name_snapshot,employee_id,employee_name_snapshot,source,note,business_date,recharge_id) values(:id,:tenant,:store,:wallet,:member,:type,:amount,:before,:after,:payment,:paymentName,:technician,:technicianName,:employee,:employeeName,'FRONTDESK',:note,:businessDate,:recharge)")
      .param("id", id).param("recharge", "RECHARGE".equals(type) ? id : rechargeId).param("tenant", TENANT_ID).param("store", transactionStoreId).param("wallet", wallet.id()).param("member", member)
      .param("type", type).param("amount", amount).param("before", before).param("after", after).param("payment", paymentMethod.code()).param("paymentName", paymentMethod.name()).param("technician", technician == null ? null : technician.id()).param("technicianName", technician == null ? null : technician.name()).param("employee", employee == null ? null : employee.id()).param("employeeName", employee == null ? null : employee.fullName()).param("note", note).param("businessDate", businessClock.currentBusinessDate(transactionStoreId)).update();
    return id;
  }

  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }
  private ResponseStatusException notFound(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }

  record Member(UUID id, String code, String name, String phone, Long balanceCents) {}
  record MemberWriteResult(UUID id, String code, String name, String phone, Long balanceCents, Boolean reactivated) {}
  record ExistingMember(UUID id, Boolean active) {}
  record MemberCenterRow(UUID id, String code, String name, String phone, String registeredStoreName, Long balanceCents, Long rechargeCents, Long bonusCents, Long consumptionCents, java.time.OffsetDateTime lastConsumptionAt, Long lastRechargeCents, String lastRechargeTechnicianName, String lastRechargeEmployeeName, java.time.OffsetDateTime lastRechargeAt, String lastActivityType, java.time.OffsetDateTime lastActivityAt, java.time.OffsetDateTime createdAt) {}
  record MemberWalletTransaction(UUID id, String transactionType, Long amountCents, Long balanceBeforeCents, Long balanceAfterCents, String paymentMethod, String paymentMethodNameSnapshot, UUID technicianId, String technicianNameSnapshot, UUID employeeId, String employeeNameSnapshot, String source, String note, java.time.OffsetDateTime createdAt, String orderNo, String serviceItems, String serviceTechnicianNames, String roomNames, java.time.OffsetDateTime serviceEndedAt) {}
  record MemberProfile(MemberCenterRow member, List<MemberWalletTransaction> transactions) {}
  record Wallet(UUID id, Long balanceCents) {}
  record PaymentMethod(String code, String name, String methodKind) {}
  record Technician(UUID id, String name) {}
  record Employee(UUID id, String fullName) {}
  record CreateInput(@NotBlank String name, @NotBlank String phone) {}
  record UpdateInput(@NotBlank @Size(max=80) String name, @NotBlank @Size(max=30) String phone) {}
  record TestBalanceCleanupInput(@NotBlank @Size(max=240) String reason) {}
  record OpenCardInput(@NotBlank @Size(max=120) String name, @NotBlank @Size(max=30) String phone,
                       @NotNull @Min(0) Long amountCents, @NotNull @Min(0) Long bonusCents,
                       @Size(max=30) String paymentMethod, UUID technicianId, UUID employeeId, @Size(max=240) String note) {}
  record RechargeInput(@NotNull @Min(1) Long amountCents, @NotNull @Min(0) Long bonusCents, @NotBlank @Size(max=30) String paymentMethod, UUID technicianId, UUID employeeId, @Size(max=240) String note) {}
  record RechargeAudit(Member member, RechargeInput recharge) {}
}
