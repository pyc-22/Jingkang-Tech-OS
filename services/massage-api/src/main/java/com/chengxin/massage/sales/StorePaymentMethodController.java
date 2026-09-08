package com.chengxin.massage.sales;

import java.util.List;
import java.util.Locale;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
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
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;

@RestController
@RequestMapping("/api/v1/payment-methods")
@CrossOrigin(origins = "*")
public class StorePaymentMethodController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AuditService audits;
  StorePaymentMethodController(JdbcClient jdbc, StoreContextService storeContext, AuditService audits) { this.jdbc = jdbc; this.storeContext = storeContext; this.audits = audits; }

  @GetMapping
  List<PaymentMethod> list(@RequestParam(defaultValue = "false") boolean includeInactive, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    String sql = includeInactive ? "select id,code,name,method_kind,cash_counted,built_in,sort_order,note,active from store_payment_method where store_id=:store order by active desc,sort_order,code" : "select id,code,name,method_kind,cash_counted,built_in,sort_order,note,active from store_payment_method where store_id=:store and active=true order by sort_order,code";
    return jdbc.sql(sql).param("store", storeId).query(PaymentMethod.class).list();
  }

  @PostMapping
  @Transactional
  PaymentMethod create(@Valid @RequestBody PaymentMethodInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    UUID id = UUID.randomUUID(); String code = code(input.code());
    jdbc.sql("insert into store_payment_method(id,tenant_id,store_id,code,name,method_kind,cash_counted,sort_order,note) values(:id,:tenant,:store,:code,:name,'EXTERNAL',:cash,:sort,:note)")
      .param("id", id).param("tenant", TENANT_ID).param("store", storeId).param("code", code).param("name", input.name()).param("cash", input.cashCounted()).param("sort", input.sortOrder()).param("note", blankToNull(input.note())).update();
    PaymentMethod created = method(storeId, id);
    audits.record(authorization, storeId, "PAYMENT", "PAYMENT_METHOD_CREATED", "payment_method", id, "新增收款方式", null, created);
    return created;
  }

  @PutMapping("/{id}")
  @Transactional
  PaymentMethod update(@PathVariable UUID id, @Valid @RequestBody PaymentMethodInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    PaymentMethod existing = method(storeId, id);
    if (existing.builtIn()) throw bad("Built-in payment methods cannot be edited");
    jdbc.sql("update store_payment_method set code=:code,name=:name,cash_counted=:cash,sort_order=:sort,note=:note,updated_at=now(),version=version+1 where id=:id and store_id=:store")
      .param("id", id).param("store", storeId).param("code", code(input.code())).param("name", input.name()).param("cash", input.cashCounted()).param("sort", input.sortOrder()).param("note", blankToNull(input.note())).update();
    PaymentMethod updated = method(storeId, id);
    audits.record(authorization, storeId, "PAYMENT", "PAYMENT_METHOD_UPDATED", "payment_method", id, "修改收款方式", existing, updated);
    return updated;
  }

  @PutMapping("/{id}/active")
  @Transactional
  void active(@PathVariable UUID id, @RequestBody ActiveInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    PaymentMethod existing = method(storeId, id);
    if (existing.builtIn() && "MEMBER_BALANCE".equals(existing.code()) && !input.active()) throw bad("Member balance cannot be disabled");
    jdbc.sql("update store_payment_method set active=:active,updated_at=now(),version=version+1 where id=:id and store_id=:store").param("active", input.active()).param("id", id).param("store", storeId).update();
    audits.record(authorization, storeId, "PAYMENT", input.active() ? "PAYMENT_METHOD_ENABLED" : "PAYMENT_METHOD_DISABLED", "payment_method", id, input.active() ? "启用收款方式" : "停用收款方式", existing, method(storeId, id));
  }

  private PaymentMethod method(UUID storeId, UUID id) { return jdbc.sql("select id,code,name,method_kind,cash_counted,built_in,sort_order,note,active from store_payment_method where id=:id and store_id=:store").param("id", id).param("store", storeId).query(PaymentMethod.class).optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Payment method not found")); }
  private String code(String value) { String normalized=value.trim().toUpperCase(Locale.ROOT); if (!normalized.matches("[A-Z0-9_]{2,30}") || "MEMBER_BALANCE".equals(normalized)) throw bad("Invalid payment method code"); return normalized; }
  private String blankToNull(String value) { return value == null || value.isBlank() ? null : value.trim(); }
  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  record PaymentMethod(UUID id, String code, String name, String methodKind, Boolean cashCounted, Boolean builtIn, Short sortOrder, String note, Boolean active) {}
  record PaymentMethodInput(@NotBlank @Size(max=30) String code, @NotBlank @Size(max=60) String name, boolean cashCounted, Short sortOrder, @Size(max=240) String note) {}
  record ActiveInput(boolean active) {}
}
