package com.chengxin.massage.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.chengxin.massage.audit.AuditOutcomeFilter;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class HistoricalBackfillPermissionFilterTest {
  private static final String TOKEN = "Bearer historical-token";

  @Test
  void protectsBackfillCreationWithTheDedicatedPermission() {
    BusinessPermissionFilter filter = new BusinessPermissionFilter(null);

    assertThat(filter.requiredPermissionsFor(
        "/api/v1/sales-orders/historical-backfill", "POST"))
        .containsExactly("HISTORICAL_ORDER_CREATE");
  }

  @Test
  void protectsScopedManagerHistoryWithTheDedicatedPermission() {
    BusinessPermissionFilter filter = new BusinessPermissionFilter(null);

    assertThat(filter.requiredPermissionsFor(
        "/api/v1/sales-orders/historical-backfills/mine", "GET"))
        .containsExactly("HISTORICAL_ORDER_CREATE");
  }

  @Test
  void letsGrantedManagersReadTheFoundationDataRequiredByTheBackfillForm() {
    BusinessPermissionFilter filter = new BusinessPermissionFilter(null);

    assertThat(filter.requiredPermissionsFor("/api/v1/foundation/service-items", "GET"))
        .contains("HISTORICAL_ORDER_CREATE");
    assertThat(filter.requiredPermissionsFor("/api/v1/foundation/technicians", "GET"))
        .contains("HISTORICAL_ORDER_CREATE");
    assertThat(filter.requiredPermissionsFor("/api/v1/foundation/rooms", "GET"))
        .contains("HISTORICAL_ORDER_CREATE");
    assertThat(filter.requiredPermissionsFor("/api/v1/rooms/statuses", "GET"))
        .contains("HISTORICAL_ORDER_CREATE");
    assertThat(filter.requiredPermissionsFor("/api/v1/payment-methods", "GET"))
        .contains("HISTORICAL_ORDER_CREATE");
  }

  @Test
  void leavesTenantAdminBackfillManagementRoutesToTheirControllerGuard() {
    BusinessPermissionFilter filter = new BusinessPermissionFilter(null);

    assertThat(filter.requiredPermissionsFor(
        "/api/v1/admin/access/stores/00000000-0000-0000-0000-000000000001/backfill-managers",
        "GET")).isEmpty();
    assertThat(filter.requiredPermissionsFor(
        "/api/v1/admin/access/stores/00000000-0000-0000-0000-000000000001/backfill-managers/00000000-0000-0000-0000-000000000002",
        "PUT")).isEmpty();
    assertThat(filter.requiredPermissionsFor(
        "/api/v1/admin/access/historical-backfills", "GET")).isEmpty();
  }

  @Test
  void deniesBackfillCreationWhenTheDedicatedPermissionIsMissing() throws Exception {
    AdminSessionService sessions = mock(AdminSessionService.class);
    when(sessions.hasPermission(TOKEN, "HISTORICAL_ORDER_CREATE")).thenReturn(false);
    BusinessPermissionFilter filter = new BusinessPermissionFilter(sessions);
    MockHttpServletRequest request = new MockHttpServletRequest(
        "POST", "/api/v1/sales-orders/historical-backfill");
    request.addHeader(HttpHeaders.AUTHORIZATION, TOKEN);
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockFilterChain chain = new MockFilterChain();

    filter.doFilter(request, response, chain);

    assertThat(response.getStatus()).isEqualTo(403);
    assertThat(chain.getRequest()).isNull();
    assertThat(request.getAttribute(AuditOutcomeFilter.REQUIRED_PERMISSIONS_ATTRIBUTE))
        .isEqualTo(List.of("HISTORICAL_ORDER_CREATE"));
    verify(sessions).hasPermission(TOKEN, "HISTORICAL_ORDER_CREATE");
  }

  @Test
  void forwardsBackfillCreationWhenTheDedicatedPermissionIsGranted() throws Exception {
    AdminSessionService sessions = mock(AdminSessionService.class);
    when(sessions.hasPermission(TOKEN, "HISTORICAL_ORDER_CREATE")).thenReturn(true);
    BusinessPermissionFilter filter = new BusinessPermissionFilter(sessions);
    MockHttpServletRequest request = new MockHttpServletRequest(
        "POST", "/api/v1/sales-orders/historical-backfill");
    request.addHeader(HttpHeaders.AUTHORIZATION, TOKEN);
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockFilterChain chain = new MockFilterChain();

    filter.doFilter(request, response, chain);

    assertThat(response.getStatus()).isEqualTo(200);
    assertThat(chain.getRequest()).isSameAs(request);
    verify(sessions).hasPermission(TOKEN, "HISTORICAL_ORDER_CREATE");
    verify(sessions, never()).hasPermission(anyString(), org.mockito.ArgumentMatchers.eq("FRONTDESK_SETTLE"));
  }
}
