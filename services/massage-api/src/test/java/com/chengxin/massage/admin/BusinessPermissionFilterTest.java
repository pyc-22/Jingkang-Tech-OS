package com.chengxin.massage.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class BusinessPermissionFilterTest {
  private final BusinessPermissionFilter filter = new BusinessPermissionFilter(null);

  @Test
  void mapsReadAndWriteOperationsToDifferentPermissions() {
    assertThat(filter.requiredPermissionsFor("/api/v1/foundation/technicians", "GET"))
      .containsExactly("FRONTDESK_SETTLE", "FOUNDATION_MANAGE");
    assertThat(filter.requiredPermissionsFor("/api/v1/foundation/technicians", "POST"))
      .containsExactly("FOUNDATION_MANAGE");
    assertThat(filter.requiredPermissionsFor("/api/v1/employees", "GET"))
      .containsExactly("FOUNDATION_MANAGE");
    assertThat(filter.requiredPermissionsFor("/api/v1/rooms/ROOM/status", "POST"))
      .containsExactly("FRONTDESK_SETTLE");
    assertThat(filter.requiredPermissionsFor("/api/v1/members", "POST"))
      .containsExactly("MEMBER_MANAGE");
    assertThat(filter.requiredPermissionsFor("/api/v1/service-room-transfers", "POST"))
      .containsExactly("ROOM_TRANSFER_REQUEST", "ROOM_TRANSFER_APPROVE");
    assertThat(filter.requiredPermissionsFor("/api/v1/service-room-transfers/00000000-0000-0000-0000-000000000000/approve", "POST"))
      .containsExactly("ROOM_TRANSFER_APPROVE");
    assertThat(filter.requiredPermissionsFor("/api/v1/service-sessions/00000000-0000-0000-0000-000000000000/participants/transfer", "POST"))
      .containsExactly("FRONTDESK_SETTLE");
    assertThat(filter.requiredPermissionsFor("/api/v1/service-duration-policy", "GET"))
      .containsExactly("FOUNDATION_MANAGE", "SERVICE_DURATION_OVERRIDE");
    assertThat(filter.requiredPermissionsFor("/api/v1/service-duration-policy", "PUT"))
      .containsExactly("SERVICE_DURATION_OVERRIDE");
    assertThat(filter.requiredPermissionsFor("/api/v1/service-sessions/00000000-0000-0000-0000-000000000000/duration", "PUT"))
      .containsExactly("SERVICE_DURATION_OVERRIDE");
    assertThat(filter.requiredPermissionsFor("/api/v1/service-sessions/00000000-0000-0000-0000-000000000000/duration-changes", "GET"))
      .containsExactly("FRONTDESK_SETTLE", "SERVICE_DURATION_OVERRIDE", "REPORT_VIEW");
    assertThat(filter.requiredPermissionsFor("/api/v1/service-categories", "GET"))
      .containsExactly("FRONTDESK_SETTLE", "FOUNDATION_MANAGE");
    assertThat(filter.requiredPermissionsFor("/api/v1/service-categories", "POST"))
      .containsExactly("FOUNDATION_MANAGE");
    assertThat(filter.requiredPermissionsFor("/api/v1/service-reservations", "GET"))
      .containsExactly("FRONTDESK_SETTLE", "FOUNDATION_MANAGE");
    assertThat(filter.requiredPermissionsFor("/api/v1/service-reservations/00000000-0000-0000-0000-000000000000/dispatch", "POST"))
      .containsExactly("FRONTDESK_SETTLE");
    assertThat(filter.requiredPermissionsFor("/api/v1/service-transfer-requests", "POST"))
      .containsExactly("FRONTDESK_SETTLE");
    assertThat(filter.requiredPermissionsFor("/api/v1/member-recharge-refunds", "GET"))
      .containsExactly("FRONTDESK_SETTLE", "MEMBER_MANAGE");
    assertThat(filter.requiredPermissionsFor("/api/v1/member-recharge-refunds/00000000-0000-0000-0000-000000000000/complete", "POST"))
      .containsExactly("MEMBER_MANAGE");
  }

  @Test
  void protectsReportsAccountsAndRefunds() {
    assertThat(filter.requiredPermissionsFor("/api/v1/operations/daily-report", "GET"))
      .containsExactly("REPORT_VIEW");
    assertThat(filter.requiredPermissionsFor("/api/v1/admin/technician-accounts", "GET"))
      .containsExactly("ACCOUNT_MANAGE");
    assertThat(filter.requiredPermissionsFor("/api/v1/refunds", "GET"))
      .containsExactly("ORDER_REFUND");
    assertThat(filter.requiredPermissionsFor("/api/v1/sales-orders/00000000-0000-0000-0000-000000000000/refunds", "GET"))
      .containsExactly("FRONTDESK_SETTLE", "ORDER_REFUND");
    assertThat(filter.requiredPermissionsFor("/api/v1/sales-orders/00000000-0000-0000-0000-000000000000/refunds", "POST"))
      .containsExactly("ORDER_REFUND");
    assertThat(filter.requiredPermissionsFor("/api/v1/audits", "GET"))
      .containsExactly("AUDIT_VIEW");
    assertThat(filter.requiredPermissionsFor("/api/v1/audits/00000000-0000-0000-0000-000000000000", "GET"))
      .containsExactly("AUDIT_VIEW");
    assertThat(filter.requiredPermissionsFor("/api/v1/audits/export", "GET"))
      .containsExactly("AUDIT_EXPORT");
    assertThat(filter.requiredPermissionsFor("/api/v1/security-alerts", "GET"))
      .containsExactly("ALERT_VIEW");
    assertThat(filter.requiredPermissionsFor("/api/v1/security-alerts/00000000-0000-0000-0000-000000000000/status", "POST"))
      .containsExactly("ALERT_HANDLE");
    assertThat(filter.requiredPermissionsFor("/api/v1/security-alerts/rules", "GET"))
      .containsExactly("ALERT_CONFIG");
  }

  @Test
  void keepsAuthenticationAndTechnicianMobileRoutesOnTheirOwnSessionFlow() {
    assertThat(filter.requiredPermissionsFor("/api/v1/admin/auth/login", "POST")).isEmpty();
    assertThat(filter.requiredPermissionsFor("/api/v1/mobile/auth/login", "POST")).isEmpty();
    assertThat(filter.requiredPermissionsFor("/api/v1/mobile/technician/me", "GET")).isEmpty();
  }

  @Test
  void grantsDurationOverrideToTheDefaultCashierRole() throws IOException {
    try (InputStream migration = getClass().getResourceAsStream(
        "/db/migration/V69__frontdesk_service_duration_override.sql")) {
      assertThat(migration).as("front-desk duration permission migration").isNotNull();
      String sql = new String(migration.readAllBytes(), StandardCharsets.UTF_8);
      assertThat(sql).contains("role.code = 'CASHIER'")
          .contains("permission.code = 'SERVICE_DURATION_OVERRIDE'");
    }
  }

  @Test
  void blocksAuditRequestsWithoutAuditViewPermission() throws Exception {
    AdminSessionService sessions = mock(AdminSessionService.class);
    when(sessions.hasPermission("Bearer test-token", "AUDIT_VIEW")).thenReturn(false);
    BusinessPermissionFilter permissionFilter = new BusinessPermissionFilter(sessions);
    MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/audits");
    request.addHeader(HttpHeaders.AUTHORIZATION, "Bearer test-token");
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockFilterChain chain = new MockFilterChain();

    permissionFilter.doFilter(request, response, chain);

    assertThat(response.getStatus()).isEqualTo(403);
    assertThat(chain.getRequest()).isNull();
  }
}
