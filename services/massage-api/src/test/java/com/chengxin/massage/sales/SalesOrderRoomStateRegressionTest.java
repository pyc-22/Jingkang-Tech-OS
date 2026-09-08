package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SalesOrderRoomStateRegressionTest {
  private final SalesOrderController controller = new SalesOrderController(null, null, null, null, null, null, null);

  @Test
  void keepsRoomPendingWhenCompletedServicesRemainUnsettled() {
    assertThat(controller.roomStatusAfterSettlement(true)).isEqualTo("PENDING_PAYMENT");
  }

  @Test
  void movesRoomToCleaningAfterEveryCompletedServiceIsSettled() {
    assertThat(controller.roomStatusAfterSettlement(false)).isEqualTo("CLEANING");
  }
}
