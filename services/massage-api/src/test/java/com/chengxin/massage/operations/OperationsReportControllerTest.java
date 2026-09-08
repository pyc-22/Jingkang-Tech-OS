package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class OperationsReportControllerTest {
  @Test
  void groupsLegacySessionsAsQueueAndSelectedSessionsAsCall() {
    String sql = OperationsReportController.clockCountsSql();

    assertThat(sql).contains("coalesce(clock_type,'QUEUE') in ('QUEUE','BOOKED_QUEUE')");
    assertThat(sql).contains("clock_type in ('CALL','BOOKED_CALL','SELECTED')");
    assertThat(sql).contains("cast(0 as bigint) extension_count");
  }

  @Test
  void liveRoomsPreferActualActiveServicesAndExcludeInactiveParticipants() {
    String roomSql = OperationsReportController.liveRoomStatusSql();
    String serviceSql = OperationsReportController.liveRoomServiceSql();

    assertThat(roomSql).contains("active.status='IN_SERVICE'");
    assertThat(roomSql).contains("'PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED'");
    assertThat(serviceSql).contains("participant.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')");
    assertThat(serviceSql).contains("ss.status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE')");
    assertThat(serviceSql).contains("ss.status='COMPLETED'");
    assertThat(serviceSql).contains("not exists(select 1 from sales_order_service_session link");
    assertThat(serviceSql).contains("bed.code bed_code");
    assertThat(serviceSql).contains("ss.clock_type");
    assertThat(serviceSql).contains("ss.started_at,ss.expected_end_at");
  }

  @Test
  void liveTechniciansUseCurrentParticipantsAndActualDailyQueue() {
    String technicianSql = OperationsReportController.liveTechnicianStatusSql();
    String attentionSql = OperationsReportController.liveDispatchAttentionSql();

    assertThat(technicianSql).contains("technician.active=true");
    assertThat(technicianSql).contains("participant.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')");
    assertThat(technicianSql).contains("session.status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')");
    assertThat(technicianSql).contains("participant.acceptance_deadline_at>now()");
    assertThat(technicianSql).contains("queue_day.business_date=:businessDate");
    assertThat(technicianSql).contains("queue_position.queue_position");
    assertThat(technicianSql).contains("room.code room_code");
    assertThat(technicianSql).contains("session.service_name_snapshot,session.clock_type");
    assertThat(attentionSql).contains("status='REASSIGNMENT_REQUIRED'");
    assertThat(attentionSql).contains("status='DISPATCH_CANCELLED'");
  }

  @Test
  void dailyReportUsesPaidSettledOrdersAndFirstRechargeCount() throws Exception {
    String source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/java/com/chengxin/massage/operations/OperationsReportController.java"));
    assertThat(source).contains("sales.status='SETTLED' and sales.paid_cents>0");
    assertThat(source).contains("row_number() over(partition by wt.store_id,wt.member_id order by wt.created_at,wt.id)");
    assertThat(source).contains("recharge_number=1");
    assertThat(source).contains("source in ('ORDER_REFUND','ORDER_CORRECTION')");
  }

  @Test
  void dailyReportExcludesFullyRefundedOrdersFromOrderCountWithoutChangingSalesAmountSum() throws Exception {
    String source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/java/com/chengxin/massage/operations/OperationsReportController.java"))
      .replaceAll("\\s+", "");
    assertThat(source).contains("count(*)filter(wherecoalesce(sales.refund_status,'NONE')<>'FULL')settled_order_count");
    assertThat(source).contains("coalesce(sum(sales.paid_cents),0)sales_amount_cents");
  }

  @Test
  void dailyReportUsesTheSameVoidedServiceOrderFilterAsFrontdesk() throws Exception {
    String managerSource = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/java/com/chengxin/massage/operations/OperationsReportController.java")).replaceAll("\\s+", "");
    String frontdeskSource = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/java/com/chengxin/massage/operations/DailyOperatingReportController.java")).replaceAll("\\s+", "");
    String filter = "notexists(select1fromsales_order_service_sessionlinked_sessionwherelinked_session.order_id=sales.id)orexists(select1fromsales_order_service_sessionlinked_sessionjoinservice_sessionlinked_serviceonlinked_service.id=linked_session.service_session_idwherelinked_session.order_id=sales.idandlinked_service.status<>'VOIDED')";
    assertThat(managerSource).contains(filter);
    assertThat(frontdeskSource).contains(filter);
  }

  @Test
  void dailyReportExposesNetSalesAsThePrimarySalesAmount() throws Exception {
    String source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/java/com/chengxin/massage/operations/OperationsReportController.java"));
    assertThat(source).contains("metrics.netSalesAmountCents(),\n      metrics.rechargeAmountCents()");
  }
}
