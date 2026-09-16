package com.chengxin.massage.mobile;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.chengxin.massage.audit.AuditOutcomeFilter;
import com.chengxin.massage.audit.AuditService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.chengxin.massage.catalog.ServiceDispatchEventService;
import com.chengxin.massage.catalog.ServiceDurationPolicyService;
import com.chengxin.massage.catalog.ServiceItemVersionService;
import com.chengxin.massage.catalog.TechnicianQueueService;
import com.chengxin.massage.catalog.TechnicianSchedulePolicy;
import com.chengxin.massage.operations.BusinessClockService;
import java.util.Optional;
import java.util.UUID;
import java.lang.reflect.Constructor;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

class TechnicianMobileControllerTest {
  @Test
  void selfClockInValidatesTheTechnicianSessionThenReturnsForbiddenWithoutWrites() {
    JdbcClient jdbc = mock(JdbcClient.class);
    MobileSessionService sessions = mock(MobileSessionService.class);
    AuditService audits = mock(AuditService.class);
    TechnicianSchedulePolicy schedulePolicy = mock(TechnicianSchedulePolicy.class);
    BusinessClockService businessClock = mock(BusinessClockService.class);
    ServiceItemVersionService itemVersions = mock(ServiceItemVersionService.class);
    ServiceDispatchEventService dispatchEvents = mock(ServiceDispatchEventService.class);
    TechnicianQueueService technicianQueue = mock(TechnicianQueueService.class);
    ServiceDurationPolicyService durationPolicies = mock(ServiceDurationPolicyService.class);
    JdbcClient.StatementSpec statement = mock(JdbcClient.StatementSpec.class);
    @SuppressWarnings("unchecked")
    JdbcClient.MappedQuerySpec<TechnicianMobileController.Technician> query = mock(JdbcClient.MappedQuerySpec.class);
    UUID userId = UUID.randomUUID();
    UUID technicianId = UUID.randomUUID();
    UUID storeId = UUID.randomUUID();

    when(sessions.requireUserId("Bearer valid-token")).thenReturn(userId);
    when(jdbc.sql(anyString())).thenReturn(statement);
    when(statement.param(anyString(), org.mockito.ArgumentMatchers.any())).thenReturn(statement);
    when(statement.query(TechnicianMobileController.Technician.class)).thenReturn(query);
    when(query.optional()).thenReturn(Optional.of(
      new TechnicianMobileController.Technician(technicianId, "T001", "测试技师", storeId, "测试门店")));
    TechnicianMobileController controller = new TechnicianMobileController(
      jdbc, sessions, schedulePolicy, audits, businessClock, itemVersions,
      dispatchEvents, technicianQueue, durationPolicies, mock(com.chengxin.massage.catalog.RoomStateService.class));
    MockHttpServletRequest request = new MockHttpServletRequest();

    assertThatThrownBy(() -> controller.clockIn("Bearer valid-token", request))
      .isInstanceOfSatisfying(ResponseStatusException.class, exception -> {
        org.assertj.core.api.Assertions.assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        org.assertj.core.api.Assertions.assertThat(exception.getReason()).contains("技师端不能自主上钟");
      });

    org.assertj.core.api.Assertions.assertThat(request.getAttribute(
      com.chengxin.massage.audit.AuditOutcomeFilter.SUPPRESS_OUTCOME_AUDIT_ATTRIBUTE)).isEqualTo(Boolean.TRUE);
    verify(sessions).requireUserId("Bearer valid-token");
    verify(jdbc).sql(anyString());
    verify(statement, never()).update();
    verifyNoInteractions(audits, schedulePolicy, businessClock, itemVersions, dispatchEvents, technicianQueue, durationPolicies);
  }

  @Test
  void selfClockInSuppressesOnlyTheAuthenticatedForbiddenOutcomeAudit() throws Exception {
    JdbcClient jdbc = mock(JdbcClient.class);
    MobileSessionService sessions = mock(MobileSessionService.class);
    AuditService audits = mock(AuditService.class);
    JdbcClient.StatementSpec statement = mock(JdbcClient.StatementSpec.class);
    @SuppressWarnings("unchecked")
    JdbcClient.MappedQuerySpec<TechnicianMobileController.Technician> query = mock(JdbcClient.MappedQuerySpec.class);
    UUID userId = UUID.randomUUID();

    when(sessions.requireUserId("Bearer valid-token")).thenReturn(userId);
    when(sessions.requireUserId(null)).thenThrow(new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid session"));
    when(jdbc.sql(anyString())).thenReturn(statement);
    when(statement.param(anyString(), any())).thenReturn(statement);
    when(statement.query(TechnicianMobileController.Technician.class)).thenReturn(query);
    when(query.optional()).thenReturn(Optional.of(new TechnicianMobileController.Technician(
      UUID.randomUUID(), "T001", "测试技师", UUID.randomUUID(), "测试门店")));
    TechnicianMobileController controller = new TechnicianMobileController(
      jdbc, sessions, mock(TechnicianSchedulePolicy.class), audits, mock(BusinessClockService.class),
      mock(ServiceItemVersionService.class), mock(ServiceDispatchEventService.class),
      mock(TechnicianQueueService.class), mock(ServiceDurationPolicyService.class), mock(com.chengxin.massage.catalog.RoomStateService.class));
    Constructor<AuditOutcomeFilter> constructor = AuditOutcomeFilter.class
      .getDeclaredConstructor(AuditService.class, ObjectMapper.class);
    constructor.setAccessible(true);
    MockMvc mvc = MockMvcBuilders.standaloneSetup(controller)
      .addFilters(constructor.newInstance(audits, new ObjectMapper()))
      .build();

    mvc.perform(post("/api/v1/mobile/technician/clock-in")
        .header("Authorization", "Bearer valid-token"))
      .andExpect(status().isForbidden());
    verifyNoInteractions(audits);

    mvc.perform(post("/api/v1/mobile/technician/clock-in"))
      .andExpect(status().isUnauthorized());
    verify(audits).recordOutcome(any(), eq("SERVICE"), eq("ACCESS_DENIED"), eq("request"), any(UUID.class),
      contains("401"), eq("DENIED"), eq("HTTP 401"), isNull(), anyMap());
  }
}
