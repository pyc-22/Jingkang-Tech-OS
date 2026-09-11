package com.chengxin.massage.audit;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.server.ResponseStatusException;

class AuditOutcomeFilterTest {
  private final AuditService audits = mock(AuditService.class);
  private final AuditOutcomeFilter filter = new AuditOutcomeFilter(audits, new ObjectMapper());

  @Test
  void recordsDeniedProtectedRequests() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/audits/export");
    MockHttpServletResponse response = new MockHttpServletResponse();

    filter.doFilter(request, response, (wrapped, target) -> {
      wrapped.setAttribute(AuditOutcomeFilter.REQUIRED_PERMISSIONS_ATTRIBUTE, List.of("AUDIT_EXPORT"));
      wrapped.setAttribute(AuditOutcomeFilter.FAILURE_REASON_ATTRIBUTE, "Permission denied");
      ((HttpServletResponse) target).sendError(403, "Permission denied");
    });

    verify(audits).recordOutcome(any(), eq("AUDIT"), eq("ACCESS_DENIED"), eq("request"), any(UUID.class),
      contains("403"), eq("DENIED"), eq("Permission denied"), isNull(), anyMap());
  }

  @Test
  void recordsFailedMutationWithCachedJsonBody() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/members");
    request.setContentType(MediaType.APPLICATION_JSON_VALUE);
    request.setContent("{\"name\":\"Test\",\"password\":\"secret\"}".getBytes(StandardCharsets.UTF_8));
    MockHttpServletResponse response = new MockHttpServletResponse();

    filter.doFilter(request, response, (wrapped, target) -> {
      wrapped.getInputStream().readAllBytes();
      ((HttpServletResponse) target).setStatus(409);
    });

    verify(audits).recordOutcome(any(), eq("MEMBER"), eq("REQUEST_FAILED"), eq("request"), any(UUID.class),
      contains("409"), eq("FAILED"), eq("HTTP 409"), any(), anyMap());
  }

  @Test
  void ignoresSuccessfulRequests() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/members");
    MockHttpServletResponse response = new MockHttpServletResponse();

    filter.doFilter(request, response, (wrapped, target) -> ((HttpServletResponse) target).setStatus(201));

    verifyNoInteractions(audits);
  }

  @Test
  void ignoresExplicitlySuppressedOutcomeAudit() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/mobile/technician/clock-in");
    MockHttpServletResponse response = new MockHttpServletResponse();

    filter.doFilter(request, response, (wrapped, target) -> {
      wrapped.setAttribute(AuditOutcomeFilter.SUPPRESS_OUTCOME_AUDIT_ATTRIBUTE, Boolean.TRUE);
      ((HttpServletResponse) target).sendError(403, "Technician self clock-in disabled");
    });

    verifyNoInteractions(audits);
  }

  @Test
  void preservesResponseStatusExceptionCodeForFailureAudit() {
    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/service-sessions/clock-in");
    MockHttpServletResponse response = new MockHttpServletResponse();

    org.assertj.core.api.Assertions.assertThatThrownBy(() -> filter.doFilter(request, response, (wrapped, target) -> {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "room is busy");
    })).isInstanceOf(ResponseStatusException.class);

    verify(audits).recordOutcome(any(), eq("SERVICE"), eq("REQUEST_FAILED"), eq("request"), any(UUID.class),
      contains("409"), eq("FAILED"), eq("room is busy"), isNull(), anyMap());
  }
}
