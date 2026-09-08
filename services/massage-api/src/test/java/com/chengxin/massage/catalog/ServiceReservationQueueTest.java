package com.chengxin.massage.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ServiceReservationQueueTest {
  @Test
  void bookedReservationsCanQueueBehindAnActiveTechnician() {
    assertThat(ServiceReservationController.shouldRejectBusyTechnician(true, "BOOKED_QUEUE")).isFalse();
    assertThat(ServiceReservationController.shouldRejectBusyTechnician(true, "BOOKED_CALL")).isFalse();
    assertThat(ServiceReservationController.shouldRejectBusyTechnician(false, "BOOKED_QUEUE")).isFalse();
  }

  @Test
  void unexpectedReservationTypesKeepTheBusyTechnicianGuard() {
    assertThat(ServiceReservationController.shouldRejectBusyTechnician(true, "QUEUE")).isTrue();
  }
}
