package com.chengxin.massage.sales;

import java.util.UUID;
import java.util.Map;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;

@RestController
@RequestMapping("/api/v1/print-settings")
@CrossOrigin(origins = "*")
public class StorePrintSettingController {
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final ObjectMapper json;
  private final AuditService audits;
  StorePrintSettingController(JdbcClient jdbc, StoreContextService storeContext, ObjectMapper json, AuditService audits) { this.jdbc = jdbc; this.storeContext = storeContext; this.json = json; this.audits = audits; }

  @GetMapping
  PrintSetting get(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                   @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    return setting(storeContext.currentStore(authorization, requestedStoreId));
  }

  @PutMapping
  @Transactional
  PrintSetting update(@Valid @RequestBody PrintSettingInput input,
                      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    PrintSetting before = setting(storeId);
    jdbc.sql("update store_print_setting set store_name=:storeName,receipt_title=:title,store_address=:address,store_phone=:phone,header_note=:header,footer_note=:footer,paper_width_mm=:width,font_size_px=:font,margin_mm=:margin,copies=:copies,auto_print=:auto,show_store_address=:showAddress,show_store_phone=:showPhone,show_order_no=:showOrder,show_member=:showMember,show_technician=:showTechnician,show_room=:showRoom,show_payment=:showPayment,show_balance=:showBalance,content_options=cast(:contentOptions as jsonb),updated_at=now(),version=version+1 where store_id=:store")
      .param("store", storeId).param("storeName", input.storeName().trim()).param("title", input.receiptTitle().trim())
      .param("address", blankToNull(input.storeAddress())).param("phone", blankToNull(input.storePhone()))
      .param("header", blankToNull(input.headerNote())).param("footer", blankToNull(input.footerNote()))
      .param("width", input.paperWidthMm()).param("font", input.fontSizePx()).param("margin", input.marginMm()).param("copies", input.copies()).param("auto", input.autoPrint())
      .param("showAddress", input.showStoreAddress()).param("showPhone", input.showStorePhone()).param("showOrder", input.showOrderNo()).param("showMember", input.showMember()).param("showTechnician", input.showTechnician()).param("showRoom", input.showRoom()).param("showPayment", input.showPayment()).param("showBalance", input.showBalance()).param("contentOptions", contentOptions(input.contentOptions())).update();
    PrintSetting updated = setting(storeId);
    audits.record(authorization, storeId, "PRINT", "PRINT_SETTING_UPDATED", "store_print_setting", storeId, "修改小票打印设置", before, updated);
    return updated;
  }

  private PrintSetting setting(UUID storeId) {
    return jdbc.sql("select store_name,receipt_title,store_address,store_phone,header_note,footer_note,paper_width_mm,font_size_px,margin_mm,copies,auto_print,show_store_address,show_store_phone,show_order_no,show_member,show_technician,show_room,show_payment,show_balance,content_options::text content_options from store_print_setting where store_id=:store")
      .param("store", storeId).query(PrintSetting.class).single();
  }
  private String blankToNull(String value) { return value == null || value.isBlank() ? null : value.trim(); }
  private String contentOptions(Map<String, Boolean> value) { try { return json.writeValueAsString(value); } catch (JsonProcessingException exception) { throw new IllegalArgumentException("Invalid print content options", exception); } }

  record PrintSetting(String storeName, String receiptTitle, String storeAddress, String storePhone, String headerNote, String footerNote, Short paperWidthMm, Short fontSizePx, Short marginMm, Short copies, Boolean autoPrint, Boolean showStoreAddress, Boolean showStorePhone, Boolean showOrderNo, Boolean showMember, Boolean showTechnician, Boolean showRoom, Boolean showPayment, Boolean showBalance, String contentOptions) {}
  record PrintSettingInput(@NotBlank @Size(max = 120) String storeName, @NotBlank @Size(max = 80) String receiptTitle, @Size(max = 240) String storeAddress, @Size(max = 60) String storePhone, @Size(max = 240) String headerNote, @Size(max = 240) String footerNote, @NotNull @Min(50) @Max(120) Short paperWidthMm, @NotNull @Min(8) @Max(22) Short fontSizePx, @NotNull @Min(0) @Max(15) Short marginMm, @NotNull @Min(1) @Max(3) Short copies, boolean autoPrint, boolean showStoreAddress, boolean showStorePhone, boolean showOrderNo, boolean showMember, boolean showTechnician, boolean showRoom, boolean showPayment, boolean showBalance, @NotNull Map<String, Boolean> contentOptions) {}
}
