package com.chengxin.massage.audit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.web.ErrorResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.ContentCachingRequestWrapper;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class AuditOutcomeFilter extends OncePerRequestFilter {
  public static final String REQUIRED_PERMISSIONS_ATTRIBUTE = AuditOutcomeFilter.class.getName() + ".requiredPermissions";
  public static final String FAILURE_REASON_ATTRIBUTE = AuditOutcomeFilter.class.getName() + ".failureReason";
  public static final String SUPPRESS_OUTCOME_AUDIT_ATTRIBUTE = AuditOutcomeFilter.class.getName() + ".suppressOutcomeAudit";
  private static final Pattern UUID_PATTERN = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
  private static final Logger LOGGER = LoggerFactory.getLogger(AuditOutcomeFilter.class);
  private final AuditService audits;
  private final ObjectMapper objectMapper;

  AuditOutcomeFilter(AuditService audits, ObjectMapper objectMapper) {
    this.audits = audits;
    this.objectMapper = objectMapper;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    if (!request.getRequestURI().startsWith("/api/v1/") || HttpMethod.OPTIONS.matches(request.getMethod())) {
      chain.doFilter(request, response);
      return;
    }
    ContentCachingRequestWrapper wrapped = new ContentCachingRequestWrapper(request, 16 * 1024);
    Exception requestFailure = null;
    try {
      chain.doFilter(wrapped, response);
    } catch (IOException | ServletException | RuntimeException exception) {
      requestFailure = exception;
      throw exception;
    } finally {
      int status = requestFailure == null ? response.getStatus() : statusFromFailure(requestFailure, response.getStatus());
      if (status == HttpServletResponse.SC_BAD_REQUEST || status == HttpServletResponse.SC_CONFLICT) {
        LOGGER.warn("HTTP write rejected: method={}, path={}, query={}, storeId={}, operationId={}, status={}, reason={}",
          request.getMethod(), request.getRequestURI(), request.getQueryString(),
          request.getHeader("X-Store-Id"), request.getHeader("X-Offline-Operation-Id"), status,
          failureReason(request, status, requestFailure));
      }
      if (shouldAudit(status, request.getMethod())
          && !Boolean.TRUE.equals(wrapped.getAttribute(SUPPRESS_OUTCOME_AUDIT_ATTRIBUTE))) {
        record(wrapped, status, requestFailure);
      }
    }
  }

  private int statusFromFailure(Exception failure, int responseStatus) {
    if (failure instanceof ResponseStatusException responseStatusException) {
      return responseStatusException.getStatusCode().value();
    }
    if (failure instanceof ErrorResponse errorResponse) {
      return errorResponse.getStatusCode().value();
    }
    return responseStatus >= HttpServletResponse.SC_BAD_REQUEST
      ? responseStatus : HttpServletResponse.SC_INTERNAL_SERVER_ERROR;
  }

  private boolean shouldAudit(int status, String method) {
    if (status == HttpServletResponse.SC_UNAUTHORIZED || status == HttpServletResponse.SC_FORBIDDEN) return true;
    if (status >= 500) return true;
    return status >= 400 && !HttpMethod.GET.matches(method) && !HttpMethod.HEAD.matches(method);
  }

  private void record(ContentCachingRequestWrapper request, int status, Exception failure) {
    try {
      boolean denied = status == HttpServletResponse.SC_UNAUTHORIZED || status == HttpServletResponse.SC_FORBIDDEN;
      String path = request.getRequestURI();
      String action = path.endsWith("/auth/login") ? "LOGIN_FAILED" : denied ? "ACCESS_DENIED" : "REQUEST_FAILED";
      String entityType = path.endsWith("/auth/login") ? "authentication" : "request";
      String result = denied ? "DENIED" : "FAILED";
      String reason = failureReason(request, status, failure);
      Map<String, Object> context = new LinkedHashMap<>();
      context.put("httpStatus", status);
      context.put("requestedStoreId", blankToNull(request.getHeader("X-Store-Id")));
      Object required = request.getAttribute(REQUIRED_PERMISSIONS_ATTRIBUTE);
      if (required != null) context.put("requiredPermissions", required);
      audits.recordOutcome(request, module(path), action, entityType, entityId(path),
        request.getMethod() + " " + path + " returned " + status, result, reason, requestBody(request), context);
    } catch (RuntimeException auditFailure) {
      LOGGER.warn("Failed to persist request outcome audit", auditFailure);
    }
  }

  private Object requestBody(ContentCachingRequestWrapper request) {
    byte[] content = request.getContentAsByteArray();
    if (content.length == 0) return null;
    String contentType = request.getContentType();
    if (contentType != null && contentType.toLowerCase(Locale.ROOT).contains("json")) {
      try {
        JsonNode body = objectMapper.readTree(content);
        return body;
      } catch (IOException ignored) {
        return Map.of("contentType", contentType, "bodyBytes", content.length, "parseStatus", "INVALID_JSON");
      }
    }
    return Map.of("contentType", contentType == null ? "unknown" : contentType, "bodyBytes", content.length);
  }

  private String failureReason(HttpServletRequest request, int status, Exception failure) {
    Object explicit = request.getAttribute(FAILURE_REASON_ATTRIBUTE);
    if (explicit != null && !explicit.toString().isBlank()) return explicit.toString();
    Object servletMessage = request.getAttribute(RequestDispatcher.ERROR_MESSAGE);
    if (servletMessage != null && !servletMessage.toString().isBlank()) return servletMessage.toString();
    if (failure instanceof ResponseStatusException responseStatusException
        && responseStatusException.getReason() != null
        && !responseStatusException.getReason().isBlank()) {
      return responseStatusException.getReason();
    }
    if (failure != null && failure.getMessage() != null && !failure.getMessage().isBlank()) return failure.getMessage();
    return "HTTP " + status;
  }

  private UUID entityId(String path) {
    Matcher matcher = UUID_PATTERN.matcher(path);
    return matcher.find() ? UUID.fromString(matcher.group()) : UUID.randomUUID();
  }

  private String module(String path) {
    if (path.contains("/auth/") || path.startsWith("/api/v1/admin/access") || path.startsWith("/api/v1/admin/technician-accounts")) return "ACCESS";
    if (path.startsWith("/api/v1/audits")) return "AUDIT";
    if (path.startsWith("/api/v1/security-alerts")) return "ALERT";
    if (path.startsWith("/api/v1/foundation")) return "FOUNDATION";
    if (path.startsWith("/api/v1/rooms")) return "ROOM";
    if (path.startsWith("/api/v1/service-sessions") || path.startsWith("/api/v1/mobile/technician")) return "SERVICE";
    if (path.startsWith("/api/v1/members") || path.startsWith("/api/v1/wallet-transactions")) return "MEMBER";
    if (path.startsWith("/api/v1/sales-orders")) return "SALES";
    if (path.startsWith("/api/v1/refunds")) return "REFUND";
    if (path.startsWith("/api/v1/daily-reports")) return "DAILY_REPORT";
    if (path.startsWith("/api/v1/technician-schedules")) return "SCHEDULE";
    if (path.startsWith("/api/v1/payment-methods")) return "PAYMENT";
    if (path.startsWith("/api/v1/print-settings")) return "PRINT";
    if (path.startsWith("/api/v1/commissions")) return "COMMISSION";
    return "SYSTEM";
  }

  private String blankToNull(String value) { return value == null || value.isBlank() ? null : value; }
}
