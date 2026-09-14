package com.chengxin.massage.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class ServiceDurationPolicyServiceTest {
  private final ServiceDurationPolicyService service = new ServiceDurationPolicyService(null);

  @Test
  void ignoresTheLegacyExtensionCapAndUsesTheTotalDurationAllowance() {
    ServiceDurationPolicyService.Policy policy = new ServiceDurationPolicyService.Policy((short) 240, (short) 120);

    assertThat(service.remainingExtensionMinutes(policy, 150, 180)).isEqualTo(60);
    assertThat(service.remainingExtensionMinutes(policy, 20, 230)).isEqualTo(10);
  }

  @Test
  void zeroLegacyCapStillLeavesTheTotalDurationAllowance() {
    ServiceDurationPolicyService.Policy policy = new ServiceDurationPolicyService.Policy((short) 180, (short) 0);

    assertThat(service.remainingExtensionMinutes(policy, 130, 150)).isEqualTo(30);
    assertThat(service.remainingExtensionMinutes(policy, 130, 190)).isZero();
  }

  @Test
  void extensionValidationAllowsMoreThanTheLegacyCapButRetainsTotalLimit() {
    ServiceDurationPolicyService.Policy policy = new ServiceDurationPolicyService.Policy((short) 720, (short) 0);

    service.requireExtensionWithinLimit(policy, 600, 60, 720);
    assertThatThrownBy(() ->
      service.requireExtensionWithinLimit(policy, 600, 121, 721))
      .isInstanceOfSatisfying(ResponseStatusException.class,
        exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
  }
}
