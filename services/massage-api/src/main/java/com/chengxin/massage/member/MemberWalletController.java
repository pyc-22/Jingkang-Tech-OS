package com.chengxin.massage.member;

import java.util.List;
import java.util.Locale;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;

@RestController
@RequestMapping("/api/v1/members")
@CrossOrigin(origins = "*")
public class MemberWalletController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AuditService audits;

  MemberWalletController(JdbcClient jdbc, StoreContextService storeContext, AuditService audits) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.audits = audits;
  }

  @GetMapping("/{memberId}/wallets")
  List<WalletView> list(@PathVariable UUID memberId,
                        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                        @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    ensureMember(memberId);
    return wallets(memberId);
  }

  /** Searchable payer/card picker used by split and combined settlement. */
  @GetMapping("/wallets")
  List<PayerWalletView> search(@RequestParam(defaultValue = "") String query,
                               @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                               @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    storeContext.currentStore(authorization, requestedStoreId);
    String q = "%" + query.trim() + "%";
    return jdbc.sql("select w.id wallet_id,w.member_id,m.code member_code,m.name member_name,m.phone member_phone,w.account_code,w.account_name,w.balance_cents,w.active,w.is_default from member_wallet w join member m on m.id=w.member_id where w.tenant_id=:tenant and m.active and w.active and (m.code ilike :q or m.name ilike :q or m.phone ilike :q or w.account_code ilike :q or w.account_name ilike :q) order by w.is_default desc,m.name,w.account_code limit 100")
      .param("tenant", TENANT_ID).param("q", q).query(PayerWalletView.class).list();
  }

  @PostMapping("/{memberId}/wallets")
  @Transactional
  WalletView create(@PathVariable UUID memberId, @Valid @RequestBody WalletInput input,
                    @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                    @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    ensureMember(memberId);
    String code = input.accountCode() == null || input.accountCode().isBlank()
      ? "CARD-" + UUID.randomUUID().toString().replace("-", "").substring(0, 16).toUpperCase(Locale.ROOT)
      : input.accountCode().trim().toUpperCase(Locale.ROOT);
    boolean hasDefault = jdbc.sql("select exists(select 1 from member_wallet where member_id=:member and is_default)")
      .param("member", memberId).query(Boolean.class).single();
    boolean makeDefault = Boolean.TRUE.equals(input.isDefault()) || !hasDefault;
    if (makeDefault) clearDefault(memberId);
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into member_wallet(id,tenant_id,opened_store_id,member_id,account_code,account_name,active,is_default) values(:id,:tenant,:store,:member,:code,:name,true,:default)")
      .param("id", id).param("tenant", TENANT_ID).param("store", storeId).param("member", memberId)
      .param("code", code).param("name", input.accountName().trim()).param("default", makeDefault).update();
    WalletView created = wallet(id, memberId);
    audits.record(authorization, storeId, "MEMBER", "MEMBER_WALLET_CREATED", "member_wallet", id, "新增会员卡", null, created);
    return created;
  }

  @PutMapping("/{memberId}/wallets/{walletId}/default")
  @Transactional
  WalletView setDefault(@PathVariable UUID memberId, @PathVariable UUID walletId,
                        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                        @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    ensureWallet(memberId, walletId);
    boolean active = jdbc.sql("select active from member_wallet where id=:id and member_id=:member for update")
      .param("id", walletId).param("member", memberId).query(Boolean.class).single();
    if (!active) throw conflict("停用卡不能设为默认");
    clearDefault(memberId);
    jdbc.sql("update member_wallet set is_default=true,updated_at=now(),version=version+1 where id=:id and active")
      .param("id", walletId).update();
    WalletView updated = wallet(walletId, memberId);
    audits.record(authorization, storeId, "MEMBER", "MEMBER_WALLET_DEFAULT_CHANGED", "member_wallet", walletId, "切换会员默认卡", null, updated);
    return updated;
  }

  @PutMapping("/{memberId}/wallets/{walletId}/active")
  @Transactional
  WalletView setActive(@PathVariable UUID memberId, @PathVariable UUID walletId, @RequestBody ActiveInput input,
                       @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                       @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    ensureWallet(memberId, walletId);
    if (!input.active() && jdbc.sql("select is_default from member_wallet where id=:id").param("id", walletId).query(Boolean.class).single()) {
      throw conflict("默认卡不能停用，请先切换默认卡");
    }
    jdbc.sql("update member_wallet set active=:active,updated_at=now(),version=version+1 where id=:id")
      .param("active", input.active()).param("id", walletId).update();
    WalletView updated = wallet(walletId, memberId);
    audits.record(authorization, storeId, "MEMBER", input.active() ? "MEMBER_WALLET_ENABLED" : "MEMBER_WALLET_DISABLED", "member_wallet", walletId, "切换会员卡状态", null, updated);
    return updated;
  }

  private List<WalletView> wallets(UUID memberId) {
    return jdbc.sql("select id,member_id,account_code,account_name,balance_cents,active,is_default from member_wallet where member_id=:member order by is_default desc,created_at,id")
      .param("member", memberId).query(WalletView.class).list();
  }

  private WalletView wallet(UUID walletId, UUID memberId) {
    return jdbc.sql("select id,member_id,account_code,account_name,balance_cents,active,is_default from member_wallet where id=:id and member_id=:member")
      .param("id", walletId).param("member", memberId).query(WalletView.class).single();
  }

  private void clearDefault(UUID memberId) {
    jdbc.sql("update member_wallet set is_default=false,updated_at=now(),version=version+1 where member_id=:member and is_default")
      .param("member", memberId).update();
  }

  private void ensureMember(UUID memberId) {
    jdbc.sql("select id from member where id=:id and tenant_id=:tenant and active for update")
      .param("id", memberId).param("tenant", TENANT_ID).query(UUID.class).optional().orElseThrow(() -> notFound("Member not found"));
  }

  private void ensureWallet(UUID memberId, UUID walletId) {
    ensureMember(memberId);
    jdbc.sql("select id from member_wallet where id=:id and member_id=:member for update")
      .param("id", walletId).param("member", memberId).query(UUID.class).optional().orElseThrow(() -> notFound("Wallet not found"));
  }

  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }
  private ResponseStatusException notFound(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }

  record WalletView(UUID id, UUID memberId, String accountCode, String accountName, Long balanceCents, Boolean active, Boolean isDefault) {}
  record PayerWalletView(UUID walletId, UUID memberId, String memberCode, String memberName, String memberPhone, String accountCode, String accountName, Long balanceCents, Boolean active, Boolean isDefault) {}
  record WalletInput(@Size(max = 40) String accountCode, @NotBlank @Size(max = 80) String accountName, Boolean isDefault) {}
  record ActiveInput(boolean active) {}
}
