package com.chengxin.massage.alert;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class SecurityAlertServiceTest {
  private final SecurityAlertService service = new SecurityAlertService(null, new ObjectMapper());

  @Test
  void extractsConfiguredGroupingValuesFromAuditContext() {
    UUID actor = UUID.randomUUID();
    UUID store = UUID.randomUUID();
    SecurityAlertService.AuditEvent event = new SecurityAlertService.AuditEvent(
      UUID.randomUUID(), UUID.randomUUID(), store, actor, "LOGIN_FAILED", "ACCESS", "DENIED",
      OffsetDateTime.now(), "127.0.0.1", null, null, null,
      "{\"requestBody\":{\"loginName\":\"pyc1021\"}}"
    );

    var config = new ObjectMapper().createObjectNode();
    config.putArray("groupBy").add("loginName").add("ipAddress").add("actorUserId").add("storeId");
    Map<String, String> grouping = service.groupingValues(event, config);

    assertThat(grouping).containsEntry("loginName", "pyc1021")
      .containsEntry("ipAddress", "127.0.0.1")
      .containsEntry("actorUserId", actor.toString())
      .containsEntry("storeId", store.toString());
  }

  @Test
  void fingerprintIsStableAndChangesWithGroupingValues() {
    SecurityAlertService.AlertRule rule = new SecurityAlertService.AlertRule(
      UUID.randomUUID(), null, "LOGIN_FAILURE_BURST", "连续登录失败", "AUTHENTICATION",
      "ACCESS", "LOGIN_FAILED", "DENIED", 5, 10, "HIGH", "{}"
    );

    String first = service.fingerprint(rule, Map.of("loginName", "pyc1021", "ipAddress", "127.0.0.1"));
    String same = service.fingerprint(rule, Map.of("loginName", "pyc1021", "ipAddress", "127.0.0.1"));
    String changed = service.fingerprint(rule, Map.of("loginName", "other", "ipAddress", "127.0.0.1"));

    assertThat(first).isEqualTo(same).startsWith("LOGIN_FAILURE_BURST:");
    assertThat(changed).isNotEqualTo(first);
  }
}
