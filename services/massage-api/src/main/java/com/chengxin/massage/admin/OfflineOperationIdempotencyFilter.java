package com.chengxin.massage.admin;

import com.chengxin.massage.mobile.MobileSessionService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Objects;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.ContentCachingResponseWrapper;
import org.springframework.web.util.UrlPathHelper;

/** Commits the business write and its actor-bound receipt atomically. */
@Component
public class OfflineOperationIdempotencyFilter extends OncePerRequestFilter {
  static final String OPERATION_HEADER = "X-Offline-Operation-Id";
  private final JdbcClient jdbc;
  private final AdminSessionService adminSessions;
  private final MobileSessionService mobileSessions;
  private final StoreContextService storeContext;
  private final TransactionTemplate transaction;

  OfflineOperationIdempotencyFilter(JdbcClient jdbc, AdminSessionService adminSessions,
      MobileSessionService mobileSessions, StoreContextService storeContext, PlatformTransactionManager transactions) {
    this.jdbc = jdbc;
    this.adminSessions = adminSessions;
    this.mobileSessions = mobileSessions;
    this.storeContext = storeContext;
    this.transaction = new TransactionTemplate(transactions);
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return request.getHeader(OPERATION_HEADER) == null || HttpMethod.GET.matches(request.getMethod())
      || !supportedPath(UrlPathHelper.defaultInstance.getPathWithinApplication(request));
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    UUID operationId;
    try { operationId = UUID.fromString(request.getHeader(OPERATION_HEADER)); }
    catch (IllegalArgumentException exception) {
      response.sendError(HttpServletResponse.SC_BAD_REQUEST, "Invalid offline operation id");
      return;
    }
    String path = UrlPathHelper.defaultInstance.getPathWithinApplication(request);
    try {
      Identity identity = identity(request, path);
      byte[] body = request.getInputStream().readAllBytes();
      String hash = digest(body);
      String requestPath = path + (request.getQueryString() == null ? "" : "?" + request.getQueryString());
      BufferedResponse buffered = new BufferedResponse(response);
      transaction.executeWithoutResult(status -> {
        int inserted = jdbc.sql("""
          insert into offline_operation_receipt(operation_id,request_method,request_path,status,user_id,store_id,request_hash)
          values(:id,:method,:path,'PROCESSING',:user,:store,:hash) on conflict do nothing
          """).param("id", operationId).param("method", request.getMethod()).param("path", requestPath)
          .param("user", identity.userId()).param("store", identity.storeId()).param("hash", hash).update();
        if (inserted == 0) {
          Receipt existing = jdbc.sql("select request_method,request_path,status,user_id,store_id,request_hash from offline_operation_receipt where operation_id=:id")
            .param("id", operationId).query(Receipt.class).single();
          if (!Objects.equals(existing.userId(), identity.userId()) || !Objects.equals(existing.storeId(), identity.storeId())
              || !Objects.equals(existing.requestHash(), hash) || !existing.requestMethod().equals(request.getMethod())
              || !existing.requestPath().equals(requestPath)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Offline operation id belongs to another request or requires legacy reconciliation");
          }
          if (!"APPLIED".equals(existing.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Offline receipt requires manual reconciliation before retry");
          }
          buffered.setStatus(HttpServletResponse.SC_NO_CONTENT);
          buffered.setHeader("X-Offline-Operation-Replayed", "true");
          return;
        }
        try { chain.doFilter(new BodyRequest(request, body), buffered); }
        catch (IOException | ServletException exception) { throw new FilterFailure(exception); }
        if (buffered.getStatus() >= 200 && buffered.getStatus() < 300) {
          jdbc.sql("update offline_operation_receipt set status='APPLIED',response_status=:status,applied_at=now() where operation_id=:id")
            .param("id", operationId).param("status", buffered.getStatus()).update();
        } else status.setRollbackOnly();
      });
      buffered.copyBodyToResponse();
    } catch (ResponseStatusException exception) {
      response.resetBuffer();
      response.sendError(exception.getStatusCode().value(), exception.getReason());
    } catch (FilterFailure exception) {
      if (exception.getCause() instanceof IOException io) throw io;
      throw (ServletException) exception.getCause();
    }
  }

  private Identity identity(HttpServletRequest request, String path) {
    String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
    if (path.startsWith("/api/v1/mobile/technician/")) {
      UUID user = mobileSessions.requireUserId(authorization);
      UUID store = jdbc.sql("""
        select b.store_id from technician_account_binding b
        join technician t on t.id=b.technician_id and t.store_id=b.store_id
        join store s on s.id=b.store_id and s.tenant_id=b.tenant_id
        where b.user_id=:user and b.active=true and t.active=true and s.active=true
        """).param("user", user).query(UUID.class).optional()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Technician account is unavailable"));
      return new Identity(user, store);
    }
    UUID store = storeContext.currentStore(authorization, request.getHeader("X-Store-Id"));
    return new Identity(adminSessions.authenticatedIdentity(authorization).userId(), store);
  }

  static String digest(byte[] body) {
    try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body)); }
    catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
  }

  private boolean supportedPath(String path) {
    return path.startsWith("/api/v1/service-sessions") || path.startsWith("/api/v1/service-reservations")
      || path.startsWith("/api/v1/service-room-transfers") || path.matches("^/api/v1/rooms/[^/]+/(status|complete-cleaning|confirm-payment)$")
      || path.startsWith("/api/v1/mobile/technician/")
      || path.matches("^/api/v1/sales-orders/(settle|[^/]+/(void|refunds))$")
      || path.equals("/api/v1/sales-orders/historical-backfill")
      || path.startsWith("/api/v1/refunds")
      || path.matches("^/api/v1/members/[^/]+/recharges$")
      || path.equals("/api/v1/member-wallet/recharge");
  }

  record Identity(UUID userId, UUID storeId) {}
  record Receipt(String requestMethod, String requestPath, String status, UUID userId, UUID storeId, String requestHash) {}
  private static final class FilterFailure extends RuntimeException {
    FilterFailure(Exception cause) { super(cause); }
  }
  private static final class BufferedResponse extends ContentCachingResponseWrapper {
    BufferedResponse(HttpServletResponse response) { super(response); }
    @Override public void sendError(int status) { setStatus(status); }
    @Override public void sendError(int status, String message) { setStatus(status); }
  }
  private static final class BodyRequest extends HttpServletRequestWrapper {
    private final byte[] body;
    BodyRequest(HttpServletRequest request, byte[] body) { super(request); this.body = body; }
    @Override public ServletInputStream getInputStream() {
      ByteArrayInputStream input = new ByteArrayInputStream(body);
      return new ServletInputStream() {
        @Override public int read() { return input.read(); }
        @Override public boolean isFinished() { return input.available() == 0; }
        @Override public boolean isReady() { return true; }
        @Override public void setReadListener(ReadListener listener) { throw new UnsupportedOperationException("Synchronous request body"); }
      };
    }
    @Override public BufferedReader getReader() {
      return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
    }
  }
}
