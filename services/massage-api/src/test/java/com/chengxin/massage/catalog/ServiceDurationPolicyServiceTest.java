package com.chengxin.massage.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ServiceDurationPolicyServiceTest {
  private final ServiceDurationPolicyService service = new ServiceDurationPolicyService(null);

  @Test
  void usesTheSmallerOfExtensionAndTotalDurationAllowance() {
    ServiceDurationPolicyService.Policy policy = new ServiceDurationPolicyService.Policy((short) 240, (short) 120);

    assertThat(service.remainingExtensionMinutes(policy, 90, 180)).isEqualTo(30);
    assertThat(service.remainingExtensionMinutes(policy, 20, 230)).isEqualTo(10);
  }

  @Test
  void neverReturnsANegativeAllowance() {
    ServiceDurationPolicyService.Policy policy = new ServiceDurationPolicyService.Policy((short) 180, (short) 120);

    assertThat(service.remainingExtensionMinutes(policy, 130, 190)).isZero();
  }
}
