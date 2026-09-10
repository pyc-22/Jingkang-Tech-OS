package com.chengxin.massage.mobile;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.catalog.ServiceDispatchEventService;
import com.chengxin.massage.catalog.ServiceDurationPolicyService;
import com.chengxin.massage.catalog.ServiceItemVersionService;
import com.chengxin.massage.catalog.TechnicianQueueService;
import com.chengxin.massage.catalog.TechnicianSchedulePolicy;
import com.chengxin.massage.operations.BusinessClockService;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
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
      dispatchEvents, technicianQueue, durationPolicies);

    assertThatThrownBy(() -> controller.clockIn("Bearer valid-token"))
      .isInstanceOfSatisfying(ResponseStatusException.class, exception -> {
        org.assertj.core.api.Assertions.assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        org.assertj.core.api.Assertions.assertThat(exception.getReason()).contains("技师端不能自主上钟");
      });

    verify(sessions).requireUserId("Bearer valid-token");
    verify(jdbc).sql(anyString());
    verify(statement, never()).update();
    verifyNoInteractions(audits, schedulePolicy, businessClock, itemVersions, dispatchEvents, technicianQueue, durationPolicies);
  }
}
