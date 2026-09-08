package com.chengxin.massage.mobile;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class MobileSessionService {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final SecureRandom RANDOM = new SecureRandom();
  private final JdbcClient jdbc;

  MobileSessionService(JdbcClient jdbc) { this.jdbc = jdbc; }

  @Transactional
  LoginSession login(String loginName, String password) {
    AppUser user = jdbc.sql("select id,display_name,password_hash from app_user where tenant_id=:tenant and login_name=:login and active=true")
      .param("tenant", TENANT_ID).param("login", loginName).query(AppUser.class).optional()
      .orElseThrow(this::unauthorized);
    if (!matches(password, user.passwordHash())) throw unauthorized();
    boolean hasActiveTechnicianBinding = jdbc.sql("select exists(select 1 from technician_account_binding b join technician t on t.id=b.technician_id and t.store_id=b.store_id join store s on s.id=b.store_id where b.user_id=:user and b.tenant_id=:tenant and t.tenant_id=:tenant and s.tenant_id=:tenant and b.active=true and t.active=true and s.active=true)")
      .param("user", user.id()).param("tenant", TENANT_ID).query(Boolean.class).single();
    if (!hasActiveTechnicianBinding) throw unauthorized();
    String token = newToken();
    OffsetDateTime expiresAt = OffsetDateTime.now().plusDays(30);
    jdbc.sql("insert into user_login_session(id,tenant_id,user_id,token_hash,expires_at) values(:id,:tenant,:user,:hash,:expires)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("user", user.id()).param("hash", tokenHash(token)).param("expires", expiresAt).update();
    return new LoginSession(token, expiresAt, user.displayName());
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

  @Transactional
  public UUID requireUserId(String authorization) {
    if (authorization == null || !authorization.startsWith("Bearer ")) throw unauthorized();
    String hash = tokenHash(authorization.substring("Bearer ".length()));
    UUID userId = jdbc.sql("select user_id from user_login_session where token_hash=:hash and revoked_at is null and expires_at>now()")
      .param("hash", hash).query(UUID.class).optional().orElseThrow(this::unauthorized);
    jdbc.sql("update user_login_session set last_seen_at=now() where token_hash=:hash").param("hash", hash).update();
    return userId;
  }

  @Transactional
  void logout(String authorization) {
    if (authorization == null || !authorization.startsWith("Bearer ")) return;
    jdbc.sql("update user_login_session set revoked_at=now() where token_hash=:hash and revoked_at is null")
      .param("hash", tokenHash(authorization.substring("Bearer ".length()))).update();
  }

  private boolean matches(String password, String encoded) {
    String[] parts = encoded.split("\\$", 4);
    if (parts.length != 4 || !"PBKDF2".equals(parts[0])) return false;
    try {
      int iterations = Integer.parseInt(parts[1]);
      byte[] salt = Base64.getUrlDecoder().decode(parts[2]);
      byte[] expected = Base64.getUrlDecoder().decode(parts[3]);
      byte[] actual = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        .generateSecret(new PBEKeySpec(password.toCharArray(), salt, iterations, expected.length * 8)).getEncoded();
      return MessageDigest.isEqual(actual, expected);
    } catch (Exception ignored) { return false; }
  }

  private String newToken() {
    byte[] value = new byte[32];
    RANDOM.nextBytes(value);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
  }

  private String tokenHash(String value) {
    try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
    catch (Exception exception) { throw new IllegalStateException(exception); }
  }

  private ResponseStatusException unauthorized() { return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "账号或密码错误"); }

  record AppUser(UUID id, String displayName, String passwordHash) {}
  record LoginSession(String accessToken, OffsetDateTime expiresAt, String displayName) {}
}
