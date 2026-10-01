package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class OperationalStateServiceTest {
  @Test
  void roomStateTreatsCompletedUnsettledServicesAsOccupiedAndKeepsBedsIndependent() {
    String roomSql = OperationalStateService.roomSql().toLowerCase();
    String serviceSql = OperationalStateService.serviceSql().toLowerCase();

    assertThat(roomSql).contains("then 'pending_payment'");
    assertThat(roomSql).contains("from room_bed active_bed");
    assertThat(roomSql).contains("active_bed.active=true");
    assertThat(roomSql).contains("linked_order.refund_status='full'");
    assertThat(roomSql).contains("when linked_order.status='settled' and linked_order.refund_status='full' then true");
    assertThat(roomSql).contains("when linked_order.status='settled' then false");
    assertThat(serviceSql).contains("when ss.status='completed' then 'completed_unsettled'");
    assertThat(serviceSql).contains("ss.bed_id");
    assertThat(serviceSql).contains("linked_order.status='cancelled'");
    assertThat(serviceSql).contains("then false");
  }

  @Test
  void technicianStateUsesTheSameStoreAndNoClientCacheContract() {
    assertThat(OperationalStateService.technicianSql()).contains(":store");
    assertThat(OperationalStateService.technicianSql()).contains(":businessDate");
  }

  @Test
  void auditAndRepairKeepFullyRefundedButNotCancelledOrdersOnTheirBeds() throws IOException {
    String audit = Files.readString(Path.of("..", "..", "tools", "regression", "operational-state-audit.sql"))
        .toLowerCase().replaceAll("\\s+", "");
    String repair = Files.readString(Path.of("..", "..", "tools", "regression", "operational-state-repair-template.sql"))
        .toLowerCase().replaceAll("\\s+", "");

    assertThat(audit.split("whenlatest_order.order_status='settled'andlatest_order.refund_status='full'thentrue", -1))
        .hasSize(4);
    assertThat(audit).contains("whenlatest_order.order_status='cancelled'then'link_order'")
        .doesNotContain("andnot(latest_order.order_status='settled'andlatest_order.refund_status='full')");
    assertThat(repair).contains("whenlinked_order.status='settled'andlinked_order.refund_status='full'thentrue")
        .contains("whenlinked_order.status='settled'thenfalse");
  }
}
