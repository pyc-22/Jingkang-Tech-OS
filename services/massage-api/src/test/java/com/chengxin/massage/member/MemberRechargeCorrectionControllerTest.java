package com.chengxin.massage.member;

import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class MemberRechargeCorrectionControllerTest {
  @Test void increaseCreditsOnlyThePrincipalDifference() {
    assertEquals(14000, MemberRechargeCorrectionController.correctedBalance(12000, 10000, 12000));
  }
  @Test void decreaseCanUseTheRemainingBalanceExactly() {
    assertEquals(0, MemberRechargeCorrectionController.correctedBalance(2000, 10000, 8000));
  }
  @Test void paymentOnlyCorrectionLeavesBalanceUnchanged() {
    assertEquals(12000, MemberRechargeCorrectionController.correctedBalance(12000, 10000, 10000));
  }
  @Test void negativeBalanceIsAConflict() {
    assertEquals(409, assertThrows(ResponseStatusException.class,
      () -> MemberRechargeCorrectionController.correctedBalance(1999, 10000, 8000)).getStatusCode().value());
  }
  @Test void overflowIsAConflict() {
    assertEquals(409, assertThrows(ResponseStatusException.class,
      () -> MemberRechargeCorrectionController.correctedBalance(Long.MAX_VALUE, 1, 2)).getStatusCode().value());
  }
  @Test void optionalAmountStillRequiresReasonPaymentAndVersion() {
    try (var factory = Validation.buildDefaultValidatorFactory()) {
      var validator = factory.getValidator();
      assertTrue(validator.validate(new MemberRechargeCorrectionController.CorrectionInput("CASH", null, "Reviewed", 0L)).isEmpty());
      assertFalse(validator.validate(new MemberRechargeCorrectionController.CorrectionInput(" ", 0L, " ", null)).isEmpty());
      assertFalse(validator.validate(new MemberRechargeCorrectionController.CorrectionInput("CASH", -1L, "Reviewed", -1L)).isEmpty());
    }
  }
}
