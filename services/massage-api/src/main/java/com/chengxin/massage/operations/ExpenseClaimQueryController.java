package com.chengxin.massage.operations;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
@CrossOrigin(origins = "*")
public class ExpenseClaimQueryController {
  private final ExpenseClaimQueryService queries;
  private final AdminSessionService sessions;
  private final StoreContextService stores;

  ExpenseClaimQueryController(ExpenseClaimQueryService queries, AdminSessionService sessions, StoreContextService stores) {
    this.queries = queries; this.sessions = sessions; this.stores = stores;
  }

  @GetMapping("/expense-claims/page")
  ExpenseClaimQueryService.ClaimPage storePage(@ModelAttribute ExpenseClaimQueryService.Query query,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String storeId,
      HttpServletResponse response) {
    noStore(response);
    return queries.page(query, storeAccess(authorization, storeId));
  }

  @GetMapping("/finance/expense-claims/page")
  ExpenseClaimQueryService.ClaimPage financePage(@ModelAttribute ExpenseClaimQueryService.Query query,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      HttpServletResponse response) {
    noStore(response);
    financeAccess(authorization);
    return queries.page(query, null);
  }

  @GetMapping("/expense-claims/export")
  ResponseEntity<byte[]> storeExport(@ModelAttribute ExpenseClaimQueryService.Query query,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String storeId,
      HttpServletResponse response) {
    noStore(response);
    return download(queries.export(query, storeAccess(authorization, storeId)));
  }

  @GetMapping("/finance/expense-claims/export")
  ResponseEntity<byte[]> financeExport(@ModelAttribute ExpenseClaimQueryService.Query query,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      HttpServletResponse response) {
    noStore(response);
    financeAccess(authorization);
    return download(queries.export(query, null));
  }

  private UUID storeAccess(String authorization, String storeId) {
    sessions.requirePermission(authorization, "EXPENSE_STORE_VIEW");
    return stores.currentStore(authorization, storeId);
  }
  private void financeAccess(String authorization) {
    sessions.requirePermission(authorization, "EXPENSE_REVIEW");
    sessions.requirePermission(authorization, "EXPENSE_ALL_STORE_VIEW");
  }
  private ResponseEntity<byte[]> download(byte[] body) {
    return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
      .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=expense-claims.xlsx").body(body);
  }
  private void noStore(HttpServletResponse response) { response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store, max-age=0"); }
}
