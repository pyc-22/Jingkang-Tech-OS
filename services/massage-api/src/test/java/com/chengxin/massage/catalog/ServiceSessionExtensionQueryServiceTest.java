package com.chengxin.massage.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.RETURNS_SELF;

import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.catalog.ServiceSessionExtensionQueryService.Extension;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.server.ResponseStatusException;

class ServiceSessionExtensionQueryServiceTest {
  @Test
  void readsSnapshotDetailsAndScopesSessionTechnicianAndExtensionToTheSameTenantAndStore() {
    String sql = ServiceSessionExtensionQueryService.extensionSql();

    assertThat(sql).contains("extension.service_name_snapshot", "extension.service_price_cents",
        "extension.planned_duration_minutes", "extension.added_at", "technician.code technician_code",
        "technician.name technician_name", "session.store_id=:store", "extension.store_id=:store",
        "session.id in (:sessions)", "session.store_id=extension.store_id", "session.tenant_id=extension.tenant_id",
        "technician.store_id=extension.store_id", "technician.tenant_id=extension.tenant_id",
        "order by extension.service_session_id,extension.added_at,extension.id");
    assertThat(sql).doesNotContain("service_item.price_cents", "service_item.default_duration_minutes");
  }

  @Test
  @SuppressWarnings("unchecked")
  void groupsAllExtensionRowsBySessionAndBindsBothScopeAndSessionIds() {
    var jdbc = mock(JdbcClient.class);
    var statement = mock(JdbcClient.StatementSpec.class, RETURNS_SELF);
    var result = (JdbcClient.MappedQuerySpec<Extension>) mock(JdbcClient.MappedQuerySpec.class);
    UUID storeId = UUID.randomUUID();
    UUID firstSession = UUID.randomUUID();
    UUID secondSession = UUID.randomUUID();
    var first = extension(firstSession, "2026-10-03T14:20:00+08:00");
    var second = extension(firstSession, "2026-10-03T14:35:00+08:00");
    var third = extension(secondSession, "2026-10-03T14:50:00+08:00");
    when(jdbc.sql(ServiceSessionExtensionQueryService.extensionSql())).thenReturn(statement);
    when(statement.query(Extension.class)).thenReturn(result);
    when(result.list()).thenReturn(List.of(first, second, third));

    var rows = new ServiceSessionExtensionQueryService(jdbc).forSessions(storeId, List.of(firstSession, secondSession));

    verify(statement).param("store", storeId);
    verify(statement).param("sessions", List.of(firstSession, secondSession));
    assertThat(rows).hasSize(2);
    assertThat(rows.get(firstSession)).containsExactly(first, second);
    assertThat(rows.get(secondSession)).containsExactly(third);
  }

  @Test
  void emptySessionSelectionReturnsAnEmptyMapWithoutQueryingOtherServices() {
    var jdbc = mock(JdbcClient.class);

    assertThat(new ServiceSessionExtensionQueryService(jdbc).forSessions(UUID.randomUUID(), List.of())).isEmpty();
    verifyNoInteractions(jdbc);
  }

  @Test
  void existingExtensionEndpointUsesSharedDetailsAndPreservesNewestFirstOrdering() {
    var context = mock(StoreContextService.class);
    var policies = mock(ServiceDurationPolicyService.class);
    var queries = mock(ServiceSessionExtensionQueryService.class);
    UUID storeId = UUID.randomUUID();
    UUID sessionId = UUID.randomUUID();
    var first = extension(sessionId, "2026-10-03T14:20:00+08:00");
    var second = extension(sessionId, "2026-10-03T14:35:00+08:00");
    when(context.currentStore("Bearer fixture", storeId.toString())).thenReturn(storeId);
    when(queries.forSessions(storeId, List.of(sessionId))).thenReturn(Map.of(sessionId, List.of(first, second)));
    var controller = new ServiceSessionExtensionCancellationController(null, context, null, policies, null, queries);

    assertThat(controller.extensions(sessionId, "Bearer fixture", storeId.toString())).containsExactly(second, first);
    verify(policies).lockSession(storeId, sessionId);
    verify(queries).forSessions(storeId, List.of(sessionId));
  }

  @Test
  void unauthorizedStoreNeverReachesTheExtensionQuery() {
    var context = mock(StoreContextService.class);
    var policies = mock(ServiceDurationPolicyService.class);
    var queries = mock(ServiceSessionExtensionQueryService.class);
    when(context.currentStore("Bearer fixture", "another-store"))
        .thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN, "Store access denied"));
    var controller = new ServiceSessionExtensionCancellationController(null, context, null, policies, null, queries);

    assertThatThrownBy(() -> controller.extensions(UUID.randomUUID(), "Bearer fixture", "another-store"))
        .isInstanceOf(ResponseStatusException.class);
    verifyNoInteractions(queries, policies);
  }

  private Extension extension(UUID sessionId, String addedAt) {
    return new Extension(UUID.randomUUID(), sessionId, UUID.randomUUID(), "18", "Technician",
        UUID.randomUUID(), "Extension snapshot", 15900, (short) 60, OffsetDateTime.parse(addedAt));
  }
}
