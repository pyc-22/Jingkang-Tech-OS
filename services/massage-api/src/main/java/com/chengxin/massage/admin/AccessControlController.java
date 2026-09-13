package com.chengxin.massage.admin;

import java.time.LocalTime;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import com.chengxin.massage.mobile.MobileSessionService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.BusinessClockService;

@RestController
@RequestMapping("/api/v1/admin/access")
@CrossOrigin(origins = "*")
public class AccessControlController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final String HISTORICAL_ORDER_CREATE = "HISTORICAL_ORDER_CREATE";
  private final JdbcClient jdbc;
  private final MobileSessionService sessions;
  private final AdminSessionService adminSessions;
  private final AuditService audits;
  private final BusinessClockService businessClock;

  AccessControlController(JdbcClient jdbc, MobileSessionService sessions, AdminSessionService adminSessions, AuditService audits, BusinessClockService businessClock) { this.jdbc = jdbc; this.sessions = sessions; this.adminSessions = adminSessions; this.audits = audits; this.businessClock = businessClock; }

  @GetMapping("/stores")
  List<Store> stores(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) { authorize(authorization); return jdbc.sql("select id,code,name,timezone,business_day_cutoff,address,contact_phone,business_hours,active from store where tenant_id=:tenant order by active desc,code").param("tenant", TENANT_ID).query(Store.class).list(); }

  @GetMapping("/my-stores")
  List<AdminSessionService.AdminStore> myStores(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) { return adminSessions.accessibleStores(authorization); }

  @PostMapping("/stores")
  @Transactional
  Store createStore(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @Valid @RequestBody StoreInput input) { authorize(authorization);
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into store(id,tenant_id,code,name,timezone,business_day_cutoff,address,contact_phone,business_hours) values(:id,:tenant,:code,:name,:timezone,:cutoff,:address,:phone,:hours)")
      .param("id", id).param("tenant", TENANT_ID).param("code", input.code()).param("name", input.name()).param("timezone", input.timezone())
      .param("cutoff", cutoff(input.businessDayCutoff())).param("address", input.address()).param("phone", input.contactPhone()).param("hours", input.businessHours()).update();
    seedPaymentMethods(id);
    seedPrintSetting(id);
    Store created = store(id);
    audits.record(authorization, id, "ACCESS", "STORE_CREATED", "store", id, "Store created", null, created);
    return created;
  }

  @PostMapping("/stores/onboard")
  @Transactional
  StoreOnboardingResult onboardStore(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                     @Valid @RequestBody StoreOnboardingInput input) {
    authorize(authorization);
    if (jdbc.sql("select exists(select 1 from store where tenant_id=:tenant and code=:code)").param("tenant", TENANT_ID).param("code", input.store().code()).query(Boolean.class).single()) {
      throw conflict("Store code already exists");
    }
    if (jdbc.sql("select exists(select 1 from app_user where tenant_id=:tenant and login_name=:login)").param("tenant", TENANT_ID).param("login", input.manager().loginName()).query(Boolean.class).single()) {
      throw conflict("Manager login name already exists");
    }
    boolean templateAvailable = jdbc.sql("select exists(select 1 from store where id=:store and tenant_id=:tenant and active=true)")
      .param("store", input.serviceTemplateStoreId()).param("tenant", TENANT_ID).query(Boolean.class).single();
    if (!templateAvailable) throw notFound("Service template store not found");
    LocalDate templateBusinessDate = businessClock.currentBusinessDate(input.serviceTemplateStoreId());
    List<ServiceTemplate> services = jdbc.sql("select item.code,item.name,item.category,item.default_duration_minutes,coalesce((select version.price_cents from service_item_price_version version where version.service_item_id=item.id and version.effective_business_date<=:date order by version.effective_business_date desc limit 1),item.price_cents) price_cents,item.requires_room,item.allows_extension,item.counts_as_clock from service_item item where item.store_id=:store and item.active=true order by item.code")
      .param("store", input.serviceTemplateStoreId()).param("date", templateBusinessDate).query(ServiceTemplate.class).list();
    if (services.isEmpty()) throw conflict("Service template store has no active service items");

    UUID storeId = UUID.randomUUID();
    jdbc.sql("insert into store(id,tenant_id,code,name,timezone,business_day_cutoff,address,contact_phone,business_hours) values(:id,:tenant,:code,:name,:timezone,:cutoff,:address,:phone,:hours)")
      .param("id", storeId).param("tenant", TENANT_ID).param("code", input.store().code()).param("name", input.store().name()).param("timezone", input.store().timezone())
      .param("cutoff", cutoff(input.store().businessDayCutoff())).param("address", input.store().address()).param("phone", input.store().contactPhone()).param("hours", input.store().businessHours()).update();
    seedPaymentMethods(storeId);
    seedPrintSetting(storeId);
    LocalDate storeBusinessDate = businessClock.currentBusinessDate(storeId);
    for (ServiceTemplate service : services) {
      UUID serviceItemId = UUID.randomUUID();
      jdbc.sql("insert into service_item(id,tenant_id,store_id,code,name,category,default_duration_minutes,price_cents,requires_room,allows_extension,counts_as_clock) values(:id,:tenant,:store,:code,:name,:category,:duration,:price,:requiresRoom,:allowsExtension,:countsAsClock)")
        .param("id", serviceItemId).param("tenant", TENANT_ID).param("store", storeId).param("code", service.code()).param("name", service.name()).param("category", service.category())
        .param("duration", service.defaultDurationMinutes()).param("price", service.priceCents()).param("requiresRoom", service.requiresRoom()).param("allowsExtension", service.allowsExtension()).param("countsAsClock", service.countsAsClock()).update();
      jdbc.sql("insert into service_item_price_version(id,tenant_id,store_id,service_item_id,price_cents,effective_business_date) values(:id,:tenant,:store,:service,:price,:date)")
        .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("service", serviceItemId).param("price", service.priceCents()).param("date", storeBusinessDate).update();
      jdbc.sql("insert into service_item_commission_rule_version(id,tenant_id,store_id,service_item_id,effective_business_date) values(:id,:tenant,:store,:service,:date)")
        .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("service", serviceItemId).param("date", storeBusinessDate).update();
    }
    for (int offset = 0; offset < input.roomCount(); offset++) {
      String roomCode = String.valueOf(input.firstRoomNumber() + offset);
      UUID roomId = UUID.randomUUID();
      jdbc.sql("insert into room(id,tenant_id,store_id,code,name,room_type,bed_count) values(:id,:tenant,:store,:code,:name,'STANDARD',:beds)")
        .param("id", roomId).param("tenant", TENANT_ID).param("store", storeId).param("code", roomCode).param("name", roomCode + " 房").param("beds", input.bedsPerRoom()).update();
      for (int bed = 1; bed <= input.bedsPerRoom(); bed++) {
        String bedCode = roomCode + "-" + String.format(java.util.Locale.ROOT, "%02d", bed);
        jdbc.sql("insert into room_bed(id,tenant_id,store_id,room_id,code,name,sort_order) values(:id,:tenant,:store,:room,:code,:name,:sort)")
          .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("room", roomId).param("code", bedCode).param("name", roomCode + " 床位 " + bed).param("sort", bed).update();
      }
    }
    UUID managerId = UUID.randomUUID();
    UUID managerRoleId = jdbc.sql("select id from role where tenant_id=:tenant and code='STORE_MANAGER'").param("tenant", TENANT_ID).query(UUID.class).optional().orElseThrow(() -> notFound("Store manager role not found"));
    jdbc.sql("insert into app_user(id,tenant_id,login_name,display_name,password_hash) values(:id,:tenant,:login,:name,:password)")
      .param("id", managerId).param("tenant", TENANT_ID).param("login", input.manager().loginName()).param("name", input.manager().displayName()).param("password", sessions.encodePassword(input.manager().password())).update();
    jdbc.sql("insert into user_role(user_id,role_id) values(:user,:role)").param("user", managerId).param("role", managerRoleId).update();
    jdbc.sql("insert into user_store_scope(user_id,store_id) values(:user,:store)").param("user", managerId).param("store", storeId).update();
    StoreOnboardingResult result = new StoreOnboardingResult(store(storeId), input.manager().loginName(), services.size(), input.roomCount(), input.roomCount() * input.bedsPerRoom());
    audits.record(authorization, storeId, "ACCESS", "STORE_ONBOARDED", "store", storeId, "Store onboarded", null, result);
    return result;
  }

  @PutMapping("/stores/{id}")
  @Transactional
  Store updateStore(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @PathVariable UUID id, @Valid @RequestBody StoreInput input) { authorize(authorization);
    Store before = store(id);
    int updated = jdbc.sql("update store set code=:code,name=:name,timezone=:timezone,business_day_cutoff=coalesce(:cutoff,business_day_cutoff),address=:address,contact_phone=:phone,business_hours=:hours,updated_at=now(),version=version+1 where id=:id and tenant_id=:tenant")
      .param("id", id).param("tenant", TENANT_ID).param("code", input.code()).param("name", input.name()).param("timezone", input.timezone()).param("cutoff", input.businessDayCutoff()).param("address", input.address()).param("phone", input.contactPhone()).param("hours", input.businessHours()).update();
    if (updated == 0) throw notFound("Store not found");
    Store updatedStore = store(id);
    audits.record(authorization, id, "ACCESS", "STORE_UPDATED", "store", id, "Store updated", before, updatedStore);
    return updatedStore;
  }

  @PutMapping("/stores/{id}/active")
  @Transactional
  void setStoreActive(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @PathVariable UUID id, @RequestBody ActiveInput input) { authorize(authorization);
    Store before = store(id);
    int updated = jdbc.sql("update store set active=:active,updated_at=now(),version=version+1 where id=:id and tenant_id=:tenant")
      .param("active", input.active()).param("id", id).param("tenant", TENANT_ID).update();
    if (updated == 0) throw notFound("Store not found");
    audits.record(authorization, id, "ACCESS", input.active() ? "STORE_ENABLED" : "STORE_DISABLED", "store", id,
      input.active() ? "Store enabled" : "Store disabled", before, store(id));
  }

  @GetMapping("/permissions")
  List<Permission> permissions(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) { authorize(authorization); return jdbc.sql("select id,code,name,module from permission order by module,code").query(Permission.class).list(); }

  @GetMapping("/roles")
  List<Role> roles(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) { authorize(authorization); return jdbc.sql("select id,code,name from role where tenant_id=:tenant order by code").param("tenant", TENANT_ID).query(RoleBase.class).list().stream().map(base -> new Role(base.id(), base.code(), base.name(), permissionIds(base.id()))).toList(); }

  @PutMapping("/roles/{id}/permissions")
  @Transactional
  Role updateRolePermissions(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @PathVariable UUID id, @Valid @RequestBody PermissionAssignment input) { authorize(authorization);
    ensureRole(id); ensurePermissions(input.permissionIds());
    Role before = role(id);
    jdbc.sql("delete from role_permission where role_id=:role").param("role", id).update();
    for (UUID permissionId : input.permissionIds()) jdbc.sql("insert into role_permission(role_id,permission_id) values(:role,:permission)").param("role", id).param("permission", permissionId).update();
    Role updated = role(id);
    audits.record(authorization, null, "ACCESS", "ROLE_PERMISSIONS_UPDATED", "role", id,
      "Role permissions updated", before, updated);
    return updated;
  }

  @GetMapping("/users")
  List<UserAccount> users(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) { authorize(authorization);
    return jdbc.sql("select u.id,u.login_name,u.display_name,u.active from app_user u where u.tenant_id=:tenant and not exists(select 1 from technician_account_binding b where b.user_id=u.id) order by u.created_at desc")
      .param("tenant", TENANT_ID).query(UserBase.class).list().stream().map(user -> new UserAccount(user.id(), user.loginName(), user.displayName(), user.active(), roleIds(user.id()), storeIds(user.id()))).toList();
  }

  @PostMapping("/users")
  @Transactional
  UserAccount createUser(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @Valid @RequestBody CreateUserInput input) { authorize(authorization);
    List<UUID> stores = input.storeIds() == null ? List.of() : input.storeIds();
    ensureRoles(input.roleIds()); ensureStores(stores);
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into app_user(id,tenant_id,login_name,display_name,password_hash) values(:id,:tenant,:login,:name,:password)")
      .param("id", id).param("tenant", TENANT_ID).param("login", input.loginName()).param("name", input.displayName()).param("password", sessions.encodePassword(input.password())).update();
    assignAccess(id, input.roleIds(), stores);
    UserAccount created = userAccount(id);
    audits.record(authorization, null, "ACCESS", "USER_CREATED", "app_user", id, "User created", null, created);
    return created;
  }

  @PutMapping("/users/{id}/access")
  @Transactional
  UserAccount updateUserAccess(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @PathVariable UUID id, @Valid @RequestBody AccessAssignment input) { authorize(authorization);
    List<UUID> stores = input.storeIds() == null ? List.of() : input.storeIds();
    ensureUser(id); ensureRoles(input.roleIds()); ensureStores(stores);
    UserAccount before = userAccount(id);
    jdbc.sql("delete from user_role where user_id=:user").param("user", id).update();
    jdbc.sql("delete from user_store_scope where user_id=:user").param("user", id).update();
    assignAccess(id, input.roleIds(), stores);
    UserAccount updated = userAccount(id);
    audits.record(authorization, null, "ACCESS", "USER_ACCESS_UPDATED", "app_user", id,
      "User access updated", before, updated);
    return updated;
  }

  @PutMapping("/users/{id}/active")
  @Transactional
  void setUserActive(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @PathVariable UUID id, @RequestBody ActiveInput input) { authorize(authorization);
    ensureUser(id);
    UserAccount before = userAccount(id);
    jdbc.sql("update app_user set active=:active,updated_at=now(),version=version+1 where id=:id").param("active", input.active()).param("id", id).update();
    if (!input.active()) jdbc.sql("update user_login_session set revoked_at=now() where user_id=:user and revoked_at is null").param("user", id).update();
    audits.record(authorization, null, "ACCESS", input.active() ? "USER_ENABLED" : "USER_DISABLED", "app_user", id,
      input.active() ? "User enabled" : "User disabled", before, userAccount(id));
  }

  /** Lists every store manager and the explicit historical-backfill grant for a store. */
  @GetMapping("/stores/{storeId}/backfill-managers")
  List<BackfillManager> backfillManagers(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                         @PathVariable UUID storeId) {
    authorize(authorization);
    ensureStores(List.of(storeId));
    return jdbc.sql("""
      select u.id manager_id,u.login_name manager_login_name,u.display_name manager_name,u.active manager_active,
             coalesce(grant_row.is_active,false) is_active,grant_row.granted_at,grant_row.revoked_at,
             granted_by.display_name granted_by_name,revoked_by.display_name revoked_by_name
      from app_user u
      join user_role ur on ur.user_id=u.id
      join role role_row on role_row.id=ur.role_id and role_row.code='STORE_MANAGER'
      join user_store_scope scope on scope.user_id=u.id and scope.store_id=:store
      left join store_manager_backfill_permission grant_row
        on grant_row.store_id=:store and grant_row.manager_id=u.id and grant_row.tenant_id=:tenant
      left join app_user granted_by on granted_by.id=grant_row.granted_by
      left join app_user revoked_by on revoked_by.id=grant_row.revoked_by
      where u.tenant_id=:tenant
      order by u.active desc,u.display_name,u.login_name
      """).param("store", storeId).param("tenant", TENANT_ID).query(BackfillManager.class).list();
  }

  /** Enables or revokes the explicit per-store grant; every transition is audited. */
  @PutMapping("/stores/{storeId}/backfill-managers/{managerId}")
  @Transactional
  BackfillManager updateBackfillManager(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                        @PathVariable UUID storeId, @PathVariable UUID managerId,
                                        @RequestBody ActiveInput input) {
    authorize(authorization);
    ensureStores(List.of(storeId));
    ensureStoreManagerScope(storeId, managerId);
    BackfillPermissionState before = jdbc.sql("select id,store_id,manager_id,is_active,granted_by,granted_at,revoked_by,revoked_at from store_manager_backfill_permission where tenant_id=:tenant and store_id=:store and manager_id=:manager")
      .param("tenant", TENANT_ID).param("store", storeId).param("manager", managerId)
      .query(BackfillPermissionState.class).optional().orElse(null);
    UUID actorId = adminSessions.requireAuthenticatedUserId(authorization);
    OffsetDateTime now = OffsetDateTime.now();
    if (input.active()) {
      jdbc.sql("""
        insert into store_manager_backfill_permission(
          id,tenant_id,store_id,manager_id,granted_by,granted_at,revoked_by,revoked_at,is_active,updated_at)
        values(:id,:tenant,:store,:manager,:actor,:at,null,null,true,:at)
        on conflict (store_id,manager_id) do update set
          granted_by=:actor,granted_at=:at,revoked_by=null,revoked_at=null,is_active=true,updated_at=:at
        """).param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId)
        .param("manager", managerId).param("actor", actorId).param("at", now).update();
    } else {
      jdbc.sql("""
        insert into store_manager_backfill_permission(
          id,tenant_id,store_id,manager_id,revoked_by,revoked_at,is_active,updated_at)
        values(:id,:tenant,:store,:manager,:actor,:at,false,:at)
        on conflict (store_id,manager_id) do update set
          revoked_by=:actor,revoked_at=:at,is_active=false,updated_at=:at
        """).param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId)
        .param("manager", managerId).param("actor", actorId).param("at", now).update();
    }
    BackfillManager after = backfillManagers(authorization, storeId).stream()
      .filter(row -> managerId.equals(row.managerId())).findFirst().orElseThrow(() -> notFound("Store manager not found"));
    audits.record(authorization, storeId, "ACCESS",
      input.active() ? "HISTORICAL_BACKFILL_PERMISSION_GRANTED" : "HISTORICAL_BACKFILL_PERMISSION_REVOKED",
      "store_manager_backfill_permission", managerId,
      input.active() ? "Historical backfill permission granted" : "Historical backfill permission revoked",
      before, after);
    return after;
  }

  /** Lists historical orders for administrator review and export clients. */
  @GetMapping("/historical-backfills")
  List<HistoricalBackfillRecord> historicalBackfills(
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestParam(required = false) UUID storeId,
      @RequestParam(required = false) LocalDate from,
      @RequestParam(required = false) LocalDate to,
      @RequestParam(required = false) UUID backfillBy) {
    authorize(authorization);
    StringBuilder sql = new StringBuilder("""
      select o.id order_id,o.store_id,s.code store_code,s.name store_name,o.order_no,o.settlement_no,
             o.backfill_date,o.receivable_cents,o.paid_cents,
             coalesce(string_agg(distinct payment.payment_method, ',' order by payment.payment_method),'') payment_methods,
             o.backfill_by,actor.display_name backfill_by_name,o.backfill_at,o.status,o.refund_status
      from sales_order o
      join store s on s.id=o.store_id and s.tenant_id=:tenant
      left join app_user actor on actor.id=o.backfill_by
      left join payment_record payment on payment.order_id=o.id
      where o.tenant_id=:tenant and o.is_historical_backfill=true
      """);
    if (storeId != null) sql.append(" and o.store_id=:storeId");
    if (from != null) sql.append(" and o.backfill_date>=:fromDate");
    if (to != null) sql.append(" and o.backfill_date<=:toDate");
    if (backfillBy != null) sql.append(" and o.backfill_by=:backfillBy");
    sql.append(" group by o.id,o.store_id,s.code,s.name,o.order_no,o.settlement_no,o.backfill_date,o.receivable_cents,o.paid_cents,o.backfill_by,actor.display_name,o.backfill_at,o.status,o.refund_status order by o.backfill_date desc,o.backfill_at desc");
    JdbcClient.StatementSpec statement = jdbc.sql(sql.toString()).param("tenant", TENANT_ID);
    if (storeId != null) statement = statement.param("storeId", storeId);
    if (from != null) statement = statement.param("fromDate", from);
    if (to != null) statement = statement.param("toDate", to);
    if (backfillBy != null) statement = statement.param("backfillBy", backfillBy);
    return statement.query(HistoricalBackfillRecord.class).list();
  }

  private void ensureStoreManagerScope(UUID storeId, UUID managerId) {
    boolean valid = jdbc.sql("""
      select exists(
        select 1 from app_user u
        join user_role ur on ur.user_id=u.id
        join role role_row on role_row.id=ur.role_id and role_row.code='STORE_MANAGER'
        join user_store_scope scope on scope.user_id=u.id and scope.store_id=:store
        where u.id=:manager and u.tenant_id=:tenant)
      """).param("store", storeId).param("manager", managerId).param("tenant", TENANT_ID).query(Boolean.class).single();
    if (!valid) throw notFound("Store manager not found");
  }

  private Store store(UUID id) { return jdbc.sql("select id,code,name,timezone,business_day_cutoff,address,contact_phone,business_hours,active from store where id=:id and tenant_id=:tenant").param("id", id).param("tenant", TENANT_ID).query(Store.class).single(); }
  private LocalTime cutoff(LocalTime value) { return value == null ? LocalTime.of(5, 0) : value.withSecond(0).withNano(0); }
  private void seedPaymentMethods(UUID storeId) {
    seedPaymentMethod(storeId, "MEMBER_BALANCE", "会员余额", "MEMBER_BALANCE", false, true, (short) 10);
    seedPaymentMethod(storeId, "WECHAT", "微信支付", "EXTERNAL", false, true, (short) 20);
    seedPaymentMethod(storeId, "CASH", "现金", "EXTERNAL", true, true, (short) 30);
  }
  private void seedPrintSetting(UUID storeId) { jdbc.sql("insert into store_print_setting(id,tenant_id,store_id,store_name,store_address,store_phone) select :id,tenant_id,id,name,address,contact_phone from store where id=:store").param("id", UUID.randomUUID()).param("store", storeId).update(); }
  private void seedPaymentMethod(UUID storeId, String code, String name, String kind, boolean cashCounted, boolean builtIn, short sortOrder) { jdbc.sql("insert into store_payment_method(id,tenant_id,store_id,code,name,method_kind,cash_counted,built_in,sort_order) values(:id,:tenant,:store,:code,:name,:kind,:cash,:builtIn,:sort)").param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("code", code).param("name", name).param("kind", kind).param("cash", cashCounted).param("builtIn", builtIn).param("sort", sortOrder).update(); }
  private void authorize(String authorization) { adminSessions.requireTenantAdmin(authorization); }
  private List<UUID> permissionIds(UUID role) { return jdbc.sql("select permission_id from role_permission where role_id=:role order by permission_id").param("role", role).query(UUID.class).list(); }
  private Role role(UUID id) { RoleBase base = jdbc.sql("select id,code,name from role where id=:id and tenant_id=:tenant").param("id", id).param("tenant", TENANT_ID).query(RoleBase.class).single(); return new Role(base.id(), base.code(), base.name(), permissionIds(id)); }
  private List<UUID> roleIds(UUID user) { return jdbc.sql("select role_id from user_role where user_id=:user order by role_id").param("user", user).query(UUID.class).list(); }
  private List<UUID> storeIds(UUID user) { return jdbc.sql("select store_id from user_store_scope where user_id=:user order by store_id").param("user", user).query(UUID.class).list(); }
  private UserAccount userAccount(UUID id) { UserBase user = jdbc.sql("select id,login_name,display_name,active from app_user where id=:id and tenant_id=:tenant").param("id", id).param("tenant", TENANT_ID).query(UserBase.class).single(); return new UserAccount(user.id(), user.loginName(), user.displayName(), user.active(), roleIds(id), storeIds(id)); }
  private void assignAccess(UUID user, List<UUID> roles, List<UUID> stores) { for (UUID role : roles) jdbc.sql("insert into user_role(user_id,role_id) values(:user,:role)").param("user", user).param("role", role).update(); for (UUID store : stores) jdbc.sql("insert into user_store_scope(user_id,store_id) values(:user,:store)").param("user", user).param("store", store).update(); }
  private void ensureRole(UUID id) { if (!jdbc.sql("select exists(select 1 from role where id=:id and tenant_id=:tenant)").param("id", id).param("tenant", TENANT_ID).query(Boolean.class).single()) throw notFound("Role not found"); }
  private void ensureUser(UUID id) { if (!jdbc.sql("select exists(select 1 from app_user where id=:id and tenant_id=:tenant)").param("id", id).param("tenant", TENANT_ID).query(Boolean.class).single()) throw notFound("User not found"); }
  private void ensureRoles(List<UUID> ids) { for (UUID id : ids) ensureRole(id); }
  private void ensurePermissions(List<UUID> ids) { for (UUID id : ids) if (!jdbc.sql("select exists(select 1 from permission where id=:id)").param("id", id).query(Boolean.class).single()) throw notFound("Permission not found"); }
  private void ensureStores(List<UUID> ids) { for (UUID id : ids) if (!jdbc.sql("select exists(select 1 from store where id=:id and tenant_id=:tenant)").param("id", id).param("tenant", TENANT_ID).query(Boolean.class).single()) throw notFound("Store not found"); }
  private ResponseStatusException notFound(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }

  record Store(UUID id, String code, String name, String timezone, LocalTime businessDayCutoff, String address, String contactPhone, String businessHours, Boolean active) {}
  record RoleBase(UUID id, String code, String name) {}
  record Permission(UUID id, String code, String name, String module) {}
  record Role(UUID id, String code, String name, List<UUID> permissionIds) {}
  record UserBase(UUID id, String loginName, String displayName, Boolean active) {}
  record UserAccount(UUID id, String loginName, String displayName, Boolean active, List<UUID> roleIds, List<UUID> storeIds) {}
  record ServiceTemplate(String code, String name, String category, Short defaultDurationMinutes, Integer priceCents, Boolean requiresRoom, Boolean allowsExtension, Boolean countsAsClock) {}
  record StoreInput(@NotBlank @Size(max = 40) String code, @NotBlank @Size(max = 120) String name, @NotBlank @Size(max = 50) String timezone, LocalTime businessDayCutoff, @Size(max = 240) String address, @Size(max = 30) String contactPhone, @Size(max = 120) String businessHours) {}
  record ManagerInput(@NotBlank @Size(max = 80) String loginName, @NotBlank @Size(max = 120) String displayName, @NotBlank @Size(min = 8, max = 128) String password) {}
  record StoreOnboardingInput(@NotNull @Valid StoreInput store, @NotNull UUID serviceTemplateStoreId, @NotNull @Valid ManagerInput manager, @Min(1) @Max(999) Integer firstRoomNumber, @Min(1) @Max(50) Short roomCount, @Min(1) @Max(10) Short bedsPerRoom) {}
  record StoreOnboardingResult(Store store, String managerLoginName, Integer serviceItemCount, Short roomCount, Integer bedCount) {}
  record PermissionAssignment(@NotEmpty List<@NotNull UUID> permissionIds) {}
  record CreateUserInput(@NotBlank @Size(max = 80) String loginName, @NotBlank @Size(max = 120) String displayName, @NotBlank @Size(min = 8, max = 128) String password, @NotEmpty List<@NotNull UUID> roleIds, List<UUID> storeIds) {}
  record AccessAssignment(@NotEmpty List<@NotNull UUID> roleIds, List<UUID> storeIds) {}
  record ActiveInput(boolean active) {}
  record BackfillManager(UUID managerId, String managerLoginName, String managerName, Boolean managerActive,
                         Boolean isActive, OffsetDateTime grantedAt, OffsetDateTime revokedAt,
                         String grantedByName, String revokedByName) {}
  record BackfillPermissionState(UUID id, UUID storeId, UUID managerId, Boolean isActive,
                                 UUID grantedBy, OffsetDateTime grantedAt, UUID revokedBy, OffsetDateTime revokedAt) {}
  record HistoricalBackfillRecord(UUID orderId, UUID storeId, String storeCode, String storeName,
                                  String orderNo, String settlementNo, LocalDate backfillDate,
                                  Long receivableCents, Long paidCents, String paymentMethods,
                                  UUID backfillBy, String backfillByName, OffsetDateTime backfillAt,
                                  String status, String refundStatus) {}
}
