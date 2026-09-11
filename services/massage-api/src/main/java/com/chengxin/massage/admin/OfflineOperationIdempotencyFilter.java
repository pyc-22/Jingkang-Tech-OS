package com.chengxin.massage.admin;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;
import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpMethod;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Makes queued offline service actions replay-safe without applying the same action twice. */
@Component
public class OfflineOperationIdempotencyFilter extends OncePerRequestFilter {
  static final String OPERATION_HEADER = "X-Offline-Operation-Id";
  private static final int PROCESSING_WAIT_ATTEMPTS = 100;
  private static final long PROCESSING_WAIT_MILLIS = 50L;
  private static final Logger LOGGER = LoggerFactory.getLogger(OfflineOperationIdempotencyFilter.class);
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
    catch (IllegalArgumentException exception) {
      LOGGER.warn("Offline operation rejected: method={}, path={}, operationId={}, httpStatus=400, cause=invalid UUID",
        request.getMethod(), request.getRequestURI(), request.getHeader(OPERATION_HEADER));
      response.sendError(HttpServletResponse.SC_BAD_REQUEST, "Invalid offline operation id");
      return;
    }
    if (!claim(operationId, request, response)) return;
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

  private Receipt receipt(UUID operationId) {
    return jdbc.sql("select operation_id,request_method,request_path,status,created_at from offline_operation_receipt where operation_id=:id")
      .param("id", operationId).query(Receipt.class).optional().orElse(null);
  }

  private boolean claim(UUID operationId, HttpServletRequest request, HttpServletResponse response) throws IOException {
    while (true) {
      Receipt existing = receipt(operationId);
      if (existing != null && handleExisting(existing, request, response)) return false;
      int inserted = jdbc.sql("insert into offline_operation_receipt(operation_id,request_method,request_path,status) values(:id,:method,:path,'PROCESSING') on conflict do nothing")
        .param("id", operationId).param("method", request.getMethod()).param("path", request.getRequestURI()).update();
      if (inserted == 1) return true;
    }
  }

  private boolean handleExisting(Receipt existing, HttpServletRequest request, HttpServletResponse response) throws IOException {
    if (!existing.requestMethod().equals(request.getMethod()) || !existing.requestPath().equals(request.getRequestURI())) {
      LOGGER.warn("Offline operation id reused for another request: operationId={}, originalMethod={}, originalPath={}, method={}, path={}, httpStatus=409",
        existing.operationId(), existing.requestMethod(), existing.requestPath(), request.getMethod(), request.getRequestURI());
      response.sendError(HttpServletResponse.SC_CONFLICT, "Offline operation id belongs to another request");
      return true;
    }
    Receipt current = existing;
    for (int attempt = 0; attempt < PROCESSING_WAIT_ATTEMPTS; attempt++) {
      if ("APPLIED".equals(current.status())) {
        response.setStatus(HttpServletResponse.SC_NO_CONTENT);
        response.setHeader("X-Offline-Operation-Replayed", "true");
        return true;
      }
      try {
        Thread.sleep(PROCESSING_WAIT_MILLIS);
      } catch (InterruptedException exception) {
        Thread.currentThread().interrupt();
        break;
      }
      current = receipt(existing.operationId());
      if (current == null) return false;
    }
    if ("APPLIED".equals(current.status())) {
      response.setStatus(HttpServletResponse.SC_NO_CONTENT);
      response.setHeader("X-Offline-Operation-Replayed", "true");
      return true;
    }
    LOGGER.warn("Offline operation is still processing: method={}, path={}, operationId={}, createdAt={}, httpStatus=503",
      request.getMethod(), request.getRequestURI(), existing.operationId(), existing.createdAt());
    response.setHeader("Retry-After", "1");
    response.sendError(HttpServletResponse.SC_SERVICE_UNAVAILABLE, "Offline operation is still processing");
    return true;
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
  record Receipt(UUID operationId, String requestMethod, String requestPath, String status, OffsetDateTime createdAt) {}
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
