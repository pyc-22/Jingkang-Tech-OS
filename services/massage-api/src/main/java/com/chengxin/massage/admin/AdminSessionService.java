package com.chengxin.massage.admin;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AdminSessionService {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final String HISTORICAL_ORDER_CREATE = "HISTORICAL_ORDER_CREATE";
  private static final SecureRandom RANDOM = new SecureRandom();
  private final JdbcClient jdbc;

  AdminSessionService(JdbcClient jdbc) { this.jdbc = jdbc; }

  @Transactional
  AdminLogin login(String loginName, String password) {
    User user = jdbc.sql("select id,display_name,password_hash from app_user where tenant_id=:tenant and login_name=:login and active=true")
      .param("tenant", TENANT_ID).param("login", loginName).query(User.class).optional().orElseThrow(this::unauthorized);
    if (!matches(password, user.passwordHash())) throw unauthorized();
    List<String> roles = roleCodes(user.id());
    if (roles.isEmpty() || (roles.size() == 1 && "TECHNICIAN".equals(roles.getFirst()))) throw unauthorized();
    String token = newToken(); OffsetDateTime expiresAt = OffsetDateTime.now().plusHours(12);
    jdbc.sql("insert into user_login_session(id,tenant_id,user_id,token_hash,expires_at) values(:id,:tenant,:user,:hash,:expires)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("user", user.id()).param("hash", tokenHash(token)).param("expires", expiresAt).update();
    return new AdminLogin(token, expiresAt, user.displayName(), roles, storeIds(user.id()), permissionCodes(user.id()));
  }

  @Transactional
  public void requirePermission(String authorization, String permission) {
    if (!hasPermission(authorization, permission)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Permission denied");
  }

  @Transactional
  public boolean hasPermission(String authorization, String permission) {
    UUID user = requireUserId(authorization);
    return jdbc.sql("""
      select exists(select 1 from user_role ur join role r on r.id=ur.role_id where ur.user_id=:user and r.code='TENANT_ADMIN')
        or exists(select 1 from user_role ur join role_permission rp on rp.role_id=ur.role_id join permission p on p.id=rp.permission_id where ur.user_id=:user and p.code=:permission)
        or (:permission=:historicalPermission and exists(
          select 1 from store_manager_backfill_permission grant_row
          join user_role manager_role on manager_role.user_id=grant_row.manager_id
          join role manager_role_def on manager_role_def.id=manager_role.role_id and manager_role_def.code='STORE_MANAGER'
          where grant_row.tenant_id=:tenant and grant_row.manager_id=:user and grant_row.is_active=true))
      """)
      .param("user", user).param("permission", permission).param("historicalPermission", HISTORICAL_ORDER_CREATE).param("tenant", TENANT_ID).query(Boolean.class).single();
  }

  public UUID requireAuthenticatedUserId(String authorization) {
    return requireUserId(authorization);
  }

  @Transactional
  public AuthenticatedIdentity authenticatedIdentity(String authorization) {
    UUID user = requireUserId(authorization);
    String displayName = jdbc.sql("select display_name from app_user where id=:user and tenant_id=:tenant")
      .param("user", user).param("tenant", TENANT_ID).query(String.class).single();
    return new AuthenticatedIdentity(user, displayName, roleCodes(user));
  }

  @Transactional(readOnly = true)
  public Optional<AuthenticatedIdentity> authenticatedIdentityIfPresent(String authorization) {
    if (authorization == null || !authorization.startsWith("Bearer ")) return Optional.empty();
    String hash = tokenHash(authorization.substring(7));
    Optional<IdentityRow> identity = jdbc.sql("select u.id,u.display_name from user_login_session session join app_user u on u.id=session.user_id where session.token_hash=:hash and session.revoked_at is null and session.expires_at>now() and u.tenant_id=:tenant and u.active=true")
      .param("hash", hash).param("tenant", TENANT_ID).query(IdentityRow.class).optional();
    return identity.map(row -> new AuthenticatedIdentity(row.id(), row.displayName(), roleCodes(row.id())));
  }

  @Transactional
  public void requireTenantAdmin(String authorization) {
    if (!isTenantAdmin(requireUserId(authorization))) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Tenant administrator permission required");
    }
  }

  @Transactional
  public AdminSession session(String authorization) {
    UUID user = requireUserId(authorization);
    UserProfile profile = jdbc.sql("select login_name,display_name from app_user where id=:user and tenant_id=:tenant")
      .param("user", user).param("tenant", TENANT_ID).query(UserProfile.class).single();
    return new AdminSession(profile.loginName(), profile.displayName(), roleCodes(user), storeIds(user), permissionCodes(user));
  }

  @Transactional
  void requireStoreAccess(String authorization, UUID storeId) {
    UUID user = requireUserId(authorization);
    boolean allowed = jdbc.sql("select exists(select 1 from store where id=:store and tenant_id=:tenant and active=true) and (exists(select 1 from user_role ur join role r on r.id=ur.role_id where ur.user_id=:user and r.code='TENANT_ADMIN') or exists(select 1 from user_store_scope where user_id=:user and store_id=:store))")
      .param("user", user).param("store", storeId).param("tenant", TENANT_ID).query(Boolean.class).single();
    if (!allowed) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Store access denied");
  }

  @Transactional
  public List<AdminStore> accessibleStores(String authorization) {
    UUID user = requireUserId(authorization);
    boolean tenantAdmin = isTenantAdmin(user);
    String sql = tenantAdmin
      ? "select id,code,name,timezone from store where tenant_id=:tenant and active=true order by code"
      : "select s.id,s.code,s.name,s.timezone from store s join user_store_scope scope on scope.store_id=s.id where s.tenant_id=:tenant and s.active=true and scope.user_id=:user order by s.code";
    return jdbc.sql(sql).param("tenant", TENANT_ID).param("user", user).query(AdminStore.class).list();
  }

  @Transactional
  void logout(String authorization) { if (authorization == null || !authorization.startsWith("Bearer ")) return; jdbc.sql("update user_login_session set revoked_at=now() where token_hash=:hash and revoked_at is null").param("hash", tokenHash(authorization.substring(7))).update(); }

  @Transactional
  public void changePassword(String authorization, String currentPassword, String newPassword) {
    UUID user = requireUserId(authorization);
    String encoded = jdbc.sql("select password_hash from app_user where id=:user and tenant_id=:tenant and active=true")
      .param("user", user).param("tenant", TENANT_ID).query(String.class).optional().orElseThrow(this::unauthorized);
    if (!matches(currentPassword, encoded)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前密码不正确");
    jdbc.sql("update app_user set password_hash=:password,updated_at=now(),version=version+1 where id=:user and tenant_id=:tenant")
      .param("password", encodePassword(newPassword)).param("user", user).param("tenant", TENANT_ID).update();
  }

  public String encodePassword(String password) {
    byte[] salt = new byte[16];
    RANDOM.nextBytes(salt);
    try {
      byte[] hash = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        .generateSecret(new PBEKeySpec(password.toCharArray(), salt, 310000, 256)).getEncoded();
      return "PBKDF2$310000$" + Base64.getUrlEncoder().withoutPadding().encodeToString(salt) + "$" + Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
    } catch (Exception exception) { throw new IllegalStateException(exception); }
  }

  private UUID requireUserId(String authorization) {
    if (authorization == null || !authorization.startsWith("Bearer ")) throw unauthorized();
    String hash = tokenHash(authorization.substring(7));
    UUID user = jdbc.sql("select user_id from user_login_session where token_hash=:hash and revoked_at is null and expires_at>now()")
      .param("hash", hash).query(UUID.class).optional().orElseThrow(this::unauthorized);
    jdbc.sql("update user_login_session set last_seen_at=now() where token_hash=:hash").param("hash", hash).update();
    return user;
  }
  private List<String> roleCodes(UUID user) { return jdbc.sql("select r.code from user_role ur join role r on r.id=ur.role_id where ur.user_id=:user order by r.code").param("user", user).query(String.class).list(); }
  private List<UUID> storeIds(UUID user) { return jdbc.sql("select store_id from user_store_scope where user_id=:user order by store_id").param("user", user).query(UUID.class).list(); }
  private List<String> permissionCodes(UUID user) {
    if (isTenantAdmin(user)) {
      return jdbc.sql("select code from permission order by code").query(String.class).list();
    }
    List<String> permissions = jdbc.sql("select distinct p.code from user_role ur join role_permission rp on rp.role_id=ur.role_id join permission p on p.id=rp.permission_id where ur.user_id=:user order by p.code")
      .param("user", user).query(String.class).list();
    if (jdbc.sql("select exists(select 1 from store_manager_backfill_permission where tenant_id=:tenant and manager_id=:user and is_active=true)")
        .param("tenant", TENANT_ID).param("user", user).query(Boolean.class).single()) {
      permissions = new java.util.ArrayList<>(permissions);
      permissions.add(HISTORICAL_ORDER_CREATE);
    }
    return permissions;
  }
  private boolean isTenantAdmin(UUID user) { return jdbc.sql("select exists(select 1 from user_role ur join role r on r.id=ur.role_id where ur.user_id=:user and r.code='TENANT_ADMIN')").param("user", user).query(Boolean.class).single(); }
  private boolean matches(String password, String encoded) { String[] parts=encoded.split("\\$",4); if(parts.length!=4||!"PBKDF2".equals(parts[0]))return false; try{int iterations=Integer.parseInt(parts[1]);byte[] salt=Base64.getUrlDecoder().decode(parts[2]);byte[] expected=Base64.getUrlDecoder().decode(parts[3]);byte[] actual=SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(new PBEKeySpec(password.toCharArray(),salt,iterations,expected.length*8)).getEncoded();return MessageDigest.isEqual(actual,expected);}catch(Exception ignored){return false;} }
  private String newToken() { byte[] value=new byte[32]; RANDOM.nextBytes(value); return Base64.getUrlEncoder().withoutPadding().encodeToString(value); }
  private String tokenHash(String value) { try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}catch(Exception exception){throw new IllegalStateException(exception);} }
  private ResponseStatusException unauthorized() { return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid administrator credentials"); }

  record User(UUID id, String displayName, String passwordHash) {}
  record UserProfile(String loginName, String displayName) {}
  record IdentityRow(UUID id, String displayName) {}
  public record AdminStore(UUID id, String code, String name, String timezone) {}
  public record AuthenticatedIdentity(UUID userId, String displayName, List<String> roles) {}
  public record AdminSession(String loginName, String displayName, List<String> roles, List<UUID> storeIds, List<String> permissions) {}
  record AdminLogin(String accessToken, OffsetDateTime expiresAt, String displayName, List<String> roles, List<UUID> storeIds, List<String> permissions) {}
}
