package com.chengxin.massage.member;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class MemberCodePolicyTest {
  @Test void formatsStoreLetterAndFiveDigits() {
    assertEquals("A00001", MemberController.formatMemberCode("A", 1));
    assertEquals("B00042", MemberController.formatMemberCode("B", 42));
    assertEquals("Z99999", MemberController.formatMemberCode("Z", 99999));
  }

  @Test void rejectsOutOfRangeAllocations() {
    for (String prefix : new String[] {null, "", "AA", "a", "1"}) {
      assertThrows(IllegalArgumentException.class, () -> MemberController.formatMemberCode(prefix, 1));
    }
    assertThrows(IllegalArgumentException.class, () -> MemberController.formatMemberCode("A", 0));
    assertThrows(IllegalArgumentException.class, () -> MemberController.formatMemberCode("A", 100000));
  }
}
