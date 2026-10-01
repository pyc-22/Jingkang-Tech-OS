package com.chengxin.massage.operations;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

/** HTTP endpoints for the store-manager reward workspace and the admin review view. */
@RestController
@CrossOrigin(origins = "*")
public class ManagerRewardController {
  private final ManagerRewardService rewards;
  private final StoreContextService storeContext;
  private final AdminSessionService sessions;
  private final BusinessClockService businessClock;

  ManagerRewardController(ManagerRewardService rewards, StoreContextService storeContext, AdminSessionService sessions,
                          BusinessClockService businessClock) {
    this.rewards = rewards;
    this.storeContext = storeContext;
    this.sessions = sessions;
    this.businessClock = businessClock;
  }

  @GetMapping("/api/v1/manager-rewards/daily")
  ManagerRewardService.RewardSnapshot daily(
      @RequestParam(required = false) String date,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    require(authorization, "MANAGER_REWARD_VIEW");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return rewards.daily(storeId, parseDate(date, storeId));
  }

  @GetMapping("/api/v1/manager-rewards/month")
  ManagerRewardService.MonthSnapshot month(
      @RequestParam(required = false) String month,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    require(authorization, "MANAGER_REWARD_VIEW");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return rewards.month(storeId, parseMonth(month, storeId));
  }

  @GetMapping("/api/v1/manager-rewards/yue/orders")
  List<ManagerRewardService.YueOrder> yueOrders(
      @RequestParam(required = false) String date,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    require(authorization, "MANAGER_REWARD_VIEW");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return rewards.yueOrders(storeId, parseDate(date, storeId));
  }

  @GetMapping("/api/v1/manager-rewards/yue/records")
  List<ManagerRewardService.YueRecord> yueRecords(
      @RequestParam(required = false) String date,
      @RequestParam(defaultValue = "false") boolean includeInactive,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    require(authorization, "MANAGER_REWARD_VIEW");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return rewards.yueRecords(storeId, parseDate(date, storeId), includeInactive);
  }

  @PostMapping(path = "/api/v1/manager-rewards/yue", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  ManagerRewardService.YueRecord createYue(
      @RequestParam("orderId") UUID orderId,
      @RequestPart("file") MultipartFile file,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    require(authorization, "MANAGER_REWARD_SUBMIT");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return rewards.createYue(storeId, sessions.requireAuthenticatedUserId(authorization), orderId, file);
  }

  @PutMapping(path = "/api/v1/manager-rewards/yue/{id}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  ManagerRewardService.YueRecord updateYue(
      @PathVariable UUID id,
      @RequestParam(value = "orderId", required = false) UUID orderId,
      @RequestParam(value = "customerName", required = false) String customerName,
      @RequestParam(value = "customerPhone", required = false) String customerPhone,
      @RequestParam(value = "note", required = false) String note,
      @RequestPart(value = "file", required = false) MultipartFile file,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    require(authorization, "MANAGER_REWARD_SUBMIT");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return rewards.updateYue(storeId, sessions.requireAuthenticatedUserId(authorization), id, orderId,
        customerName, customerPhone, note, file);
  }

  @GetMapping("/api/v1/manager-rewards/yue/{id}/attachment")
  ResponseEntity<byte[]> yueAttachment(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "false") boolean original,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    require(authorization, "MANAGER_REWARD_VIEW");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return attachmentResponse(rewards.attachment(storeId, id, false));
  }

  @GetMapping("/api/v1/admin/manager-rewards/daily")
  ManagerRewardService.RewardSnapshot adminDaily(
      @RequestParam UUID storeId,
      @RequestParam(required = false) String date,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    require(authorization, "MANAGER_REWARD_ADMIN_VIEW");
    UUID scopedStore = storeContext.currentStore(authorization, storeId.toString());
    return rewards.daily(scopedStore, parseDate(date, scopedStore));
  }

  @GetMapping("/api/v1/admin/manager-rewards/managers")
  List<ManagerRewardService.ManagerCandidate> managers(
      @RequestParam UUID storeId,
      @RequestParam(required = false) String date,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    require(authorization, "MANAGER_REWARD_ADMIN_VIEW");
    UUID scopedStore = storeContext.currentStore(authorization, storeId.toString());
    return rewards.managerCandidates(scopedStore, parseDate(date, scopedStore));
  }

  @GetMapping("/api/v1/admin/manager-rewards/month")
  ManagerRewardService.MonthSnapshot adminMonth(
      @RequestParam UUID storeId,
      @RequestParam(required = false) String month,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    require(authorization, "MANAGER_REWARD_ADMIN_VIEW");
    UUID scopedStore = storeContext.currentStore(authorization, storeId.toString());
    return rewards.month(scopedStore, parseMonth(month, scopedStore));
  }

  @GetMapping("/api/v1/admin/manager-rewards/yue/records")
  List<ManagerRewardService.YueRecord> adminYueRecords(
      @RequestParam UUID storeId,
      @RequestParam String from,
      @RequestParam String to,
      @RequestParam(defaultValue = "true") boolean includeInactive,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    require(authorization, "MANAGER_REWARD_ADMIN_VIEW");
    UUID scopedStore = storeContext.currentStore(authorization, storeId.toString());
    LocalDate start = parseDate(from, scopedStore);
    LocalDate end = parseDate(to, scopedStore);
    if (end.isBefore(start)) throw badRequest("结束日期不能早于开始日期");
    if (start.plusMonths(1).isBefore(end)) throw badRequest("约客查询范围不能超过两个月");
    return rewards.yueRecords(scopedStore, start, end, includeInactive);
  }

  @GetMapping("/api/v1/admin/manager-rewards/yue/{id}/attachment")
  ResponseEntity<byte[]> adminYueAttachment(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "false") boolean original,
      @RequestParam UUID storeId,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    require(authorization, original ? "MANAGER_REWARD_LOCK" : "MANAGER_REWARD_ADMIN_VIEW");
    UUID scopedStore = storeContext.currentStore(authorization, storeId.toString());
    return attachmentResponse(rewards.attachment(scopedStore, id, original));
  }

  @PostMapping("/api/v1/admin/manager-rewards/month-lock")
  ManagerRewardService.MonthSnapshot lockMonth(
      @Valid @RequestBody @NotNull LockInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    require(authorization, "MANAGER_REWARD_LOCK");
    UUID storeId = storeContext.currentStore(authorization, input.storeId().toString());
    return rewards.lockMonth(storeId, sessions.requireAuthenticatedUserId(authorization), parseMonth(input.month(), storeId));
  }

  @PostMapping("/api/v1/admin/manager-rewards/assignments")
  ManagerRewardService.Assignment assign(
      @Valid @RequestBody @NotNull AssignmentInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    require(authorization, "MANAGER_REWARD_LOCK");
    UUID storeId = storeContext.currentStore(authorization, input.storeId().toString());
    return rewards.assign(storeId, sessions.requireAuthenticatedUserId(authorization), parseDate(input.date(), storeId),
        input.managerUserId(), input.note());
  }

  @PutMapping("/api/v1/admin/manager-rewards/primary-manager")
  ManagerRewardService.ManagerCandidate setPrimaryManager(
      @Valid @RequestBody @NotNull PrimaryManagerInput input,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    require(authorization, "MANAGER_REWARD_LOCK");
    UUID storeId = storeContext.currentStore(authorization, input.storeId().toString());
    return rewards.setPrimaryManager(storeId, input.managerUserId());
  }

  private void require(String authorization, String permission) { sessions.requirePermission(authorization, permission); }

  private ResponseEntity<byte[]> attachmentResponse(ManagerRewardService.AttachmentDownload attachment) {
    String filename = URLEncoder.encode(attachment.filename(), StandardCharsets.UTF_8).replace("+", "%20");
    return ResponseEntity.ok().contentType(MediaType.parseMediaType(attachment.contentType()))
        .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename*=UTF-8''" + filename)
        .body(attachment.bytes());
  }

  private LocalDate parseDate(String value, UUID storeId) {
    if (value == null || value.isBlank()) return businessClock.currentBusinessDate(storeId);
    try { return LocalDate.parse(value); }
    catch (RuntimeException exception) { throw badRequest("日期必须使用 YYYY-MM-DD"); }
  }

  private YearMonth parseMonth(String value, UUID storeId) {
    if (value == null || value.isBlank()) return YearMonth.from(businessClock.currentBusinessDate(storeId));
    try { return YearMonth.parse(value); }
    catch (RuntimeException exception) { throw badRequest("月份必须使用 YYYY-MM"); }
  }

  private ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }

  public record LockInput(@NotNull UUID storeId, @NotNull @Size(min = 7, max = 7) String month) {}
  public record AssignmentInput(@NotNull UUID storeId, @NotNull @Size(min = 10, max = 10) String date,
                                @NotNull UUID managerUserId, @Size(max = 240) String note) {}
  public record PrimaryManagerInput(@NotNull UUID storeId, @NotNull UUID managerUserId) {}
}
