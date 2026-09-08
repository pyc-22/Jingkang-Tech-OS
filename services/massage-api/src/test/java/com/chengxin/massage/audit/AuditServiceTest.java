package com.chengxin.massage.audit;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class AuditServiceTest {
  private final AuditService service = new AuditService(null, null, new ObjectMapper(), event -> {});

  @Test
  void redactsSensitiveFieldsAtEveryNestingLevel() throws Exception {
    Map<String, Object> input = Map.of(
      "loginName", "TECH-001",
      "password", "plain-password",
      "profile", Map.of("accessToken", "token-value", "displayName", "Technician"),
      "items", List.of(Map.of("authorizationHeader", "Bearer secret", "amountCents", 1000)));

    String json = serialize(input);

    assertThat(json)
      .contains("TECH-001", "Technician", "1000")
      .doesNotContain("plain-password", "token-value", "Bearer secret")
      .contains("[REDACTED]");
  }

  @Test
  void redactsHashAndSecretKeyVariants() throws Exception {
    String json = serialize(Map.of(
      "passwordHash", "hash-value",
      "client_secret", "secret-value",
      "normalField", "visible"));

    assertThat(json)
      .contains("visible")
      .doesNotContain("hash-value", "secret-value");
  }

  private String serialize(Object value) throws Exception {
    Method method = AuditService.class.getDeclaredMethod("json", Object.class);
    method.setAccessible(true);
    return (String) method.invoke(service, value);
  }
}
