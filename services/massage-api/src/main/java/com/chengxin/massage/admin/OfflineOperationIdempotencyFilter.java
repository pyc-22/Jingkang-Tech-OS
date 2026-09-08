package com.chengxin.massage.admin;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;
import java.io.IOException;
import java.util.UUID;
import org.springframework.http.HttpMethod;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Makes queued offline service actions replay-safe without applying the same action twice. */
@Component
public class OfflineOperationIdempotencyFilter extends OncePerRequestFilter {
  static final String OPERATION_HEADER = "X-Offline-Operation-Id";
  private final JdbcClient jdbc;

  OfflineOperationIdempotencyFilter(JdbcClient jdbc) { this.jdbc = jdbc; }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return request.getHeader(OPERATION_HEADER) == null || HttpMethod.GET.matches(request.getMethod()) || !supportedPath(request.getRequestURI());
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    UUID operationId;
    try { operationId = UUID.fromString(request.getHeader(OPERATION_HEADER)); }
    catch (IllegalArgumentException exception) { response.sendError(HttpServletResponse.SC_BAD_REQUEST, "Invalid offline operation id"); return; }
    Receipt existing = jdbc.sql("select operation_id,status from offline_operation_receipt where operation_id=:id")
      .param("id", operationId).query(Receipt.class).optional().orElse(null);
    if (existing != null) {
      if ("APPLIED".equals(existing.status())) {
        response.setStatus(HttpServletResponse.SC_NO_CONTENT);
        response.setHeader("X-Offline-Operation-Replayed", "true");
      } else response.sendError(HttpServletResponse.SC_CONFLICT, "Offline operation is already processing");
      return;
    }
    int inserted = jdbc.sql("insert into offline_operation_receipt(operation_id,request_method,request_path,status) values(:id,:method,:path,'PROCESSING') on conflict do nothing")
      .param("id", operationId).param("method", request.getMethod()).param("path", request.getRequestURI()).update();
    if (inserted == 0) { response.sendError(HttpServletResponse.SC_CONFLICT, "Offline operation is already processing"); return; }
    StatusResponse wrapped = new StatusResponse(response);
    try {
      chain.doFilter(request, wrapped);
      if (wrapped.status() >= 200 && wrapped.status() < 300) {
        jdbc.sql("update offline_operation_receipt set status='APPLIED',response_status=:status,applied_at=now() where operation_id=:id")
          .param("id", operationId).param("status", wrapped.status()).update();
      } else discard(operationId);
    } catch (IOException | ServletException | RuntimeException exception) {
      discard(operationId);
      throw exception;
    }
  }

  private void discard(UUID operationId) { jdbc.sql("delete from offline_operation_receipt where operation_id=:id and status='PROCESSING'").param("id", operationId).update(); }
  private boolean supportedPath(String path) {
    return path.startsWith("/api/v1/service-sessions") || path.startsWith("/api/v1/service-reservations")
      || path.startsWith("/api/v1/service-room-transfers") || path.matches("^/api/v1/rooms/[^/]+/(status|complete-cleaning|confirm-payment)$")
      || path.startsWith("/api/v1/mobile/technician/")
      || path.matches("^/api/v1/sales-orders/(settle|[^/]+/(void|refunds))$")
      || path.startsWith("/api/v1/refunds")
      || path.matches("^/api/v1/members/[^/]+/recharges$")
      || path.equals("/api/v1/member-wallet/recharge");
  }
  record Receipt(UUID operationId, String status) {}
  private static final class StatusResponse extends HttpServletResponseWrapper {
    private int status = HttpServletResponse.SC_OK;
    StatusResponse(HttpServletResponse response) { super(response); }
    int status() { return status; }
    @Override public void setStatus(int status) { this.status = status; super.setStatus(status); }
    @Override public void sendError(int status) throws IOException { this.status = status; super.sendError(status); }
    @Override public void sendError(int status, String message) throws IOException { this.status = status; super.sendError(status, message); }
    @Override public void sendRedirect(String location) throws IOException { this.status = HttpServletResponse.SC_FOUND; super.sendRedirect(location); }
  }
}
