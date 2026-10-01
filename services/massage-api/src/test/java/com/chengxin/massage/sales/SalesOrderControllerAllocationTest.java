package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.chengxin.massage.catalog.ServiceItemVersionService;
import com.chengxin.massage.catalog.ServiceItemVersionService.CommissionRuleVersion;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

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

  @Test
  void conversionKeepsEveryParticipantQueueClockAndSelectsCallCommission() {
    ServiceItemVersionService versions = mock(ServiceItemVersionService.class);
    SalesOrderController withRules = new SalesOrderController(null, null, null, null, versions, null, null);
    UUID storeId = UUID.randomUUID();
    UUID ruleId = UUID.randomUUID();
    CommissionRuleVersion rule = new CommissionRuleVersion(ruleId, UUID.randomUUID(),
      "FIXED", 3000L, 0, "FIXED", 5000L, 0, "FIXED", 1000L, 0, true, LocalDate.of(2026, 10, 1));
    when(versions.commissionRule(storeId, ruleId)).thenReturn(rule);

    List<SalesOrderController.CommissionBase> converted = withRules.allocatedMainCommissions(List.of(
      participant((short) 1, (short) 1, 5000, 3600, 30000, "CONVERSION", ruleId),
      participant((short) 2, (short) 1, 5000, 3600, 30000, "CONVERSION", ruleId)
    ));
    assertThat(converted).extracting(SalesOrderController.CommissionBase::clockType)
      .containsExactly("CONVERSION", "CONVERSION");
    assertThat(converted).extracting(SalesOrderController.CommissionBase::clockAdjustment)
      .containsExactly((short) 1, (short) 1);
    assertThat(converted).extracting(SalesOrderController.CommissionBase::baseAmountCents)
      .containsExactly(15000, 15000);

    SalesOrderController.CommissionBase base = converted.getFirst();
    assertThat(selectedRule(withRules, storeId, withClockType(base, "QUEUE"), "MAIN").fixedCents()).isEqualTo(3000L);
    assertThat(selectedRule(withRules, storeId, withClockType(base, "CALL"), "MAIN").fixedCents()).isEqualTo(5000L);
    assertThat(selectedRule(withRules, storeId, base, "MAIN").fixedCents()).isEqualTo(5000L);
    assertThat(selectedRule(withRules, storeId, base, "EXTENSION").fixedCents()).isEqualTo(1000L);
  }

  private SalesOrderController.CommissionRule selectedRule(SalesOrderController withRules, UUID storeId,
      SalesOrderController.CommissionBase base, String sourceType) {
    return ReflectionTestUtils.invokeMethod(withRules, "commissionRule", storeId, base, sourceType);
  }

  private SalesOrderController.CommissionBase withClockType(SalesOrderController.CommissionBase base, String clockType) {
    return new SalesOrderController.CommissionBase(base.serviceSessionId(), base.serviceSessionExtensionId(),
      base.serviceItemId(), base.technicianId(), base.technicianName(), base.serviceNameSnapshot(),
      base.baseAmountCents(), clockType, base.commissionRuleVersionId(), base.businessDate(),
      base.countsAsClockSnapshot(), base.durationMinutes(), base.serviceParticipantId(),
      base.allocationBpSnapshot(), base.servedSecondsSnapshot(), base.clockAdjustment(), base.fixedScaleBp());
  }

  private SalesOrderController.ParticipantCommissionBase participant(short slot, short sequence, int allocationBp, int seconds, int servicePriceCents) {
    return participant(slot, sequence, allocationBp, seconds, servicePriceCents, "QUEUE", null);
  }

  private SalesOrderController.ParticipantCommissionBase participant(short slot, short sequence, int allocationBp, int seconds,
      int servicePriceCents, String clockType, UUID ruleId) {
    return new SalesOrderController.ParticipantCommissionBase(
      UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "技师", "项目",
      servicePriceCents, clockType, ruleId, LocalDate.of(2026, 8, 9), true, (short) 60,
      slot, sequence, allocationBp, seconds
    );
  }

  private SalesOrderController.SettlementParticipant settlementParticipant(UUID id, short slot, short sequence, String type, int allocationBp, String status, UUID replacedParticipantId) {
    return new SalesOrderController.SettlementParticipant(id, slot, sequence, type, allocationBp, status, replacedParticipantId);
  }
}
