package com.chengxin.massage.mobile;

import java.util.List;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;

@RestController
@RequestMapping("/api/v1/admin/technician-accounts")
@CrossOrigin(origins = "*")
public class TechnicianAccountAdminController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final MobileSessionService sessions;
  private final StoreContextService storeContext;
  private final AuditService audits;

  TechnicianAccountAdminController(JdbcClient jdbc, MobileSessionService sessions, StoreContextService storeContext, AuditService audits) {
    this.jdbc = jdbc;
    this.sessions = sessions;
    this.storeContext = storeContext;
    this.audits = audits;
  }

  @GetMapping
  List<Account> list(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql("select b.id binding_id,t.id technician_id,t.code technician_code,t.name technician_name,u.login_name,b.active from technician t left join technician_account_binding b on b.technician_id=t.id and b.store_id=:store left join app_user u on u.id=b.user_id where t.store_id=:store and t.active=true order by t.queue_order")
      .param("store", storeId).query(Account.class).list();
  }

  @PostMapping
  @Transactional
  Account create(@Valid @RequestBody CreateInput input,
                 @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                 @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    String loginName = input.loginName().trim();
    boolean loginExists = jdbc.sql("select exists(select 1 from app_user where tenant_id=:tenant and login_name=:login)")
      .param("tenant", TENANT_ID).param("login", loginName).query(Boolean.class).single();
    if (loginExists) throw new ResponseStatusException(HttpStatus.CONFLICT, "该登录账号已存在");
    Technician tech = jdbc.sql("select id,code,name,employee_id from technician where id=:id and store_id=:store and active=true")
      .param("id", input.technicianId()).param("store", storeId).query(Technician.class).single();
    if (tech.employeeId() == null) throw new ResponseStatusException(HttpStatus.CONFLICT, "Technician is not linked to an employee record");
    boolean employeeAlreadyLinked = jdbc.sql("select exists(select 1 from employee_user_link where employee_id=:employee)")
      .param("employee", tech.employeeId()).query(Boolean.class).single();
    if (employeeAlreadyLinked) throw new ResponseStatusException(HttpStatus.CONFLICT, "Employee already has a linked account");
    UUID userId = UUID.randomUUID(), bindingId = UUID.randomUUID();
    jdbc.sql("insert into app_user(id,tenant_id,login_name,display_name,password_hash) values(:id,:tenant,:login,:name,:hash)")
      .param("id", userId).param("tenant", TENANT_ID).param("login", loginName).param("name", tech.name()).param("hash", sessions.encodePassword(input.password())).update();
    jdbc.sql("insert into technician_account_binding(id,tenant_id,store_id,user_id,technician_id) values(:id,:tenant,:store,:user,:technician)")
      .param("id", bindingId).param("tenant", TENANT_ID).param("store", storeId).param("user", userId).param("technician", tech.id()).update();
    jdbc.sql("insert into employee_user_link(employee_id,user_id,tenant_id) values(:employee,:user,:tenant)")
      .param("employee", tech.employeeId()).param("user", userId).param("tenant", TENANT_ID).update();
    Account created = new Account(bindingId, tech.id(), tech.code(), tech.name(), loginName, true);
    audits.record(authorization, storeId, "ACCESS", "TECHNICIAN_ACCOUNT_CREATED", "technician_account", bindingId,
      "Technician account created", null, created);
    return created;
  }

  @PutMapping("/{id}/password")
  @Transactional
  void resetPassword(@PathVariable UUID id, @Valid @RequestBody PasswordInput input,
                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Account account = account(id, storeId);
    UUID userId = user(id, storeId);
    jdbc.sql("update app_user set password_hash=:hash,updated_at=now(),version=version+1 where id=:id")
      .param("hash", sessions.encodePassword(input.password())).param("id", userId).update();
    revoke(userId);
    audits.record(authorization, storeId, "ACCESS", "TECHNICIAN_PASSWORD_RESET", "technician_account", id,
      "Technician password reset", account, account);
  }

  @PutMapping("/{id}/active")
  @Transactional
  void setActive(@PathVariable UUID id, @RequestBody ActiveInput input,
                 @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                 @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Account before = account(id, storeId);
    UUID userId = user(id, storeId);
    jdbc.sql("update technician_account_binding set active=:active,updated_at=now() where id=:id and store_id=:store")
      .param("active", input.active()).param("id", id).param("store", storeId).update();
    if (!input.active()) revoke(userId);
    audits.record(authorization, storeId, "ACCESS", input.active() ? "TECHNICIAN_ACCOUNT_ENABLED" : "TECHNICIAN_ACCOUNT_DISABLED",
      "technician_account", id, input.active() ? "Technician account enabled" : "Technician account disabled", before, account(id, storeId));
  }

  private UUID user(UUID bindingId, UUID storeId) {
    return jdbc.sql("select user_id from technician_account_binding where id=:id and store_id=:store")
      .param("id", bindingId).param("store", storeId).query(UUID.class).single();
  }

  private Account account(UUID bindingId, UUID storeId) {
    return jdbc.sql("select b.id binding_id,t.id technician_id,t.code technician_code,t.name technician_name,u.login_name,b.active from technician_account_binding b join technician t on t.id=b.technician_id join app_user u on u.id=b.user_id where b.id=:id and b.store_id=:store")
      .param("id", bindingId).param("store", storeId).query(Account.class).single();
  }

  private void revoke(UUID userId) {
    jdbc.sql("update user_login_session set revoked_at=now() where user_id=:user and revoked_at is null")
      .param("user", userId).update();
  }

  record Technician(UUID id, String code, String name, UUID employeeId) {}
  record Account(UUID bindingId, UUID technicianId, String technicianCode, String technicianName, String loginName, Boolean active) {}
  record CreateInput(@NotNull UUID technicianId, @NotBlank @Size(max=80) String loginName, @NotBlank @Size(min=8,max=128) String password) {}
  record PasswordInput(@NotBlank @Size(min=8,max=128) String password) {}
  record ActiveInput(boolean active) {}
}
