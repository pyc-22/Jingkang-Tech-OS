package com.chengxin.massage.member;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class MemberPaymentAccountsCompatibilityTest {
  @Test
  void singleMemberBalanceProjectionsAlwaysSelectTheDefaultCard() throws Exception {
    String sales = Files.readString(Path.of("src/main/java/com/chengxin/massage/sales/SalesOrderController.java"));
    String members = Files.readString(Path.of("src/main/java/com/chengxin/massage/member/MemberController.java"));

    assertThat(sales).contains("from member_wallet where member_id=m.id and is_default");
    assertThat(members).contains("join member_wallet w on w.member_id=m.id and w.is_default where m.id=:id");
  }

  @Test
  void memberArchiveAndTestBalanceCleanupInspectEveryCard() throws Exception {
    String members = Files.readString(Path.of("src/main/java/com/chengxin/massage/member/MemberController.java"));
    String archive = members.substring(members.indexOf("ResponseEntity<Map<String, String>> deactivate("),
        members.indexOf("@DeleteMapping(\"/{id}/purge\")"));
    String purge = members.substring(members.indexOf("ResponseEntity<Map<String, String>> purge("),
        members.indexOf("@PostMapping(\"/{id}/clear-test-balance-and-archive\")"));
    String cleanup = members.substring(members.indexOf("ResponseEntity<Map<String, String>> clearTestBalanceAndArchive("),
        members.indexOf("private Member member("));

    assertThat(archive).contains("wallets(id).stream().anyMatch");
    assertThat(purge).contains("wallets(id).stream().anyMatch");
    assertThat(cleanup).contains("List<Wallet> wallets = wallets(id)", "for (Wallet wallet : wallets)");
    assertThat(members).contains("from member_wallet where member_id=:member and tenant_id=:tenant order by id for update");
  }

  @Test
  void firstAdditionalCardBecomesDefaultAndInactiveCardsCannotBecomeDefault() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/member/MemberWalletController.java"));

    assertThat(source).contains("select exists(select 1 from member_wallet where member_id=:member and is_default)");
    assertThat(source).contains("Boolean.TRUE.equals(input.isDefault()) || !hasDefault");
    assertThat(source).contains("select active from member_wallet where id=:id and member_id=:member for update");
    assertThat(source).contains("if (!active) throw conflict(\"停用卡不能设为默认\")");
  }
}
