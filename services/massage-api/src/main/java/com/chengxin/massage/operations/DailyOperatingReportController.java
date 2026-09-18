package com.chengxin.massage.operations;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

@RestController
@RequestMapping("/api/v1/daily-reports")
@CrossOrigin(origins = "*")
public class DailyOperatingReportController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final ObjectMapper objectMapper;
  private final AuditService audits;
  private final BusinessClockService businessClock;
  private final DailyReportService dailyReports;
  private static final List<DefaultField> DEFAULT_FIELDS = List.of(
    field("monthlyTargetCents","MONTHLY","当月目标",10), field("salesAmountCents","MONTHLY","累计营业额",20), field("cashFlowCents","MONTHLY","累计现金流",30), field("cardSaleCents","MONTHLY","累计售卡",40), field("cardOpenCents","MONTHLY","累计开卡金额（兼容）",49), field("cardOpenCount","MONTHLY","开卡数量",50), field("cardRenewCents","MONTHLY","累计续卡",60), field("cardConsumptionCents","MONTHLY","累计卡耗",70), field("customerCount","MONTHLY","当月总客流",80), field("extensionCount","MONTHLY","累计加钟",90), field("callClockCount","MONTHLY","累计点钟",100), field("serviceClockRate","MONTHLY","加点钟率",110), field("averageCustomerSpendCents","MONTHLY","平均客消",120),
    field("dailyTargetCents","DAILY","当日目标",10), field("dailySalesAmountCents","DAILY","当日营业额",20), field("dailyCashFlowCents","DAILY","当日现金流",30), field("dailyCardSaleCents","DAILY","当日售卡",40), field("dailyCardOpenCents","DAILY","当日开卡金额（兼容）",49), field("dailyCardOpenCount","DAILY","开卡数量",50), field("dailyCardRenewCents","DAILY","当日续卡",60), field("dailyCardCancellationCents","DAILY","当日销卡",70), field("dailyCardConsumptionCents","DAILY","当日卡耗",80), field("dailyCustomerCount","DAILY","当日总客流",90), field("dailyExtensionCount","DAILY","当日加钟",100), field("dailyCallClockCount","DAILY","当日点钟",110), field("dailyServiceClockRate","DAILY","当日加点钟率",120),
    field("managerCount","PERSONNEL","店长人数",10), field("cashierCount","PERSONNEL","前台人数",20), field("technicianCount","PERSONNEL","技师人数",30), field("chefCount","PERSONNEL","厨师人数",40), field("cleanerCount","PERSONNEL","保洁人数",50),
    field("incidentNote","HANDOVER","突发事件",10), field("extendedShiftNote","HANDOVER","托班人员",20), field("nextDayRestCount","HANDOVER","明日休息人数",30), field("customerLossCount","HANDOVER","今日流失人数",40), field("nextDayImprovementNote","HANDOVER","明日改进反省",50)
  );

  @Autowired
  DailyOperatingReportController(JdbcClient jdbc, StoreContextService storeContext,
                                 AdminSessionService adminSessions, ObjectMapper objectMapper, AuditService audits,
                                 BusinessClockService businessClock, DailyReportService dailyReports) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.adminSessions = adminSessions;
    this.objectMapper = objectMapper;
    this.audits = audits;
    this.businessClock = businessClock;
    this.dailyReports = dailyReports;
  }

  DailyOperatingReportController(JdbcClient jdbc, StoreContextService storeContext,
                                 AdminSessionService adminSessions, ObjectMapper objectMapper, AuditService audits, BusinessClockService businessClock) {
    this(jdbc, storeContext, adminSessions, objectMapper, audits, businessClock, null);
  }

  @GetMapping
  ReportView get(@RequestParam(defaultValue = "") String date,
                 @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                 @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    adminSessions.requirePermission(authorization, "DAILY_REPORT_VIEW");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    DailyReportAccess access = access(authorization);
    ReportView report = view(storeId, parseDate(date, storeId), access);
    requirePublishedForViewer(report, access);
    return report;
  }

  @PutMapping("/customer-count-override")
  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  ReportView saveCustomerCountOverride(@Valid @RequestBody CustomerCountOverrideInput input,
                                       @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                       @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    adminSessions.requirePermission(authorization, "DAILY_REPORT_EDIT");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    UUID actor = adminSessions.requireAuthenticatedUserId(authorization);
    LocalDate date = requireDate(input.businessDate(), storeId);
    if (input.customerCount() == null || input.customerCount() < 0) throw badRequest("Customer count must be a non-negative integer");
    String reason = input.reason() == null ? "" : input.reason().trim();
    if (reason.isBlank() || reason.length() > 500) throw badRequest("A correction reason is required and must not exceed 500 characters");
    CustomerCountOverrideRow before = customerCountOverrideRow(storeId, date).orElse(null);
    UUID id = before == null ? UUID.randomUUID() : before.id();
    jdbc.sql("""
      insert into daily_customer_count_override(id,tenant_id,store_id,business_date,customer_count,reason,updated_by_user_id)
      values(:id,:tenant,:store,:date,:count,:reason,:actor)
      on conflict(store_id,business_date) do update set customer_count=excluded.customer_count,
        reason=excluded.reason,updated_by_user_id=excluded.updated_by_user_id,updated_at=now()
      """)
      .param("id", id).param("tenant", TENANT_ID).param("store", storeId).param("date", date)
      .param("count", input.customerCount()).param("reason", reason).param("actor", actor).update();
    CustomerCountOverrideRow saved = customerCountOverrideRow(storeId, date).orElseThrow();
    audits.record(authorization, storeId, "DAILY_REPORT", "DAILY_CUSTOMER_COUNT_CORRECTED", "daily_customer_count_override", saved.id(),
      "Daily customer count corrected", before, saved);
    return view(storeId, date, access(authorization));
  }

  @DeleteMapping("/customer-count-override")
  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  ReportView clearCustomerCountOverride(@RequestParam(defaultValue = "") String date,
                                        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                        @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    adminSessions.requirePermission(authorization, "DAILY_REPORT_EDIT");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate businessDate = parseDate(date, storeId);
    CustomerCountOverrideRow before = customerCountOverrideRow(storeId, businessDate).orElse(null);
    if (before != null) {
      jdbc.sql("delete from daily_customer_count_override where store_id=:store and business_date=:date")
        .param("store", storeId).param("date", businessDate).update();
      audits.record(authorization, storeId, "DAILY_REPORT", "DAILY_CUSTOMER_COUNT_OVERRIDE_CLEARED", "daily_customer_count_override", before.id(),
        "Daily customer count override cleared", before, null);
    }
    return view(storeId, businessDate, access(authorization));
  }

  @GetMapping("/settings")
  DailyReportSettings settings(@RequestParam(defaultValue = "") String month,
                               @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                               @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    adminSessions.requirePermission(authorization, "DAILY_REPORT_CONFIG");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return settings(storeId, parseMonth(month, storeId));
  }

  @PutMapping("/settings")
  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  DailyReportSettings saveSettings(@Valid @RequestBody DailyReportSettingsInput input,
                                   @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                   @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    adminSessions.requirePermission(authorization, "DAILY_REPORT_CONFIG");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    UUID actor = adminSessions.requireAuthenticatedUserId(authorization);
    LocalDate month = requireDate(input.targetMonth(), storeId).withDayOfMonth(1);
    DailyReportSettings before = settings(storeId, month);
    long target = amount(input.monthlyTargetCents());
    jdbc.sql("insert into daily_report_month_target(id,tenant_id,store_id,target_month,monthly_target_cents,updated_by_user_id) values(:id,:tenant,:store,:month,:target,:actor) on conflict(store_id,target_month) do update set monthly_target_cents=excluded.monthly_target_cents,updated_by_user_id=excluded.updated_by_user_id,updated_at=now(),version=daily_report_month_target.version+1")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("month", month).param("target", target).param("actor", actor).update();
    Map<String, DefaultField> defaults = defaultFieldsByCode();
    for (DailyReportFieldInput item : input.fields() == null ? List.<DailyReportFieldInput>of() : input.fields()) {
      DefaultField base = defaults.get(item.fieldCode());
      if (base == null) throw badRequest("Unknown daily report field");
      if (item.fieldLabel() == null || item.fieldLabel().isBlank() || item.fieldLabel().length() > 120) throw badRequest("Field label is required and must not exceed 120 characters");
      if (item.visible() == null || item.required() == null) throw badRequest("Field visibility and required state are required");
      if (item.sortOrder() == null || item.sortOrder() < 0) throw badRequest("Field sort order must be non-negative");
      jdbc.sql("insert into daily_report_field_config(id,tenant_id,store_id,field_code,field_label,section_code,visible,required,sort_order) values(:id,:tenant,:store,:code,:label,:section,:visible,:required,:sort) on conflict(store_id,field_code) do update set field_label=excluded.field_label,section_code=excluded.section_code,visible=excluded.visible,required=excluded.required,sort_order=excluded.sort_order,updated_at=now(),version=daily_report_field_config.version+1")
        .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("code", base.fieldCode()).param("label", item.fieldLabel().trim()).param("section", base.sectionCode()).param("visible", item.visible()).param("required", item.required()).param("sort", item.sortOrder()).update();
    }
    DailyReportSettings saved = settings(storeId, month);
    audits.record(authorization, storeId, "DAILY_REPORT", "DAILY_REPORT_SETTINGS_UPDATED", "daily_report_settings", storeId,
      "Daily report settings updated", before, saved);
    return saved;
  }

  @GetMapping("/summary")
  List<StoreReportView> summary(@RequestParam(defaultValue = "") String date,
                                @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    adminSessions.requirePermission(authorization, "DAILY_REPORT_VIEW");
    DailyReportAccess access = access(authorization);
    List<StoreReportView> result = new ArrayList<>();
    for (AdminSessionService.AdminStore store : adminSessions.accessibleStores(authorization)) {
      LocalDate businessDate = parseDate(date, store.id());
      ReportView report = view(store.id(), businessDate, access);
      if (access.canEdit() || isPublished(report)) result.add(new StoreReportView(store.id(), store.code(), store.name(), report));
    }
    return result;
  }

  @GetMapping("/export")
  ResponseEntity<byte[]> export(@RequestParam(defaultValue = "") String date,
                                @RequestParam(defaultValue = "") String from,
                                @RequestParam(defaultValue = "") String to,
                                @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    adminSessions.requirePermission(authorization, "DAILY_REPORT_VIEW");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate start = from.isBlank() ? parseDate(date, storeId) : parseDate(from, storeId);
    LocalDate end = to.isBlank() ? start : parseDate(to, storeId);
    if (end.isBefore(start)) throw badRequest("The export end date must not be before the start date");
    if (start.plusDays(92).isBefore(end)) throw badRequest("The export date range cannot exceed 93 days");
    DailyReportAccess access = access(authorization);
    List<LocalDate> exportDates = new ArrayList<>();
    for (LocalDate businessDate = start; !businessDate.isAfter(end); businessDate = businessDate.plusDays(1)) {
      ReportView report = view(storeId, businessDate, access);
      if (access.canEdit() || isPublished(report)) exportDates.add(businessDate);
    }
    if (exportDates.isEmpty()) throw notFound("No published daily report is available for export");
    String storeName = storeName(authorization, storeId);
    String filename = end.equals(start)
      ? "%s_每日营业日报_%s.xlsx".formatted(storeName, start)
      : "%s_每日营业日报_%s_至_%s.xlsx".formatted(storeName, start, end);
    return ResponseEntity.ok()
      .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
      .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + URLEncoder.encode(filename, StandardCharsets.UTF_8).replace("+", "%20"))
      .body(exportWorkbook(storeId, storeName, exportDates, access));
  }

  @PostMapping
  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  ReportView create(@Valid @RequestBody ReportInput input,
                    @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                    @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    adminSessions.requirePermission(authorization, "DAILY_REPORT_EDIT");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate date = requireDate(input.businessDate(), storeId);
    if (exists(storeId, date)) throw conflict("A daily report already exists for this store and date");
    UUID actor = adminSessions.requireAuthenticatedUserId(authorization);
    ReportValues values = values(input, autoValues(storeId, date));
    UUID id = UUID.randomUUID();
    Map<String, Object> params = values.params();
    params.put("id", id); params.put("tenant", TENANT_ID); params.put("store", storeId); params.put("date", date);
    params.put("actor", actor);
    jdbc.sql("""
      insert into daily_operating_report(id,tenant_id,store_id,business_date,status,
        daily_target_cents,daily_sales_amount_cents,daily_cash_flow_cents,daily_card_sale_cents,
        daily_card_open_cents,daily_card_renew_cents,daily_card_cancellation_cents,daily_card_consumption_cents,
        daily_customer_count,daily_extension_count,daily_call_clock_count,daily_cash_cents,daily_alipay_cents,daily_douyin_cents,
        daily_meituan_cents,daily_free_order_cents,daily_entertainment_cents,manager_count,cashier_count,
        technician_count,chef_count,cleaner_count,incident_note,extended_shift_note,next_day_rest_count,
        customer_loss_count,next_day_improvement_note,created_by_user_id,updated_by_user_id)
      values(:id,:tenant,:store,:date,'DRAFT',:dailyTarget,:dailySales,:dailyCashFlow,:dailyCardSale,
        :dailyCardOpen,:dailyCardRenew,:dailyCardCancellation,:dailyCardConsumption,:dailyCustomerCount,
        :dailyExtensionCount,:dailyCallClockCount,:dailyCash,:dailyAlipay,:dailyDouyin,:dailyMeituan,:dailyFreeOrder,
        :dailyEntertainment,:managerCount,:cashierCount,:technicianCount,:chefCount,:cleanerCount,
        :incidentNote,:extendedShiftNote,:nextDayRestCount,:customerLossCount,:nextDayImprovement,:actor,:actor)
      """).params(params).update();
    saveRevision(id, storeId, actor, "CREATE", null, values);
    ReportView created = view(storeId, date, access(authorization));
    audits.record(authorization, storeId, "DAILY_REPORT", "DAILY_REPORT_CREATED", "daily_operating_report", id,
      "Daily operating report created", null, created.report());
    return created;
  }

  @PutMapping("/{id}")
  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  ReportView update(@PathVariable UUID id, @Valid @RequestBody ReportInput input,
                    @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                    @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    adminSessions.requirePermission(authorization, "DAILY_REPORT_EDIT");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    DailyReportRow current = load(id, storeId).orElseThrow(() -> notFound("Daily report not found"));
    if ("PUBLISHED".equals(current.status())) throw conflict("Published daily reports are locked");
    UUID actor = adminSessions.requireAuthenticatedUserId(authorization);
    ReportValues values = values(input, autoValues(storeId, current.businessDate()));
    Map<String, Object> params = values.params(); params.put("id", id); params.put("store", storeId); params.put("actor", actor);
    params.put("version", input.version() == null ? current.version() : input.version());
    int updated = jdbc.sql("""
      update daily_operating_report set daily_target_cents=:dailyTarget,daily_sales_amount_cents=:dailySales,
        daily_cash_flow_cents=:dailyCashFlow,daily_card_sale_cents=:dailyCardSale,daily_card_open_cents=:dailyCardOpen,
        daily_card_renew_cents=:dailyCardRenew,daily_card_cancellation_cents=:dailyCardCancellation,
        daily_card_consumption_cents=:dailyCardConsumption,daily_customer_count=:dailyCustomerCount,
        daily_extension_count=:dailyExtensionCount,daily_call_clock_count=:dailyCallClockCount,
        daily_cash_cents=:dailyCash,daily_alipay_cents=:dailyAlipay,
        daily_douyin_cents=:dailyDouyin,daily_meituan_cents=:dailyMeituan,daily_free_order_cents=:dailyFreeOrder,
        daily_entertainment_cents=:dailyEntertainment,manager_count=:managerCount,cashier_count=:cashierCount,
        technician_count=:technicianCount,chef_count=:chefCount,cleaner_count=:cleanerCount,incident_note=:incidentNote,
        extended_shift_note=:extendedShiftNote,next_day_rest_count=:nextDayRestCount,customer_loss_count=:customerLossCount,
        next_day_improvement_note=:nextDayImprovement,status='SAVED',updated_by_user_id=:actor,last_saved_at=now(),updated_at=now(),version=version+1
      where id=:id and store_id=:store and status <> 'PUBLISHED' and version=:version
      """).params(params).update();
    if (updated == 0) throw conflict("Daily report changed or was published; refresh before saving");
    saveRevision(id, storeId, actor, "SAVE", current, values);
    ReportView saved = view(storeId, current.businessDate(), access(authorization));
    audits.record(authorization, storeId, "DAILY_REPORT", "DAILY_REPORT_SAVED", "daily_operating_report", id,
      "Daily operating report saved", current, saved.report());
    return saved;
  }

  @PostMapping("/{id}/publish")
  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  ReportView publish(@PathVariable UUID id,
                     @RequestParam(required = false) Long version,
                     @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    adminSessions.requirePermission(authorization, "DAILY_REPORT_PUBLISH");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    DailyReportRow current = load(id, storeId).orElseThrow(() -> notFound("Daily report not found"));
    UUID actor = adminSessions.requireAuthenticatedUserId(authorization);
    int updated = jdbc.sql("update daily_operating_report set status='PUBLISHED',published_by_user_id=:actor,published_at=now(),updated_by_user_id=:actor,updated_at=now(),version=version+1 where id=:id and store_id=:store and status <> 'PUBLISHED' and version=:version")
      .param("id", id).param("store", storeId).param("actor", actor).param("version", version == null ? current.version() : version).update();
    if (updated == 0) throw conflict("Daily report changed or was published; refresh before publishing");
    saveRevision(id, storeId, actor, "PUBLISH", current, current.values());
    ReportView published = view(storeId, current.businessDate(), access(authorization));
    audits.record(authorization, storeId, "DAILY_REPORT", "DAILY_REPORT_PUBLISHED", "daily_operating_report", id,
      "Daily operating report published", current, published.report());
    return published;
  }

  @GetMapping("/{id}/revisions")
  List<RevisionView> revisions(@PathVariable UUID id,
                               @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                               @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    adminSessions.requirePermission(authorization, "DAILY_REPORT_VIEW");
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    DailyReportRow report = load(id, storeId).orElseThrow(() -> notFound("Daily report not found"));
    if (!access(authorization).canEdit() && !"PUBLISHED".equals(report.status())) throw notFound("Daily report not found");
    return jdbc.sql("select revision.revision_no,revision.action,revision.after_data::text after_data,revision.actor_user_id,revision.created_at,coalesce(actor.display_name,'') actor_name from daily_operating_report_revision revision left join app_user actor on actor.id=revision.actor_user_id where revision.report_id=:report and revision.store_id=:store order by revision.revision_no desc")
      .param("report", id).param("store", storeId).query(RevisionView.class).list();
  }

  private byte[] exportWorkbook(UUID storeId, String storeName, List<LocalDate> businessDates, DailyReportAccess access) {
    try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      CellStyle title = style(workbook, true, HorizontalAlignment.CENTER);
      CellStyle section = style(workbook, true, HorizontalAlignment.LEFT);
      CellStyle label = style(workbook, false, HorizontalAlignment.LEFT);
      CellStyle value = style(workbook, false, HorizontalAlignment.RIGHT);
      for (LocalDate businessDate : businessDates) {
        ReportView report = view(storeId, businessDate, access);
        Sheet sheet = workbook.createSheet(businessDate.toString());
        sheet.setColumnWidth(0, 23 * 256); sheet.setColumnWidth(1, 20 * 256);
        sheet.setColumnWidth(2, 23 * 256); sheet.setColumnWidth(3, 20 * 256);
        int row = 0;
        Row heading = sheet.createRow(row++);
        heading.setHeightInPoints(28);
        cell(heading, 0, storeName + " 每日营业日报", title); sheet.addMergedRegion(new org.apache.poi.ss.util.CellRangeAddress(0, 0, 0, 3));
        row = pair(sheet, row, "营业日期", businessDate.toString(), "日报状态", report.report() == null ? "草稿（未保存）" : statusName(report.report().status()), label, value);
        row = pair(sheet, row, "最后保存时间", formatTime(report.report() == null ? null : report.report().lastSavedAt()), "最后编辑人", report.report() == null ? "--" : empty(report.report().updatedByName()), label, value);
        List<ExportItem> monthlyItems = new ArrayList<>(List.of(
          item("当月目标", money(report.monthly().monthlyTargetCents())), item("累计营业额", money(report.monthly().salesAmountCents())),
          item("累计现金流", money(report.monthly().cashFlowCents())), item("累计售卡", money(report.monthly().cardSaleCents())),
          item("开卡数量", String.valueOf(report.monthly().cardOpenCount())), item("累计续卡", money(report.monthly().cardRenewCents())),
          item("累计卡耗", money(report.monthly().cardConsumptionCents())), item("当月总客流", String.valueOf(report.monthly().customerCount())),
          item("累计加钟", String.valueOf(report.monthly().extensionCount())), item("累计点钟", String.valueOf(report.monthly().callClockCount())),
          item("加点钟率", report.derived().monthlyServiceClockRate().toPlainString() + "%"),
          item("平均客消", money(report.derived().averageCustomerSpendCents().longValue())),
          item("累计红冲退款", money(report.monthly().refundAmountCents())),
          item("月度目标完成率", report.derived().monthlyTargetCompletionRate().toPlainString() + "%")));
        report.monthlyPaymentChannels().forEach(channel -> monthlyItems.add(item("累计" + channel.name() + "净实收", money(channel.netCents()))));
        row = exportSection(sheet, row, "月度累计信息", monthlyItems, section, label, value);
        ReportValues values = report.currentValues();
        row = exportSection(sheet, row, "当日经营信息", List.of(
          item("当日目标", money(values.dailyTargetCents())), item("当日营业额", money(values.dailySalesCents())),
          item("当日现金流", money(values.dailyCashFlowCents())), item("当日售卡", money(values.dailyCardSaleCents())),
          item("开卡数量", String.valueOf(values.dailyCardOpenCount())), item("当日续卡", money(values.dailyCardRenewCents())),
          item("当日销卡", money(values.dailyCardCancellationCents())), item("当日卡耗", money(values.dailyCardConsumptionCents())),
          item("当日总客流", String.valueOf(values.dailyCustomerCount())), item("当日加钟", String.valueOf(values.dailyExtensionCount())),
          item("当日点钟", String.valueOf(values.dailyCallClockCount())), item("当日加点钟率", report.derived().dailyServiceClockRate().toPlainString() + "%"),
          item("当日客消", money(report.derived().dailyAverageCustomerSpendCents().longValue())), item("本日红冲退款", money(report.refundAmountCents())),
          item("目标完成率", report.derived().dailyTargetCompletionRate().toPlainString() + "%")), section, label, value);
        List<ExportItem> channelItems = new ArrayList<>();
        report.paymentChannels().forEach(channel -> {
          channelItems.add(item(channel.name() + "收款", money(channel.salesCents())));
          channelItems.add(item(channel.name() + "退款", money(channel.refundCents())));
          channelItems.add(item(channel.name() + "充值", money(channel.rechargeCents())));
          channelItems.add(item(channel.name() + "充值退款", money(channel.rechargeRefundCents())));
          channelItems.add(item(channel.name() + "净实收", money(channel.netCents())));
        });
        channelItems.add(item("支付渠道净合计", money(report.derived().paymentChannelTotalCents())));
        row = exportSection(sheet, row, "支付渠道明细", channelItems, section, label, value);
        row = exportSection(sheet, row, "人事情况", List.of(
          item("店长人数", String.valueOf(values.managerCount())), item("前台人数", String.valueOf(values.cashierCount())),
          item("技师人数", String.valueOf(values.technicianCount())), item("厨师人数", String.valueOf(values.chefCount())), item("保洁人数", String.valueOf(values.cleanerCount()))), section, label, value);
        row = exportSection(sheet, row, "晚班交接事项", List.of(
          item("突发事件", empty(values.incidentNote())), item("托班人员", empty(values.extendedShiftNote())),
          item("明日休息人数", String.valueOf(values.nextDayRestCount())), item("今日流失人数", String.valueOf(values.customerLossCount())),
          item("明日改进反省", empty(values.nextDayImprovementNote()))), section, label, value);
        sheet.setPrintGridlines(false); sheet.getPrintSetup().setLandscape(false); sheet.setFitToPage(true); sheet.getPrintSetup().setFitWidth((short) 1); sheet.getPrintSetup().setFitHeight((short) 0);
      }
      workbook.write(output);
      return output.toByteArray();
    } catch (IOException exception) { throw new IllegalStateException("Unable to generate daily report workbook", exception); }
  }

  private int exportSection(Sheet sheet, int row, String title, List<ExportItem> items, CellStyle section, CellStyle label, CellStyle value) {
    Row heading = sheet.createRow(row++); cell(heading, 0, title, section); sheet.addMergedRegion(new org.apache.poi.ss.util.CellRangeAddress(row - 1, row - 1, 0, 3));
    for (int index = 0; index < items.size(); index += 2) {
      ExportItem left = items.get(index); ExportItem right = index + 1 < items.size() ? items.get(index + 1) : new ExportItem("", "");
      Row line = sheet.createRow(row++); cell(line, 0, left.label(), label); cell(line, 1, left.value(), value); cell(line, 2, right.label(), label); cell(line, 3, right.value(), value);
    }
    return row;
  }

  private CellStyle style(XSSFWorkbook workbook, boolean bold, HorizontalAlignment alignment) {
    CellStyle style = workbook.createCellStyle(); style.setAlignment(alignment); style.setVerticalAlignment(org.apache.poi.ss.usermodel.VerticalAlignment.CENTER); style.setBorderBottom(BorderStyle.THIN); style.setBorderTop(BorderStyle.THIN); style.setBorderLeft(BorderStyle.THIN); style.setBorderRight(BorderStyle.THIN);
    Font font = workbook.createFont(); font.setBold(bold); font.setFontName("Microsoft YaHei"); style.setFont(font); return style;
  }
  private void cell(Row row, int index, String content, CellStyle style) { Cell cell = row.createCell(index); cell.setCellValue(content); cell.setCellStyle(style); }
  private int pair(Sheet sheet, int row, String leftLabel, String leftValue, String rightLabel, String rightValue, CellStyle label, CellStyle value) { Row line = sheet.createRow(row); cell(line, 0, leftLabel, label); cell(line, 1, leftValue, value); cell(line, 2, rightLabel, label); cell(line, 3, rightValue, value); return row + 1; }
  private ExportItem item(String label, String value) { return new ExportItem(label, value); }
  private String money(long cents) { return BigDecimal.valueOf(cents, 2).setScale(2).toPlainString(); }
  private String formatTime(OffsetDateTime time) { return time == null ? "--" : time.atZoneSameInstant(BUSINESS_ZONE).toLocalDateTime().toString().replace('T', ' '); }
  private String statusName(String status) { return "PUBLISHED".equals(status) ? "已发布" : "SAVED".equals(status) ? "已保存" : "草稿"; }
  private String empty(String value) { return value == null || value.isBlank() ? "--" : value; }
  private String storeName(String authorization, UUID storeId) { return adminSessions.accessibleStores(authorization).stream().filter(store -> store.id().equals(storeId)).map(AdminSessionService.AdminStore::name).findFirst().orElse("门店"); }

  private ReportView view(UUID storeId, LocalDate date, DailyReportAccess access) {
    return dailyReports == null ? viewSnapshot(storeId, date, access)
      : dailyReports.snapshot(() -> viewSnapshot(storeId, date, access));
  }

  private ReportView viewSnapshot(UUID storeId, LocalDate date, DailyReportAccess access) {
    DailyReportService.DailyMetrics unifiedMetrics = dailyReports == null ? null : dailyReports.daily(storeId, date);
    DailyReportRow report = loadByDate(storeId, date).orElse(null);
    List<PaymentChannelSummary> paymentChannels = paymentChannels(storeId, date, date);
    List<PaymentChannelSummary> monthlyPaymentChannels = paymentChannels(storeId, date.withDayOfMonth(1), date);
    ReportValues automatic = autoValues(storeId, date, paymentChannels);
    CustomerCountOverrideRow countOverride = customerCountOverrideRow(storeId, date).orElse(null);
    ReportValues live = applyCustomerCountOverride(automatic, countOverride);
    ReportValues current = report == null ? live : operationalValues(report.values(), live);
    MonthlySummary monthly = monthly(storeId, date, monthlyPaymentChannels);
    long refunds = paymentChannels.stream().mapToLong(PaymentChannelSummary::refundCents).sum();
    return new ReportView(report, monthly, derived(current, monthly, paymentChannels), current, access, refunds,
      paymentChannels, monthlyPaymentChannels, customerCountOverride(countOverride, automatic.dailyCustomerCount()), unifiedMetrics);
  }

  private DailyReportAccess access(String authorization) {
    return new DailyReportAccess(adminSessions.hasPermission(authorization, "DAILY_REPORT_EDIT"),
      adminSessions.hasPermission(authorization, "DAILY_REPORT_PUBLISH"),
      adminSessions.hasPermission(authorization, "DAILY_REPORT_CONFIG"));
  }
  private boolean isPublished(ReportView report) { return report.report() != null && "PUBLISHED".equals(report.report().status()); }
  private void requirePublishedForViewer(ReportView report, DailyReportAccess access) { if (!access.canEdit() && !isPublished(report)) throw notFound("Daily report not found"); }

  private MonthlySummary monthly(UUID storeId, LocalDate date, List<PaymentChannelSummary> channels) {
    LocalDate month = date.withDayOfMonth(1);
    Long customerCount;
    if (dailyReports != null) {
      long total = 0;
      for (LocalDate item = month; !item.isAfter(date); item = item.plusDays(1)) {
        DailyReportService.DailyMetrics metrics = dailyReports.daily(storeId, item);
        total = Math.addExact(total, metrics.customerCount());
      }
      customerCount = total;
    } else customerCount = jdbc.sql("""
      with calendar as (
        select generate_series(cast(:month as date), cast(:date as date), interval '1 day')::date business_date
      ), daily_counts as (
        select ((coalesce(sales.settled_at,sales.created_at) at time zone reporting_store.timezone)::date
          - case when (coalesce(sales.settled_at,sales.created_at) at time zone reporting_store.timezone)::time < reporting_store.business_day_cutoff then 1 else 0 end) business_date,
          count(*) auto_count
        from sales_order sales
        join store reporting_store on reporting_store.id=sales.store_id
        where sales.store_id=:store and sales.status='SETTLED' and sales.paid_cents>0
          and coalesce(sales.refund_status, 'NONE') <> 'FULL'
          and (not exists(select 1 from sales_order_service_session linked_session where linked_session.order_id=sales.id)
            or exists(select 1 from sales_order_service_session linked_session join service_session linked_service on linked_service.id=linked_session.service_session_id
                      where linked_session.order_id=sales.id and linked_service.status<>'VOIDED'))
        group by 1
      )
      select coalesce(sum(coalesce(correction.customer_count, daily_counts.auto_count, 0)),0)
      from calendar
      left join daily_counts on daily_counts.business_date=calendar.business_date
      left join daily_customer_count_override correction on correction.store_id=:store and correction.business_date=calendar.business_date
      """).param("store", storeId).param("month", month).param("date", date).query(Long.class).single();
    Long calls = jdbc.sql("select count(*) from service_session where store_id=:store and clock_type in ('CALL','BOOKED_CALL') and status='COMPLETED' and counts_as_clock_snapshot=true and business_date between :month and :date")
      .param("store", storeId).param("month", month).param("date", date).query(Long.class).single();
    Long extensions = jdbc.sql("select count(*) from service_session_extension extension join service_session session on session.id=extension.service_session_id where extension.store_id=:store and extension.counts_as_clock_snapshot=true and session.business_date between :month and :date")
      .param("store", storeId).param("month", month).param("date", date).query(Long.class).single();
    CardActivity cards = cardActivity(storeId, month, date);
    long target = jdbc.sql("select monthly_target_cents from daily_report_month_target where store_id=:store and target_month=:month")
      .param("store", storeId).param("month", month).query(Long.class).optional().orElse(0L);
    DailyFinancialPolicy.Totals totals = financialTotals(channels, cards.rechargeNetCents());
    return new MonthlySummary(target, totals.turnoverCents(), totals.cashFlowCents(),
      cards.openCents() + cards.renewCents(), cards.openCents(), cards.openCount(), cards.renewCents(), cards.consumptionCents(),
      customerCount, extensions, channelNet(channels, "CASH"), channelNet(channels, "ALIPAY"),
      channelNet(channels, "DOUYIN"), channelNet(channels, "MEITUAN"), channelNet(channels, "FREE_ORDER"),
      channelNet(channels, "ENTERTAINMENT"), channelRefundTotal(channels), calls);
  }

  private DerivedMetrics derived(ReportValues values, MonthlySummary monthly, List<PaymentChannelSummary> channels) {
    return new DerivedMetrics(rate(values.dailySalesCents(), values.dailyTargetCents()),
      rate(monthly.salesAmountCents(), monthly.monthlyTargetCents()),
      channels.stream().mapToLong(PaymentChannelSummary::netCents).sum(),
      average(monthly.salesAmountCents(), (int) monthly.customerCount()),
      average(values.dailySalesCents(), values.dailyCustomerCount()),
      serviceClockRate(values.dailyCustomerCount(), values.dailyExtensionCount(), values.dailyCallClockCount()),
      serviceClockRate(monthly.customerCount(), monthly.extensionCount(), monthly.callClockCount()));
  }

  private BigDecimal rate(long value, long target) { return target <= 0 ? BigDecimal.ZERO.setScale(2) : BigDecimal.valueOf(value * 100.0 / target).setScale(2, RoundingMode.HALF_UP); }
  private BigDecimal average(long value, int count) { return count <= 0 ? BigDecimal.ZERO.setScale(2) : BigDecimal.valueOf(value).divide(BigDecimal.valueOf(count), 2, RoundingMode.HALF_UP); }
  BigDecimal serviceClockRate(long customers, long extensions, long calls) {
    return rate(extensions + calls, customers + extensions + calls);
  }

  private ReportValues autoValues(UUID storeId, LocalDate date) {
    return autoValues(storeId, date, paymentChannels(storeId, date, date));
  }

  private ReportValues autoValues(UUID storeId, LocalDate date, List<PaymentChannelSummary> channels) {
    Integer customerCount = dailyReports != null ? Math.toIntExact(dailyReports.daily(storeId, date).automaticCustomerCount()) : jdbc.sql("""
      select count(*)
      from sales_order sales
      join store reporting_store on reporting_store.id=sales.store_id
      where sales.store_id=:store and sales.status='SETTLED' and sales.paid_cents>0
        and coalesce(sales.refund_status, 'NONE') <> 'FULL'
        and (not exists(select 1 from sales_order_service_session linked_session where linked_session.order_id=sales.id)
          or exists(select 1 from sales_order_service_session linked_session join service_session linked_service on linked_service.id=linked_session.service_session_id
                    where linked_session.order_id=sales.id and linked_service.status<>'VOIDED'))
        and ((coalesce(sales.settled_at,sales.created_at) at time zone reporting_store.timezone)::date
          - case when (coalesce(sales.settled_at,sales.created_at) at time zone reporting_store.timezone)::time < reporting_store.business_day_cutoff then 1 else 0 end)=:date
      """).param("store", storeId).param("date", date).query(Integer.class).single();
    Integer calls = jdbc.sql("select count(*) from service_session where store_id=:store and clock_type in ('CALL','BOOKED_CALL') and status='COMPLETED' and counts_as_clock_snapshot=true and business_date=:date")
      .param("store", storeId).param("date", date).query(Integer.class).single();
    Integer extensions = jdbc.sql("select count(*) from service_session_extension extension join service_session session on session.id=extension.service_session_id where extension.store_id=:store and extension.counts_as_clock_snapshot=true and session.business_date=:date")
      .param("store", storeId).param("date", date).query(Integer.class).single();
    CardActivity cards = cardActivity(storeId, date, date);
    DailyFinancialPolicy.Totals totals = financialTotals(channels, cards.rechargeNetCents());
    return ReportValues.defaults(totals.turnoverCents(), totals.cashFlowCents(), cards.openCents(), cards.openCount().intValue(), cards.renewCents(),
      cards.cancellationCents(), cards.consumptionCents(), customerCount, extensions, calls,
      channelNet(channels, "CASH"), channelNet(channels, "ALIPAY"), channelNet(channels, "DOUYIN"),
      channelNet(channels, "MEITUAN"), channelNet(channels, "FREE_ORDER"), channelNet(channels, "ENTERTAINMENT"));
  }

  static int resolveCustomerCount(int automaticCount, Integer overrideCount) {
    if (automaticCount < 0 || (overrideCount != null && overrideCount < 0)) throw new IllegalArgumentException("Customer counts must be non-negative");
    return overrideCount == null ? automaticCount : overrideCount;
  }

  private ReportValues applyCustomerCountOverride(ReportValues automatic, CustomerCountOverrideRow override) {
    return override == null ? automatic : automatic.withDailyCustomerCount(resolveCustomerCount(automatic.dailyCustomerCount(), override.customerCount()));
  }

  private CustomerCountOverride customerCountOverride(CustomerCountOverrideRow row, int automaticCount) {
    if (row == null) return null;
    return new CustomerCountOverride(row.id(), row.businessDate(), row.customerCount(), automaticCount, row.reason(),
      row.updatedByUserId(), row.updatedByName(), row.updatedAt());
  }

  private java.util.Optional<CustomerCountOverrideRow> customerCountOverrideRow(UUID storeId, LocalDate date) {
    return jdbc.sql("""
      select correction.id,correction.business_date,correction.customer_count,correction.reason,correction.updated_by_user_id,
        correction.updated_at,coalesce(actor.display_name,'') updated_by_name
      from daily_customer_count_override correction
      left join app_user actor on actor.id=correction.updated_by_user_id
      where correction.store_id=:store and correction.business_date=:date
      """).param("store", storeId).param("date", date).query(CustomerCountOverrideRow.class).optional();
  }

  private ReportValues values(ReportInput input, ReportValues auto) {
    return new ReportValues(amount(input.dailyTargetCents()), auto.dailySalesCents(), auto.dailyCashFlowCents(),
      auto.dailyCardSaleCents(), auto.dailyCardOpenCents(), auto.dailyCardOpenCount(), auto.dailyCardRenewCents(), auto.dailyCardCancellationCents(),
      auto.dailyCardConsumptionCents(), auto.dailyCustomerCount(), auto.dailyExtensionCount(), auto.dailyCallClockCount(),
      auto.dailyCashCents(), auto.dailyAlipayCents(), auto.dailyDouyinCents(), auto.dailyMeituanCents(),
      auto.dailyFreeOrderCents(), auto.dailyEntertainmentCents(), count(input.managerCount(), 0), count(input.cashierCount(), 0),
      count(input.technicianCount(), 0), count(input.chefCount(), 0), count(input.cleanerCount(), 0), input.incidentNote(),
      input.extendedShiftNote(), count(input.nextDayRestCount(), 0), count(input.customerLossCount(), 0), input.nextDayImprovementNote());
  }

  ReportValues operationalValues(ReportValues saved, ReportValues live) {
    return new ReportValues(saved.dailyTargetCents(), live.dailySalesCents(), live.dailyCashFlowCents(), live.dailyCardSaleCents(),
      live.dailyCardOpenCents(), live.dailyCardOpenCount(), live.dailyCardRenewCents(), live.dailyCardCancellationCents(), live.dailyCardConsumptionCents(),
      live.dailyCustomerCount(), live.dailyExtensionCount(), live.dailyCallClockCount(), live.dailyCashCents(), live.dailyAlipayCents(),
      live.dailyDouyinCents(), live.dailyMeituanCents(), live.dailyFreeOrderCents(), live.dailyEntertainmentCents(), saved.managerCount(),
      saved.cashierCount(), saved.technicianCount(), saved.chefCount(), saved.cleanerCount(), saved.incidentNote(), saved.extendedShiftNote(),
      saved.nextDayRestCount(), saved.customerLossCount(), saved.nextDayImprovementNote());
  }

  private CardActivity cardActivity(UUID storeId, LocalDate from, LocalDate to) {
    if (dailyReports != null) {
      long openCents = 0, openCount = 0, renewCents = 0, consumption = 0, rechargeNet = 0;
      for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
        DailyReportService.DailyMetrics metrics = dailyReports.daily(storeId, date);
        openCents = Math.addExact(openCents, metrics.cardOpenCents());
        openCount = Math.addExact(openCount, metrics.cardOpenCount());
        renewCents = Math.addExact(renewCents, metrics.cardRenewCents());
        consumption = Math.addExact(consumption, metrics.consumptionAmountCents());
        rechargeNet = Math.addExact(rechargeNet, metrics.rechargeNetCents());
      }
      Long cancellation = jdbc.sql("select coalesce(sum(amount_cents),0) from member_recharge_refund where store_id=:store and status='COMPLETED' and business_date between :from and :to")
        .param("store", storeId).param("from", from).param("to", to).query(Long.class).single();
      return new CardActivity(openCents, openCount, renewCents, cancellation, consumption, rechargeNet);
    }
    CardActivityRaw raw = jdbc.sql("""
      with ranked_recharges as (
        select wt.store_id,wt.member_id,wt.business_date,coalesce(wt.corrected_amount_cents,wt.amount_cents) amount_cents,
          row_number() over(partition by wt.store_id,wt.member_id order by wt.created_at,wt.id) recharge_number
        from wallet_transaction wt
        where wt.transaction_type='RECHARGE'
      )
      select
        coalesce((select sum(amount_cents) from ranked_recharges where store_id=:store and business_date between :from and :to and recharge_number=1),0) open_cents,
        coalesce((select count(*) from ranked_recharges where store_id=:store and business_date between :from and :to and recharge_number=1),0) open_count,
        coalesce((select sum(amount_cents) from ranked_recharges where store_id=:store and business_date between :from and :to and recharge_number>1),0) renew_cents,
        coalesce((select sum(amount_cents) from member_recharge_refund where store_id=:store and status='COMPLETED' and business_date between :from and :to),0) cancellation_cents,
        coalesce((select sum(-amount_cents) from wallet_transaction where store_id=:store and transaction_type='CONSUMPTION' and business_date between :from and :to),0) consumption_debit_cents,
        coalesce((select sum(amount_cents) from wallet_transaction where store_id=:store and transaction_type='REFUND' and source in ('ORDER_REFUND','ORDER_CORRECTION') and business_date between :from and :to),0) consumption_refund_cents,
        coalesce((select sum(coalesce(corrected_amount_cents,amount_cents)) from wallet_transaction where store_id=:store and transaction_type='RECHARGE' and business_date between :from and :to),0)
          + coalesce((select sum(amount_cents) from wallet_transaction where store_id=:store and transaction_type='ADJUSTMENT' and source='RECHARGE_REFUND' and business_date between :from and :to),0) recharge_net_cents
      """).param("store", storeId).param("from", from).param("to", to).query(CardActivityRaw.class).single();
    return new CardActivity(raw.openCents(), raw.openCount(), raw.renewCents(), raw.cancellationCents(),
      cardConsumptionCents(raw.consumptionDebitCents(), raw.consumptionRefundCents()), raw.rechargeNetCents());
  }

  static long cardConsumptionCents(long consumptionDebitCents, long eligibleRefundCents) {
    return DailyReportService.cardConsumptionCents(consumptionDebitCents, eligibleRefundCents);
  }

  private List<PaymentChannelSummary> paymentChannels(UUID storeId, LocalDate from, LocalDate to) {
    if (dailyReports != null) {
      Map<String, PaymentChannelSummary> combined = new LinkedHashMap<>();
      for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
        for (DailyReportService.ChannelMetrics channel : dailyReports.channels(storeId, date)) {
          PaymentChannelSummary old = combined.get(channel.code());
          if (old == null) combined.put(channel.code(), new PaymentChannelSummary(channel.code(), channel.name(), channel.methodKind(), channel.active(), channel.cashCounted(), channel.salesCents(), channel.refundCents(), channel.rechargeCents(), channel.rechargeRefundCents()));
          else combined.put(channel.code(), new PaymentChannelSummary(old.code(), old.name(), old.methodKind(), old.active(), old.cashCounted(), old.salesCents() + channel.salesCents(), old.refundCents() + channel.refundCents(), old.rechargeCents() + channel.rechargeCents(), old.rechargeRefundCents() + channel.rechargeRefundCents()));
        }
      }
      return combined.values().stream().toList();
    }
    Map<String, ChannelDefinition> definitions = new LinkedHashMap<>();
    for (PaymentMethodRow method : jdbc.sql("select code,name,method_kind,active,cash_counted,sort_order from store_payment_method where store_id=:store order by sort_order,code")
      .param("store", storeId).query(PaymentMethodRow.class).list()) {
      definitions.put(method.code(), new ChannelDefinition(method.code(), method.name(), method.methodKind(), method.active(), method.cashCounted(), method.sortOrder()));
    }
    List<NamedChannelRow> salesRows = jdbc.sql("""
      select payment.payment_method code,max(payment.payment_method_name_snapshot) name,coalesce(sum(payment.amount_cents),0) amount_cents
      from payment_record payment
      join sales_order sales on sales.id=payment.order_id
      join store reporting_store on reporting_store.id=sales.store_id
      where payment.store_id=:store and sales.status='SETTLED'
        and ((coalesce(sales.settled_at,sales.created_at) at time zone reporting_store.timezone)::date
          - case when (coalesce(sales.settled_at,sales.created_at) at time zone reporting_store.timezone)::time < reporting_store.business_day_cutoff then 1 else 0 end)
          between :from and :to
      group by payment.payment_method
      """).param("store", storeId).param("from", from).param("to", to).query(NamedChannelRow.class).list();
    List<NamedChannelRow> refundRows = jdbc.sql("""
      select refund_payment.payment_method code,max(original_payment.payment_method_name_snapshot) name,coalesce(sum(refund_payment.amount_cents),0) amount_cents
      from refund_payment_record refund_payment
      join sales_refund refund on refund.id=refund_payment.refund_id
      join payment_record original_payment on original_payment.id=refund_payment.original_payment_id
      where refund.store_id=:store and refund.status='COMPLETED' and refund_payment.status='COMPLETED'
        and refund.business_date between :from and :to
      group by refund_payment.payment_method
      """).param("store", storeId).param("from", from).param("to", to).query(NamedChannelRow.class).list();
    List<NamedChannelRow> rechargeRows = jdbc.sql("""
      select coalesce(payment.payment_method,'UNSPECIFIED') code,
             coalesce(max(payment.payment_method_name_snapshot),case when payment.payment_method is null then '未指定' else payment.payment_method end) name,
             coalesce(sum(coalesce(payment.corrected_amount_cents,payment.amount_cents)),0) amount_cents
      from wallet_transaction payment
      where payment.store_id=:store and payment.transaction_type='RECHARGE'
        and payment.business_date between :from and :to
      group by payment.payment_method
      """).param("store", storeId).param("from", from).param("to", to).query(NamedChannelRow.class).list();
    List<NamedChannelRow> rechargeRefundRows = jdbc.sql("""
      select coalesce(payment.payment_method,'UNSPECIFIED') code,
             coalesce(max(payment.payment_method_name_snapshot),case when payment.payment_method is null then '未指定' else payment.payment_method end) name,
             coalesce(sum(-payment.amount_cents),0) amount_cents
      from wallet_transaction payment
      where payment.store_id=:store and payment.transaction_type='ADJUSTMENT' and payment.source='RECHARGE_REFUND'
        and payment.business_date between :from and :to
      group by payment.payment_method
      """).param("store", storeId).param("from", from).param("to", to).query(NamedChannelRow.class).list();
    Map<String, Long> sales = channelAmounts(definitions, salesRows);
    Map<String, Long> refunds = channelAmounts(definitions, refundRows);
    Map<String, Long> recharges = channelAmounts(definitions, rechargeRows);
    Map<String, Long> rechargeRefunds = channelAmounts(definitions, rechargeRefundRows);
    return definitions.values().stream()
      .sorted(Comparator.comparingInt(ChannelDefinition::sortOrder).thenComparing(ChannelDefinition::code))
      .map(method -> new PaymentChannelSummary(method.code(), method.name(), method.methodKind(), method.active(), method.cashCounted(),
        sales.getOrDefault(method.code(), 0L), refunds.getOrDefault(method.code(), 0L),
        recharges.getOrDefault(method.code(), 0L), rechargeRefunds.getOrDefault(method.code(), 0L)))
      .toList();
  }

  static long externalOrderCashFlow(List<PaymentChannelSummary> channels) {
    return channels.stream()
      .filter(channel -> !"MEMBER_BALANCE".equalsIgnoreCase(channel.methodKind()))
      .mapToLong(PaymentChannelSummary::orderNetCents)
      .sum();
  }

  static long cashFlowCents(long externalOrderCents, long rechargeNetCents) {
    return Math.addExact(externalOrderCents, rechargeNetCents);
  }

  private DailyFinancialPolicy.Totals financialTotals(List<PaymentChannelSummary> channels, long rechargeNetCents) {
    long settledOrderCents = channels.stream().mapToLong(PaymentChannelSummary::salesCents).reduce(0L, Math::addExact);
    long completedOrderRefundCents = channelRefundTotal(channels);
    List<DailyFinancialPolicy.ChannelMovement> movements = channels.stream()
      .map(channel -> new DailyFinancialPolicy.ChannelMovement(channel.methodKind(), channel.salesCents(), channel.refundCents()))
      .toList();
    return DailyFinancialPolicy.calculate(settledOrderCents, completedOrderRefundCents, movements, rechargeNetCents);
  }

  private long channelRefundTotal(List<PaymentChannelSummary> channels) {
    return channels.stream().mapToLong(PaymentChannelSummary::refundCents).reduce(0L, Math::addExact);
  }

  private Map<String, Long> channelAmounts(Map<String, ChannelDefinition> definitions, List<NamedChannelRow> rows) {
    Map<String, Long> amounts = new HashMap<>();
    for (NamedChannelRow row : rows) {
      definitions.putIfAbsent(row.code(), new ChannelDefinition(row.code(), row.name(),
        "MEMBER_BALANCE".equalsIgnoreCase(row.code()) ? "MEMBER_BALANCE" : "EXTERNAL", false, false, Short.MAX_VALUE));
      amounts.merge(row.code(), row.amountCents(), Long::sum);
    }
    return amounts;
  }

  private long amount(Long value) { if (value == null) return 0; if (value < 0) throw badRequest("Amount values must be non-negative"); return value; }
  private int count(Integer value, int fallback) { if (value == null) return fallback; if (value < 0) throw badRequest("Count values must be non-negative"); return value; }
  private long channelNet(List<PaymentChannelSummary> rows, String code) { return rows.stream().filter(row -> code.equalsIgnoreCase(row.code())).mapToLong(PaymentChannelSummary::netCents).sum(); }

  private boolean exists(UUID storeId, LocalDate date) { return jdbc.sql("select exists(select 1 from daily_operating_report where store_id=:store and business_date=:date)").param("store", storeId).param("date", date).query(Boolean.class).single(); }
  private java.util.Optional<DailyReportRow> load(UUID id, UUID storeId) { return jdbc.sql(reportSql() + " where r.id=:id and r.store_id=:store").param("id", id).param("store", storeId).query(DailyReportRow.class).optional(); }
  private java.util.Optional<DailyReportRow> loadByDate(UUID storeId, LocalDate date) { return jdbc.sql(reportSql() + " where r.store_id=:store and r.business_date=:date").param("store", storeId).param("date", date).query(DailyReportRow.class).optional(); }
  private String reportSql() { return "select r.id,r.business_date,r.status,r.daily_target_cents,r.daily_sales_amount_cents,r.daily_cash_flow_cents,r.daily_card_sale_cents,r.daily_card_open_cents,r.daily_card_renew_cents,r.daily_card_cancellation_cents,r.daily_card_consumption_cents,r.daily_customer_count,r.daily_extension_count,r.daily_call_clock_count,r.daily_cash_cents,r.daily_alipay_cents,r.daily_douyin_cents,r.daily_meituan_cents,r.daily_free_order_cents,r.daily_entertainment_cents,r.manager_count,r.cashier_count,r.technician_count,r.chef_count,r.cleaner_count,r.incident_note,r.extended_shift_note,r.next_day_rest_count,r.customer_loss_count,r.next_day_improvement_note,r.created_by_user_id,r.updated_by_user_id,r.published_by_user_id,r.created_at,r.last_saved_at,r.published_at,r.updated_at,r.version,coalesce(created_user.display_name,'') created_by_name,coalesce(updated_user.display_name,'') updated_by_name,coalesce(published_user.display_name,'') published_by_name from daily_operating_report r left join app_user created_user on created_user.id=r.created_by_user_id left join app_user updated_user on updated_user.id=r.updated_by_user_id left join app_user published_user on published_user.id=r.published_by_user_id"; }

  private void saveRevision(UUID reportId, UUID storeId, UUID actor, String action, DailyReportRow before, ReportValues after) {
    int next = jdbc.sql("select coalesce(max(revision_no),0)+1 from daily_operating_report_revision where report_id=:report").param("report", reportId).query(Integer.class).single();
    try {
      String beforeJson = before == null ? null : objectMapper.writeValueAsString(before.values());
      String afterJson = objectMapper.writeValueAsString(after);
      jdbc.sql("insert into daily_operating_report_revision(id,report_id,tenant_id,store_id,revision_no,action,before_data,after_data,actor_user_id) values(:id,:report,:tenant,:store,:revision,:action,cast(:before as jsonb),cast(:after as jsonb),:actor)")
        .param("id", UUID.randomUUID()).param("report", reportId).param("tenant", TENANT_ID).param("store", storeId).param("revision", next).param("action", action).param("before", beforeJson).param("after", afterJson).param("actor", actor).update();
    } catch (JsonProcessingException exception) { throw new IllegalStateException("Unable to serialize daily report revision", exception); }
  }

  private DailyReportSettings settings(UUID storeId, LocalDate month) {
    Long target = jdbc.sql("select monthly_target_cents from daily_report_month_target where store_id=:store and target_month=:month")
      .param("store", storeId).param("month", month).query(Long.class).optional().orElse(0L);
    Map<String, FieldConfigRow> overrides = new HashMap<>();
    for (FieldConfigRow row : jdbc.sql("select field_code,field_label,section_code,visible,required,sort_order from daily_report_field_config where store_id=:store")
      .param("store", storeId).query(FieldConfigRow.class).list()) overrides.put(row.fieldCode(), row);
    List<DailyReportField> fields = DEFAULT_FIELDS.stream().map(base -> {
      FieldConfigRow row = overrides.get(base.fieldCode());
      return row == null ? new DailyReportField(base.fieldCode(), base.fieldLabel(), base.sectionCode(), true, false, base.sortOrder())
        : new DailyReportField(base.fieldCode(), configuredFieldLabel(base, row), base.sectionCode(), row.visible(), row.required(), row.sortOrder());
    }).sorted(java.util.Comparator.comparing(DailyReportField::sectionCode).thenComparing(DailyReportField::sortOrder).thenComparing(DailyReportField::fieldCode)).toList();
    return new DailyReportSettings(month, target, fields);
  }

  private Map<String, DefaultField> defaultFieldsByCode() {
    Map<String, DefaultField> result = new HashMap<>();
    for (DefaultField field : DEFAULT_FIELDS) result.put(field.fieldCode(), field);
    return result;
  }

  private static DefaultField field(String code, String section, String label, int sort) { return new DefaultField(code, section, label, sort); }

  static String configuredFieldLabel(DefaultField base, FieldConfigRow configured) {
    if ("cashFlowCents".equals(base.fieldCode()) && "累计净实收".equals(configured.fieldLabel())) return base.fieldLabel();
    if ("dailyCashFlowCents".equals(base.fieldCode()) && "当日净实收".equals(configured.fieldLabel())) return base.fieldLabel();
    return configured.fieldLabel();
  }

  private LocalDate requireDate(LocalDate date, UUID storeId) { return date == null ? businessClock.currentBusinessDate(storeId) : date; }
  private LocalDate parseDate(String value, UUID storeId) { if (value == null || value.isBlank()) return businessClock.currentBusinessDate(storeId); try { return LocalDate.parse(value); } catch (RuntimeException exception) { throw badRequest("Date must use YYYY-MM-DD"); } }
  private LocalDate parseMonth(String value, UUID storeId) { if (value == null || value.isBlank()) return businessClock.currentBusinessDate(storeId).withDayOfMonth(1); try { return YearMonth.parse(value).atDay(1); } catch (RuntimeException exception) { throw badRequest("Month must use YYYY-MM"); } }
  private ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }
  private ResponseStatusException notFound(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }

  public record ReportInput(LocalDate businessDate, Long dailyTargetCents, Long dailySalesAmountCents, Long dailyCashFlowCents, Long dailyCardSaleCents, Long dailyCardOpenCents, Long dailyCardRenewCents, Long dailyCardCancellationCents, Long dailyCardConsumptionCents, Integer dailyCustomerCount, Integer dailyExtensionCount, Integer dailyCallClockCount, Long dailyCashCents, Long dailyAlipayCents, Long dailyDouyinCents, Long dailyMeituanCents, Long dailyFreeOrderCents, Long dailyEntertainmentCents, Integer managerCount, Integer cashierCount, Integer technicianCount, Integer chefCount, Integer cleanerCount, @Size(max=4000) String incidentNote, @Size(max=4000) String extendedShiftNote, Integer nextDayRestCount, Integer customerLossCount, @Size(max=4000) String nextDayImprovementNote, Long version) {}
  public record CustomerCountOverrideInput(LocalDate businessDate, Integer customerCount, @Size(max=500) String reason) {}
  public record DailyReportSettingsInput(LocalDate targetMonth, Long monthlyTargetCents, List<DailyReportFieldInput> fields) {}
  public record DailyReportFieldInput(String fieldCode, String fieldLabel, Boolean visible, Boolean required, Integer sortOrder) {}
  public record DailyReportSettings(LocalDate targetMonth, Long monthlyTargetCents, List<DailyReportField> fields) {}
  public record DailyReportField(String fieldCode, String fieldLabel, String sectionCode, Boolean visible, Boolean required, Integer sortOrder) {}
  public record ReportView(DailyReportRow report, MonthlySummary monthly, DerivedMetrics derived, ReportValues currentValues,
                           DailyReportAccess access, long refundAmountCents, List<PaymentChannelSummary> paymentChannels,
                           List<PaymentChannelSummary> monthlyPaymentChannels, CustomerCountOverride customerCountOverride,
                           DailyReportService.DailyMetrics unifiedMetrics) {}
  public record CustomerCountOverride(UUID id, LocalDate businessDate, int customerCount, int automaticCount, String reason,
                                      UUID updatedByUserId, String updatedByName, OffsetDateTime updatedAt) {}
  public record DailyReportAccess(boolean canEdit, boolean canPublish, boolean canConfigure) {}
  public record StoreReportView(UUID storeId, String storeCode, String storeName, ReportView report) {}
  public record MonthlySummary(long monthlyTargetCents, long salesAmountCents, long cashFlowCents, long cardSaleCents, long cardOpenCents, long cardOpenCount, long cardRenewCents, long cardConsumptionCents, long customerCount, long extensionCount, long cashCents, long alipayCents, long douyinCents, long meituanCents, long freeOrderCents, long entertainmentCents, long refundAmountCents, long callClockCount) {}
  public record PaymentChannelSummary(String code, String name, String methodKind, boolean active, boolean cashCounted,
                                      long salesCents, long refundCents, long rechargeCents, long rechargeRefundCents) {
    public PaymentChannelSummary(String code, String name, String methodKind, boolean active, boolean cashCounted,
                                 long salesCents, long refundCents, long netCents) {
      this(code, name, methodKind, active, cashCounted, salesCents, refundCents, 0, 0);
    }
    @JsonProperty("orderNetCents")
    public long orderNetCents() { return salesCents - refundCents; }
    @JsonProperty("rechargeNetCents")
    public long rechargeNetCents() { return rechargeCents - rechargeRefundCents; }
    @JsonProperty("netCents")
    public long netCents() { return orderNetCents() + rechargeNetCents(); }
  }
  public record DerivedMetrics(BigDecimal dailyTargetCompletionRate, BigDecimal monthlyTargetCompletionRate,
                               long paymentChannelTotalCents, BigDecimal averageCustomerSpendCents,
                               BigDecimal dailyAverageCustomerSpendCents, BigDecimal dailyServiceClockRate,
                               BigDecimal monthlyServiceClockRate) {}
  public record RevisionView(Integer revisionNo, String action, String afterData, UUID actorUserId, OffsetDateTime createdAt, String actorName) {}
  public record DailyReportRow(UUID id, LocalDate businessDate, String status, Long dailyTargetCents, Long dailySalesAmountCents, Long dailyCashFlowCents, Long dailyCardSaleCents, Long dailyCardOpenCents, Long dailyCardRenewCents, Long dailyCardCancellationCents, Long dailyCardConsumptionCents, Integer dailyCustomerCount, Integer dailyExtensionCount, Integer dailyCallClockCount, Long dailyCashCents, Long dailyAlipayCents, Long dailyDouyinCents, Long dailyMeituanCents, Long dailyFreeOrderCents, Long dailyEntertainmentCents, Integer managerCount, Integer cashierCount, Integer technicianCount, Integer chefCount, Integer cleanerCount, String incidentNote, String extendedShiftNote, Integer nextDayRestCount, Integer customerLossCount, String nextDayImprovementNote, UUID createdByUserId, UUID updatedByUserId, UUID publishedByUserId, OffsetDateTime createdAt, OffsetDateTime lastSavedAt, OffsetDateTime publishedAt, OffsetDateTime updatedAt, Long version, String createdByName, String updatedByName, String publishedByName) {
    ReportValues values() { return new ReportValues(dailyTargetCents, dailySalesAmountCents, dailyCashFlowCents, dailyCardSaleCents, dailyCardOpenCents, 0, dailyCardRenewCents, dailyCardCancellationCents, dailyCardConsumptionCents, dailyCustomerCount, dailyExtensionCount, dailyCallClockCount, dailyCashCents, dailyAlipayCents, dailyDouyinCents, dailyMeituanCents, dailyFreeOrderCents, dailyEntertainmentCents, managerCount, cashierCount, technicianCount, chefCount, cleanerCount, incidentNote, extendedShiftNote, nextDayRestCount, customerLossCount, nextDayImprovementNote); }
  }
  public record ReportValues(long dailyTargetCents, long dailySalesCents, long dailyCashFlowCents, long dailyCardSaleCents, long dailyCardOpenCents, int dailyCardOpenCount, long dailyCardRenewCents, long dailyCardCancellationCents, long dailyCardConsumptionCents, int dailyCustomerCount, int dailyExtensionCount, int dailyCallClockCount, long dailyCashCents, long dailyAlipayCents, long dailyDouyinCents, long dailyMeituanCents, long dailyFreeOrderCents, long dailyEntertainmentCents, int managerCount, int cashierCount, int technicianCount, int chefCount, int cleanerCount, String incidentNote, String extendedShiftNote, int nextDayRestCount, int customerLossCount, String nextDayImprovementNote) {
    public ReportValues(long dailyTargetCents, long dailySalesCents, long dailyCashFlowCents, long dailyCardSaleCents, long dailyCardOpenCents, long dailyCardRenewCents, long dailyCardCancellationCents, long dailyCardConsumptionCents, int dailyCustomerCount, int dailyExtensionCount, int dailyCallClockCount, long dailyCashCents, long dailyAlipayCents, long dailyDouyinCents, long dailyMeituanCents, long dailyFreeOrderCents, long dailyEntertainmentCents, int managerCount, int cashierCount, int technicianCount, int chefCount, int cleanerCount, String incidentNote, String extendedShiftNote, int nextDayRestCount, int customerLossCount, String nextDayImprovementNote) {
      this(dailyTargetCents, dailySalesCents, dailyCashFlowCents, dailyCardSaleCents, dailyCardOpenCents, 0, dailyCardRenewCents, dailyCardCancellationCents, dailyCardConsumptionCents, dailyCustomerCount, dailyExtensionCount, dailyCallClockCount, dailyCashCents, dailyAlipayCents, dailyDouyinCents, dailyMeituanCents, dailyFreeOrderCents, dailyEntertainmentCents, managerCount, cashierCount, technicianCount, chefCount, cleanerCount, incidentNote, extendedShiftNote, nextDayRestCount, customerLossCount, nextDayImprovementNote);
    }
    ReportValues withDailyCustomerCount(int customerCount) {
      return new ReportValues(dailyTargetCents, dailySalesCents, dailyCashFlowCents, dailyCardSaleCents, dailyCardOpenCents, dailyCardOpenCount,
        dailyCardRenewCents, dailyCardCancellationCents, dailyCardConsumptionCents, customerCount, dailyExtensionCount, dailyCallClockCount,
        dailyCashCents, dailyAlipayCents, dailyDouyinCents, dailyMeituanCents, dailyFreeOrderCents, dailyEntertainmentCents,
        managerCount, cashierCount, technicianCount, chefCount, cleanerCount, incidentNote, extendedShiftNote, nextDayRestCount,
        customerLossCount, nextDayImprovementNote);
    }
    static ReportValues defaults(long sales, long cashFlow, long cardOpen, int cardOpenCount, long cardRenew, long cardCancellation,
                                 long cardConsumption, int customers, int extensions, int calls, long cash, long alipay,
                                 long douyin, long meituan, long freeOrder, long entertainment) {
      return new ReportValues(0,sales,cashFlow,cardOpen+cardRenew,cardOpen,cardOpenCount,cardRenew,cardCancellation,cardConsumption,
        customers,extensions,calls,cash,alipay,douyin,meituan,freeOrder,entertainment,0,0,0,0,0,null,null,0,0,null);
    }
    Map<String,Object> params() { Map<String,Object> p=new HashMap<>(); p.put("dailyTarget",dailyTargetCents);p.put("dailySales",Math.max(0,dailySalesCents));p.put("dailyCashFlow",Math.max(0,dailyCashFlowCents));p.put("dailyCardSale",dailyCardSaleCents);p.put("dailyCardOpen",dailyCardOpenCents);p.put("dailyCardRenew",dailyCardRenewCents);p.put("dailyCardCancellation",dailyCardCancellationCents);p.put("dailyCardConsumption",dailyCardConsumptionCents);p.put("dailyCustomerCount",dailyCustomerCount);p.put("dailyExtensionCount",dailyExtensionCount);p.put("dailyCallClockCount",dailyCallClockCount);p.put("dailyCash",Math.max(0,dailyCashCents));p.put("dailyAlipay",Math.max(0,dailyAlipayCents));p.put("dailyDouyin",Math.max(0,dailyDouyinCents));p.put("dailyMeituan",Math.max(0,dailyMeituanCents));p.put("dailyFreeOrder",Math.max(0,dailyFreeOrderCents));p.put("dailyEntertainment",Math.max(0,dailyEntertainmentCents));p.put("managerCount",managerCount);p.put("cashierCount",cashierCount);p.put("technicianCount",technicianCount);p.put("chefCount",chefCount);p.put("cleanerCount",cleanerCount);p.put("incidentNote",incidentNote);p.put("extendedShiftNote",extendedShiftNote);p.put("nextDayRestCount",nextDayRestCount);p.put("customerLossCount",customerLossCount);p.put("nextDayImprovement",nextDayImprovementNote);return p; }
  }
  record CardActivityRaw(Long openCents, Long openCount, Long renewCents, Long cancellationCents, Long consumptionDebitCents, Long consumptionRefundCents, Long rechargeNetCents) {}
  record CardActivity(Long openCents, Long openCount, Long renewCents, Long cancellationCents, Long consumptionCents, Long rechargeNetCents) {}
  record CustomerCountOverrideRow(UUID id, LocalDate businessDate, Integer customerCount, String reason, UUID updatedByUserId,
                                  OffsetDateTime updatedAt, String updatedByName) {}
  record PaymentMethodRow(String code, String name, String methodKind, Boolean active, Boolean cashCounted, Short sortOrder) {}
  record NamedChannelRow(String code, String name, Long amountCents) {}
  record ChannelDefinition(String code, String name, String methodKind, boolean active, boolean cashCounted, short sortOrder) {}
  record FieldConfigRow(String fieldCode, String fieldLabel, String sectionCode, Boolean visible, Boolean required, Integer sortOrder) {}
  record DefaultField(String fieldCode, String sectionCode, String fieldLabel, Integer sortOrder) {}
  record ExportItem(String label, String value) {}
}
