package com.chengxin.massage.member;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class MemberPaymentAccountsMigrationTest {
  @Test
  void keepsExistingWalletsAndLinksMemberPaymentsToTheActualWallet() throws Exception {
    String sql = Files.readString(Path.of(
        "src/main/resources/db/migration/V104__member_payment_accounts.sql"))
        .replaceAll("\\s+", " ").trim().toLowerCase();

    assertThat(sql).contains("alter table member_wallet add column if not exists account_code");
    assertThat(sql).contains("drop constraint if exists member_wallet_member_id_key");
    assertThat(sql).contains("create unique index if not exists member_wallet_member_default_uq");
    assertThat(sql).contains("update payment_record");
    assertThat(sql).contains("set wallet_id = wallet.id");
    assertThat(sql).contains("update refund_payment_record");
    assertThat(sql).contains("refund_payment_record_wallet_method_check");
    assertThat(sql).contains("payment_method = 'member_balance'");
    assertThat(sql).contains("drop constraint if exists payment_record_wallet_method_check");
    assertThat(sql).contains("drop constraint if exists refund_payment_record_wallet_method_check");
    assertThat(sql).contains("do $$ begin if not exists ( select 1 from pg_constraint");
    assertThat(sql).contains("conname = 'payment_record_wallet_method_check'");
    assertThat(sql).contains("conname = 'refund_payment_record_wallet_method_check'");
  }
}
