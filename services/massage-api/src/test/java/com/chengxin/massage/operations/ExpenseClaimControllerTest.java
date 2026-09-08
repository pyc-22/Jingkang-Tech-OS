package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ExpenseClaimControllerTest {
  @Test
  void claimNumbersUseOneGlobalDatabaseSequence() {
    assertThat(ExpenseClaimController.claimNoSequenceSql())
      .contains("has_sequence_privilege")
      .contains("nextval(to_regclass('expense_claim_no_seq'))");
  }

  @Test
  void sequenceAccessMigrationIsIncludedAfterTheGlobalNumberMigration() {
    assertThat(getClass().getResource("/db/migration/V79__expense_claim_sequence_access.sql"))
      .isNotNull();
  }

  @Test
  void onlySubmittedApprovedAndPaidClaimsContributeToAccountingAmounts() {
    assertThat(ExpenseClaimController.accountingIncluded("SUBMITTED")).isTrue();
    assertThat(ExpenseClaimController.accountingIncluded("APPROVED")).isTrue();
    assertThat(ExpenseClaimController.accountingIncluded("PAID")).isTrue();
    assertThat(ExpenseClaimController.accountingIncluded("DRAFT")).isFalse();
    assertThat(ExpenseClaimController.accountingIncluded("RETURNED")).isFalse();
    assertThat(ExpenseClaimController.accountingIncluded("REJECTED")).isFalse();
    assertThat(ExpenseClaimController.accountingIncluded("WITHDRAWN")).isFalse();
  }

  @Test
  void withdrawalUsesAnAtomicStatusTransition() throws Exception {
    String source = new String(java.nio.file.Files.readAllBytes(java.nio.file.Path.of(
      "src/main/java/com/chengxin/massage/operations/ExpenseClaimController.java")));
    assertThat(source).contains("int changed = jdbc.sql(\"update expense_claim set status='WITHDRAWN'");
    assertThat(source).contains("if (changed != 1) throw conflict(\"报销状态已变化，请刷新后重试\")");
  }
}
