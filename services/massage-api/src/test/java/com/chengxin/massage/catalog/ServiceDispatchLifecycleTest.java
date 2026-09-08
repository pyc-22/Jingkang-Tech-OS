package com.chengxin.massage.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

class ServiceDispatchLifecycleTest {
  @Test
  void onlyReassignmentRequiredSessionsCanBeManuallyReassigned() {
    assertThat(ServiceDispatchLifecycle.canBeReassigned("REASSIGNMENT_REQUIRED")).isTrue();
    assertThat(ServiceDispatchLifecycle.canBeReassigned("DISPATCH_CANCELLED")).isTrue();
    assertThat(ServiceDispatchLifecycle.canBeReassigned("PENDING_ACCEPTANCE")).isFalse();
    assertThat(ServiceDispatchLifecycle.canBeReassigned("IN_SERVICE")).isFalse();
  }

  @Test
  void onlyReassignmentRequiredSessionsCanHaveDispatchCancelled() {
    assertThat(ServiceDispatchLifecycle.canCancelDispatch("REASSIGNMENT_REQUIRED")).isTrue();
    assertThat(ServiceDispatchLifecycle.canCancelDispatch("DISPATCH_CANCELLED")).isFalse();
    assertThat(ServiceDispatchLifecycle.canCancelDispatch("PENDING_ACCEPTANCE")).isFalse();
    assertThat(ServiceDispatchLifecycle.canCancelDispatch("ACCEPTED")).isFalse();
    assertThat(ServiceDispatchLifecycle.canCancelDispatch("IN_SERVICE")).isFalse();
  }

  @Test
  void onlyFullyAcceptedSessionsCanStartService() {
    assertThat(ServiceDispatchLifecycle.canStart("ACCEPTED")).isTrue();
    assertThat(ServiceDispatchLifecycle.canStart("PENDING_ACCEPTANCE")).isFalse();
    assertThat(ServiceDispatchLifecycle.canStart("REASSIGNMENT_REQUIRED")).isFalse();
  }

  @Test
  void voidingParticipantOnlyClosesAnUnfinishedService() {
    OffsetDateTime startedAt = OffsetDateTime.parse("2026-08-26T10:00:00+08:00");
    OffsetDateTime endedAt = OffsetDateTime.parse("2026-08-26T10:30:00+08:00");
    OffsetDateTime voidedAt = OffsetDateTime.parse("2026-08-26T10:20:00+08:00");

    assertThat(ServiceSessionController.voidedParticipantEndedAt(null, null, voidedAt)).isNull();
    assertThat(ServiceSessionController.voidedParticipantEndedAt(startedAt, endedAt, voidedAt)).isEqualTo(endedAt);
    assertThat(ServiceSessionController.voidedParticipantEndedAt(startedAt, null, voidedAt)).isEqualTo(voidedAt);
  }

  @Test
  void sessionQueryCollapsesHistoricalOrderLinksToOneDisplayOrder() {
    String sql = ServiceSessionController.sessionListSql("where ss.id=:id");

    assertThat(sql).contains("left join lateral");
    assertThat(sql).contains("limit 1");
    assertThat(sql).contains(") sales_order on true");
    assertThat(sql).contains("linked_order.id");
    assertThat(sql).contains("linked_order.status <> 'CANCELLED'");
    assertThat(sql).doesNotContain("left join sales_order_service_session order_link on order_link.service_session_id=ss.id");
    assertThat(sql).doesNotContain("left join sales_order_line linked_line");
  }

  @Test
  void clockTypeCanBeChangedOnlyWhileServiceIsOperational() {
    assertThat(ServiceSessionController.canChangeClockType("PENDING_ACCEPTANCE")).isTrue();
    assertThat(ServiceSessionController.canChangeClockType("ACCEPTED")).isTrue();
    assertThat(ServiceSessionController.canChangeClockType("IN_SERVICE")).isTrue();
    assertThat(ServiceSessionController.canChangeClockType("COMPLETED")).isFalse();
    assertThat(ServiceSessionController.canChangeClockType("VOIDED")).isFalse();
  }

  @Test
  void editableClockTypeIsLimitedToQueueAndCall() {
    assertThat(ServiceSessionController.normalizeEditableClockType("QUEUE")).isEqualTo("QUEUE");
    assertThat(ServiceSessionController.normalizeEditableClockType("CALL")).isEqualTo("CALL");
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> ServiceSessionController.normalizeEditableClockType("BOOKED_QUEUE"))
      .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
  }
}
