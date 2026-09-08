package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class SalesOrderControllerAllocationTest {
  private final SalesOrderController controller = new SalesOrderController(null, null, null, null, null, null, null);

  @Test
  void splitsTwoSimultaneousTechniciansEqually() {
    List<SalesOrderController.CommissionBase> result = controller.allocatedMainCommissions(List.of(
      participant((short) 1, (short) 1, 5000, 3600, 29900),
      participant((short) 2, (short) 1, 5000, 3600, 29900)
    ));

    assertThat(result).extracting(SalesOrderController.CommissionBase::baseAmountCents).containsExactly(14950, 14950);
    assertThat(result).extracting(SalesOrderController.CommissionBase::clockAdjustment).containsExactly((short) 1, (short) 1);
  }

  @Test
  void honorsCustomSlotAllocation() {
    List<SalesOrderController.CommissionBase> result = controller.allocatedMainCommissions(List.of(
      participant((short) 1, (short) 1, 6000, 3600, 29900),
      participant((short) 2, (short) 1, 4000, 3600, 29900)
    ));

    assertThat(result).extracting(SalesOrderController.CommissionBase::baseAmountCents).containsExactly(17940, 11960);
  }

  @Test
  void splitsReplacementSlotByActualSeconds() {
    List<SalesOrderController.CommissionBase> result = controller.allocatedMainCommissions(List.of(
      participant((short) 1, (short) 1, 10000, 70, 29900),
      participant((short) 1, (short) 2, 10000, 30, 29900)
    ));

    assertThat(result).extracting(SalesOrderController.CommissionBase::baseAmountCents).containsExactly(20930, 8970);
    assertThat(result).extracting(SalesOrderController.CommissionBase::clockAdjustment).containsExactly((short) 1, (short) 0);
  }

  @Test
  void awardsClockToEarliestParticipantOnEqualDuration() {
    List<SalesOrderController.CommissionBase> result = controller.allocatedMainCommissions(List.of(
      participant((short) 1, (short) 1, 10000, 60, 10001),
      participant((short) 1, (short) 2, 10000, 60, 10001)
    ));

    assertThat(result).extracting(SalesOrderController.CommissionBase::clockAdjustment).containsExactly((short) 1, (short) 0);
    assertThat(result).extracting(SalesOrderController.CommissionBase::baseAmountCents).containsExactly(5001, 5000);
  }

  @Test
  void preservesExactServiceTotalAfterCentRounding() {
    List<SalesOrderController.CommissionBase> result = controller.allocatedMainCommissions(List.of(
      participant((short) 1, (short) 1, 3334, 3600, 10001),
      participant((short) 2, (short) 1, 3333, 3600, 10001),
      participant((short) 3, (short) 1, 3333, 3600, 10001)
    ));

    assertThat(result).extracting(SalesOrderController.CommissionBase::baseAmountCents).containsExactly(3334, 3333, 3334);
    assertThat(result.stream().mapToInt(SalesOrderController.CommissionBase::baseAmountCents).sum()).isEqualTo(10001);
  }

  @Test
  void permitsValidMultipleTechniciansAndInServiceReplacement() {
    UUID first = UUID.randomUUID();
    UUID second = UUID.randomUUID();
    controller.validateSettlementParticipants(List.of(
      settlementParticipant(first, (short) 1, (short) 1, "PRIMARY", 5000, "COMPLETED", null),
      settlementParticipant(second, (short) 1, (short) 2, "REPLACEMENT", 5000, "COMPLETED", first),
      settlementParticipant(UUID.randomUUID(), (short) 2, (short) 1, "ADDITIONAL", 5000, "COMPLETED", null)
    ));
  }

  @Test
  void blocksMalformedParticipantChainBeforeSettlement() {
    assertThatThrownBy(() -> controller.validateSettlementParticipants(List.of(
      settlementParticipant(UUID.randomUUID(), (short) 1, (short) 1, "PRIMARY", 10000, "COMPLETED", null),
      settlementParticipant(UUID.randomUUID(), (short) 1, (short) 2, "PRIMARY", 10000, "COMPLETED", null)
    ))).hasMessageContaining("服务技师记录异常");
  }

  private SalesOrderController.ParticipantCommissionBase participant(short slot, short sequence, int allocationBp, int seconds, int servicePriceCents) {
    return new SalesOrderController.ParticipantCommissionBase(
      UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "技师", "项目",
      servicePriceCents, "QUEUE", null, LocalDate.of(2026, 8, 9), true, (short) 60,
      slot, sequence, allocationBp, seconds
    );
  }

  private SalesOrderController.SettlementParticipant settlementParticipant(UUID id, short slot, short sequence, String type, int allocationBp, String status, UUID replacedParticipantId) {
    return new SalesOrderController.SettlementParticipant(id, slot, sequence, type, allocationBp, status, replacedParticipantId);
  }
}
