package com.chengxin.massage.admin;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.server.ResponseStatusException;
import com.chengxin.massage.audit.AuditOutcomeFilter;

/** Centralizes endpoint permission checks while controllers retain store-scope validation. */
@Component
public class BusinessPermissionFilter extends OncePerRequestFilter {
  private final AdminSessionService adminSessions;

  BusinessPermissionFilter(AdminSessionService adminSessions) { this.adminSessions = adminSessions; }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String path = request.getRequestURI();
    if (!path.startsWith("/api/v1/") || HttpMethod.OPTIONS.matches(request.getMethod())) {
      chain.doFilter(request, response);
      return;
    }
    List<String> permissions = requiredPermissionsFor(path, request.getMethod());
    if (permissions.isEmpty()) {
      chain.doFilter(request, response);
      return;
    }
    request.setAttribute(AuditOutcomeFilter.REQUIRED_PERMISSIONS_ATTRIBUTE, permissions);
    try {
      String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
      boolean allowed = permissions.stream().anyMatch(permission -> adminSessions.hasPermission(authorization, permission));
      if (!allowed) {
        request.setAttribute(AuditOutcomeFilter.FAILURE_REASON_ATTRIBUTE, "Permission denied");
        response.sendError(HttpServletResponse.SC_FORBIDDEN, "Permission denied");
        return;
      }
      chain.doFilter(request, response);
    } catch (ResponseStatusException exception) {
      request.setAttribute(AuditOutcomeFilter.FAILURE_REASON_ATTRIBUTE, exception.getReason());
      response.sendError(exception.getStatusCode().value(), exception.getReason());
    }
  }

  private boolean isAuthenticationPath(String path) {
    return path.startsWith("/api/v1/admin/auth/") || path.startsWith("/api/v1/mobile/auth/") || path.startsWith("/api/v1/mobile/technician/");
  }

  List<String> requiredPermissionsFor(String path, String method) {
    if (isAuthenticationPath(path)) return List.of();
    Requirement requirement = requirement(path, method);
    return requirement == null ? List.of() : requirement.permissions();
  }

  private Requirement requirement(String path, String method) {
    if (path.startsWith("/api/v1/admin/access/")) return null;
    if (path.startsWith("/api/v1/admin/technician-accounts")) return required("ACCOUNT_MANAGE");
    if (path.startsWith("/api/v1/employees")) return required("FOUNDATION_MANAGE");
    if (path.startsWith("/api/v1/foundation")) {
      if (!isRead(method)) return required("FOUNDATION_MANAGE");
      // Historical backfill only needs the same read-only foundation slices
      // that its form renders. Keep unrelated foundation reads on the
      // existing cashier/admin permission boundary.
      boolean backfillRead = path.equals("/api/v1/foundation/rooms")
        || path.equals("/api/v1/foundation/technicians")
        || path.equals("/api/v1/foundation/service-items");
      return backfillRead
        ? any("FRONTDESK_SETTLE", "FOUNDATION_MANAGE", "HISTORICAL_ORDER_CREATE")
        : any("FRONTDESK_SETTLE", "FOUNDATION_MANAGE");
    }
    if (path.startsWith("/api/v1/rooms")) {
      if (isRead(method)) {
        return path.equals("/api/v1/rooms/statuses")
          ? any("FRONTDESK_SETTLE", "FOUNDATION_MANAGE", "HISTORICAL_ORDER_CREATE")
          : any("FRONTDESK_SETTLE", "FOUNDATION_MANAGE");
      }
      if (path.contains("/status") || path.contains("complete-cleaning") || path.contains("confirm-payment")) return required("FRONTDESK_SETTLE");
      return required("FOUNDATION_MANAGE");
    }
    if (path.startsWith("/api/v1/service-duration-policy")) {
      return isRead(method) ? any("FOUNDATION_MANAGE", "SERVICE_DURATION_OVERRIDE") : required("SERVICE_DURATION_OVERRIDE");
    }
    if (path.matches("^/api/v1/service-sessions/[^/]+/duration-changes$")) {
      return any("FRONTDESK_SETTLE", "SERVICE_DURATION_OVERRIDE", "REPORT_VIEW");
    }
    if (path.matches("^/api/v1/service-sessions/[^/]+/duration$")) {
      return required("SERVICE_DURATION_OVERRIDE");
    }
    if (path.startsWith("/api/v1/service-sessions")) return required("FRONTDESK_SETTLE");
    if (path.startsWith("/api/v1/service-change-history")) return required("REPORT_VIEW");
    if (path.startsWith("/api/v1/technician-queue")) return isRead(method) ? any("FRONTDESK_SETTLE", "FOUNDATION_MANAGE") : required("FOUNDATION_MANAGE");
    if (path.startsWith("/api/v1/service-categories")) return isRead(method) ? any("FRONTDESK_SETTLE", "FOUNDATION_MANAGE") : required("FOUNDATION_MANAGE");
    if (path.startsWith("/api/v1/service-reservations")) return isRead(method) ? any("FRONTDESK_SETTLE", "FOUNDATION_MANAGE") : required("FRONTDESK_SETTLE");
    if (path.startsWith("/api/v1/service-transfer-requests")) return isRead(method) ? required("FRONTDESK_SETTLE") : required("FRONTDESK_SETTLE");
    if (path.startsWith("/api/v1/service-room-transfers")) return roomTransferRequirement(path, method);
    if (path.startsWith("/api/v1/technician-performance")) return required("REPORT_VIEW");
    if (path.startsWith("/api/v1/technician-schedules")) return required("FOUNDATION_MANAGE");
    if (path.startsWith("/api/v1/members")) return isRead(method) ? any("FRONTDESK_SETTLE", "MEMBER_MANAGE") : required("MEMBER_MANAGE");
    if (path.startsWith("/api/v1/member-recharge-refunds")) return isRead(method) ? any("FRONTDESK_SETTLE", "MEMBER_MANAGE") : required("MEMBER_MANAGE");
    if (path.startsWith("/api/v1/wallet-transactions")) return any("FRONTDESK_SETTLE", "MEMBER_MANAGE");
    if (path.startsWith("/api/v1/audits/export")) return required("AUDIT_EXPORT");
    if (path.startsWith("/api/v1/audits")) return required("AUDIT_VIEW");
    if (path.startsWith("/api/v1/security-alerts/rules")) return required("ALERT_CONFIG");
    if (path.startsWith("/api/v1/security-alerts")) return isRead(method) ? required("ALERT_VIEW") : required("ALERT_HANDLE");
    if (path.startsWith("/api/v1/daily-reports")) return dailyReportRequirement(path, method);
    if (path.startsWith("/api/v1/monthly-targets")) return isRead(method) ? any("REPORT_VIEW", "DAILY_REPORT_CONFIG") : required("DAILY_REPORT_CONFIG");
    if (path.startsWith("/api/v1/operations")) return required("REPORT_VIEW");
    if (path.startsWith("/api/v1/finance/expense-claims")) {
      return path.endsWith("/pay") ? required("EXPENSE_PAY") : required("EXPENSE_REVIEW");
    }
    // Historical backfills are a separately granted capability. Keep this
    // route ahead of the generic sales-order rule so a cashier's normal
    // settlement permission cannot implicitly create backfill orders.
    if (path.equals("/api/v1/sales-orders/historical-backfill")
        || path.equals("/api/v1/sales-orders/historical-backfills/mine")) {
      return required("HISTORICAL_ORDER_CREATE");
    }
    if (path.matches("^/api/v1/sales-orders/[^/]+/refunds$")) return isRead(method) ? any("FRONTDESK_SETTLE", "ORDER_REFUND") : required("ORDER_REFUND");
    if (path.startsWith("/api/v1/sales-orders")) return required("FRONTDESK_SETTLE");
    if (path.startsWith("/api/v1/refunds")) return required("ORDER_REFUND");
    if (path.startsWith("/api/v1/payment-methods")) {
      if (!isRead(method)) return required("FOUNDATION_MANAGE");
      return path.equals("/api/v1/payment-methods")
        ? any("FRONTDESK_SETTLE", "FOUNDATION_MANAGE", "HISTORICAL_ORDER_CREATE")
        : any("FRONTDESK_SETTLE", "FOUNDATION_MANAGE");
    }
    if (path.startsWith("/api/v1/print-settings")) return isRead(method) ? any("FRONTDESK_SETTLE", "FOUNDATION_MANAGE") : required("FOUNDATION_MANAGE");
    if (path.startsWith("/api/v1/commissions")) return isRead(method) ? any("REPORT_VIEW", "FOUNDATION_MANAGE") : required("FOUNDATION_MANAGE");
    return null;
  }

  private Requirement dailyReportRequirement(String path, String method) {
    if (path.endsWith("/settings") || path.contains("/settings?")) return required("DAILY_REPORT_CONFIG");
    if (path.endsWith("/publish")) return required("DAILY_REPORT_PUBLISH");
    if (path.contains("/revisions")) return required("DAILY_REPORT_VIEW");
    if (HttpMethod.GET.matches(method)) return required("DAILY_REPORT_VIEW");
    return required("DAILY_REPORT_EDIT");
  }

  private Requirement roomTransferRequirement(String path, String method) {
    if (path.endsWith("/approve") || path.endsWith("/reject") || isRead(method)) return required("ROOM_TRANSFER_APPROVE");
    return any("ROOM_TRANSFER_REQUEST", "ROOM_TRANSFER_APPROVE");
  }

  private boolean isRead(String method) { return HttpMethod.GET.matches(method); }
  private Requirement required(String permission) { return new Requirement(List.of(permission)); }
  private Requirement any(String... permissions) { return new Requirement(List.of(permissions)); }
  private record Requirement(List<String> permissions) {}
}
