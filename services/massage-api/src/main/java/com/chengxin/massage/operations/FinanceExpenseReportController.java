package com.chengxin.massage.operations;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.VerticalAlignment;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import com.chengxin.massage.admin.AdminSessionService;

@RestController
@RequestMapping("/api/v1/finance/expense-reports")
@CrossOrigin(origins = "*")
public class FinanceExpenseReportController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
  private final JdbcClient jdbc;
  private final AdminSessionService sessions;
  private final TransactionTemplate snapshot;

  FinanceExpenseReportController(JdbcClient jdbc, AdminSessionService sessions, PlatformTransactionManager transactions) {
    this.jdbc = jdbc;
    this.sessions = sessions;
    this.snapshot = new TransactionTemplate(transactions);
    this.snapshot.setReadOnly(true);
    this.snapshot.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
  }

  @GetMapping("/summary")
  FinanceExpenseSummary summary(
      @RequestParam(required = false) LocalDate from,
      @RequestParam(required = false) LocalDate to,
      @RequestParam(required = false) UUID storeId,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    requireFinanceAccess(authorization);
    DateRange range = dateRange(from, to);
    return snapshot.execute(status -> loadSummary(range, storeId));
  }

  @GetMapping("/export")
  ResponseEntity<byte[]> export(
      @RequestParam(required = false) LocalDate from,
      @RequestParam(required = false) LocalDate to,
      @RequestParam(required = false) UUID storeId,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    requireFinanceAccess(authorization);
    DateRange range = dateRange(from, to);
    return snapshot.execute(status -> exportSnapshot(range, storeId));
  }

  private ResponseEntity<byte[]> exportSnapshot(DateRange range, UUID storeId) {
    FinanceExpenseSummary summary = loadSummary(range, storeId);
    List<ExpenseExportRow> details = loadDetails(range, storeId);
    String scopeName = storeId == null ? "全部门店" : storeName(storeId);
    String filename = "%s_财务报销统计_%s_至_%s.xlsx".formatted(scopeName, range.from(), range.to());
    return ResponseEntity.ok()
      .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
      .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + URLEncoder.encode(filename, StandardCharsets.UTF_8).replace("+", "%20"))
      .body(workbook(scopeName, summary, details));
  }

  private FinanceExpenseSummary loadSummary(DateRange range, UUID storeId) {
    String where = where(storeId);
    JdbcClient.StatementSpec totalsStatement = parameters(jdbc.sql("""
      select count(*)::bigint claim_count,
        coalesce(sum(c.amount_cents) filter(where c.status in ('SUBMITTED','APPROVED','PAID')),0)::bigint total_amount_cents,
        count(*) filter (where c.status='SUBMITTED')::bigint pending_count,
        coalesce(sum(c.amount_cents) filter (where c.status='SUBMITTED'),0)::bigint pending_amount_cents,
        count(*) filter (where c.status='APPROVED')::bigint approved_count,
        coalesce(sum(c.amount_cents) filter (where c.status='APPROVED'),0)::bigint approved_amount_cents,
        count(*) filter (where c.status='PAID')::bigint paid_count,
        coalesce(sum(c.amount_cents) filter (where c.status='PAID'),0)::bigint paid_amount_cents
      from expense_claim c
      """ + where), range, storeId);
    FinanceTotals totals = totalsStatement.query(FinanceTotals.class).single();

    List<StatusSummary> statuses = parameters(jdbc.sql("""
      select c.status,count(*)::bigint claim_count,coalesce(sum(c.amount_cents),0)::bigint amount_cents
      from expense_claim c
      """ + where + " group by c.status order by c.status"), range, storeId)
      .query(StatusSummary.class).list();

    List<StoreSummary> stores = parameters(jdbc.sql("""
      select c.store_id,s.name store_name,count(*)::bigint claim_count,
        coalesce(sum(c.amount_cents) filter(where c.status in ('SUBMITTED','APPROVED','PAID')),0)::bigint amount_cents,
        coalesce(sum(c.amount_cents) filter (where c.status='PAID'),0)::bigint paid_amount_cents
      from expense_claim c join store s on s.id=c.store_id
      """ + where + " group by c.store_id,s.name order by amount_cents desc,s.name"), range, storeId)
      .query(StoreSummary.class).list();

    List<CategorySummary> categories = parameters(jdbc.sql("""
      select c.expense_category_id,coalesce(parent.name || ' / ','') || category.name category_name,
        count(*)::bigint claim_count,coalesce(sum(c.amount_cents) filter(where c.status in ('SUBMITTED','APPROVED','PAID')),0)::bigint amount_cents,
        coalesce(sum(c.amount_cents) filter (where c.status='PAID'),0)::bigint paid_amount_cents
      from expense_claim c
      join expense_category category on category.id=c.expense_category_id
      left join expense_category parent on parent.id=category.parent_id
      """ + where + " group by c.expense_category_id,parent.name,category.name order by amount_cents desc,category_name"), range, storeId)
      .query(CategorySummary.class).list();
    return new FinanceExpenseSummary(range.from(), range.to(), totals, statuses, stores, categories);
  }

  private List<ExpenseExportRow> loadDetails(DateRange range, UUID storeId) {
    String where = where(storeId);
    return parameters(jdbc.sql("""
      select c.claim_no,s.name store_name,coalesce(parent.name || ' / ','') || category.name category_name,
        c.expense_date,c.amount_cents,c.status,applicant.display_name applicant_name,c.payee_name,c.receipt_type,
        c.description,c.submitted_at,c.reviewed_at,coalesce(reviewer.display_name,'') reviewer_name,
        payment.payment_method,payment.payment_date,payment.payment_reference
      from expense_claim c
      join store s on s.id=c.store_id
      join app_user applicant on applicant.id=c.applicant_user_id
      join expense_category category on category.id=c.expense_category_id
      left join expense_category parent on parent.id=category.parent_id
      left join app_user reviewer on reviewer.id=c.reviewed_by_user_id
      left join expense_payment payment on payment.claim_id=c.id
      """ + where + " order by c.expense_date desc,c.claim_no"), range, storeId)
      .query(ExpenseExportRow.class).list();
  }

  private String where(UUID storeId) {
    return " where c.tenant_id=:tenant and coalesce(c.submitted_at,c.created_at)>=:from and coalesce(c.submitted_at,c.created_at)<:until" +
      (storeId == null ? "" : " and c.store_id=:store");
  }

  private JdbcClient.StatementSpec parameters(JdbcClient.StatementSpec statement, DateRange range, UUID storeId) {
    JdbcClient.StatementSpec result = statement.param("tenant", TENANT_ID).param("from", range.from().atStartOfDay(BUSINESS_ZONE).toOffsetDateTime())
      .param("until", range.to().plusDays(1).atStartOfDay(BUSINESS_ZONE).toOffsetDateTime());
    return storeId == null ? result : result.param("store", storeId);
  }

  private DateRange dateRange(LocalDate from, LocalDate to) {
    LocalDate today = LocalDate.now(BUSINESS_ZONE);
    LocalDate start = from == null ? today.minusDays(29) : from;
    LocalDate end = to == null ? today : to;
    if (end.isBefore(start)) throw bad("The end date must not be before the start date");
    return new DateRange(start, end);
  }

  private String storeName(UUID storeId) {
    return jdbc.sql("select name from store where id=:id and tenant_id=:tenant")
      .param("id", storeId).param("tenant", TENANT_ID).query(String.class).optional()
      .orElseThrow(() -> new ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, "Store not found"));
  }

  private byte[] workbook(String scopeName, FinanceExpenseSummary summary, List<ExpenseExportRow> details) {
    try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      CellStyle title = style(workbook, true, HorizontalAlignment.CENTER);
      CellStyle heading = style(workbook, true, HorizontalAlignment.LEFT);
      CellStyle text = style(workbook, false, HorizontalAlignment.LEFT);
      CellStyle integer = style(workbook, false, HorizontalAlignment.RIGHT);
      CellStyle money = style(workbook, false, HorizontalAlignment.RIGHT);
      money.setDataFormat(workbook.createDataFormat().getFormat("#,##0.00"));

      Sheet summarySheet = workbook.createSheet("报销汇总");
      for (int column = 0; column < 5; column++) summarySheet.setColumnWidth(column, (column == 1 ? 28 : 20) * 256);
      int rowIndex = 0;
      Row titleRow = summarySheet.createRow(rowIndex++);
      cell(titleRow, 0, scopeName + " 财务报销统计", title);
      summarySheet.addMergedRegion(new CellRangeAddress(0, 0, 0, 4));
      Row rangeRow = summarySheet.createRow(rowIndex++);
      cell(rangeRow, 0, "统计日期", heading); cell(rangeRow, 1, summary.from() + " 至 " + summary.to(), text);
      summarySheet.addMergedRegion(new CellRangeAddress(1, 1, 1, 4));
      rowIndex = summaryMetrics(summarySheet, rowIndex, summary.totals(), heading, integer, money);
      rowIndex = summaryTable(summarySheet, rowIndex + 1, "状态汇总", List.of("状态", "单据数", "金额（元）"),
        summary.statuses().stream().map(item -> List.of(statusName(item.status()), item.claimCount(), cents(item.amountCents()))).toList(), heading, text, money);
      rowIndex = summaryTable(summarySheet, rowIndex + 1, "门店汇总", List.of("门店", "单据数", "申请金额（元）", "已付金额（元）"),
        summary.stores().stream().map(item -> List.of(item.storeName(), item.claimCount(), cents(item.amountCents()), cents(item.paidAmountCents()))).toList(), heading, text, money);
      summaryTable(summarySheet, rowIndex + 1, "费用分类汇总", List.of("费用分类", "单据数", "申请金额（元）", "已付金额（元）"),
        summary.categories().stream().map(item -> List.of(item.categoryName(), item.claimCount(), cents(item.amountCents()), cents(item.paidAmountCents()))).toList(), heading, text, money);
      summarySheet.createFreezePane(0, 2);

      Sheet detailSheet = workbook.createSheet("报销明细");
      String[] columns = {"报销单号","门店","费用分类","发生日期","申请金额（元）","状态","申请人","收款方","票据类型","费用说明","提交时间","审核时间","审核人","付款方式","付款日期","付款凭证号"};
      Row header = detailSheet.createRow(0);
      for (int column = 0; column < columns.length; column++) { cell(header, column, columns[column], heading); detailSheet.setColumnWidth(column, (column == 9 ? 36 : 18) * 256); }
      int detailIndex = 1;
      for (ExpenseExportRow item : details) {
        Row row = detailSheet.createRow(detailIndex++);
        Object[] values = {item.claimNo(),item.storeName(),item.categoryName(),text(item.expenseDate()),cents(item.amountCents()),statusName(item.status()),item.applicantName(),item.payeeName(),item.receiptType(),item.description(),text(item.submittedAt()),text(item.reviewedAt()),item.reviewerName(),item.paymentMethod(),text(item.paymentDate()),item.paymentReference()};
        for (int column = 0; column < values.length; column++) {
          Object value = values[column];
          if (value instanceof Number number) numericCell(row, column, number.doubleValue(), money); else cell(row, column, value == null ? "" : value.toString(), text);
        }
      }
      detailSheet.createFreezePane(0, 1);
      detailSheet.setAutoFilter(new CellRangeAddress(0, Math.max(0, detailIndex - 1), 0, columns.length - 1));

      Sheet categorySheet = workbook.createSheet("费用分类统计");
      Row categoryHeader = categorySheet.createRow(0);
      String[] categoryColumns = {"费用分类","单据数","申请金额（元）","已付金额（元）","申请金额占比"};
      for (int column = 0; column < categoryColumns.length; column++) { cell(categoryHeader, column, categoryColumns[column], heading); categorySheet.setColumnWidth(column, 24 * 256); }
      int categoryIndex = 1;
      long totalAmount = summary.totals().totalAmountCents();
      for (CategorySummary item : summary.categories()) {
        Row row = categorySheet.createRow(categoryIndex++);
        cell(row, 0, item.categoryName(), text); numericCell(row, 1, item.claimCount(), integer);
        numericCell(row, 2, cents(item.amountCents()), money); numericCell(row, 3, cents(item.paidAmountCents()), money);
        cell(row, 4, totalAmount == 0 ? "0.00%" : "%.2f%%".formatted(item.amountCents() * 100.0 / totalAmount), text);
      }
      categorySheet.createFreezePane(0, 1);
      workbook.write(output);
      return output.toByteArray();
    } catch (IOException exception) {
      throw new IllegalStateException("Unable to generate finance expense workbook", exception);
    }
  }

  private int summaryMetrics(Sheet sheet, int rowIndex, FinanceTotals totals, CellStyle heading, CellStyle integer, CellStyle money) {
    Row labels = sheet.createRow(rowIndex++);
    String[] names = {"申请单数","申请总额（元）","待审核金额（元）","待付款金额（元）","已付款金额（元）"};
    for (int column = 0; column < names.length; column++) cell(labels, column, names[column], heading);
    Row values = sheet.createRow(rowIndex++);
    numericCell(values, 0, totals.claimCount(), integer); numericCell(values, 1, cents(totals.totalAmountCents()), money);
    numericCell(values, 2, cents(totals.pendingAmountCents()), money); numericCell(values, 3, cents(totals.approvedAmountCents()), money);
    numericCell(values, 4, cents(totals.paidAmountCents()), money);
    return rowIndex;
  }

  private int summaryTable(Sheet sheet, int rowIndex, String title, List<String> headers, List<? extends List<?>> rows, CellStyle heading, CellStyle text, CellStyle money) {
    Row titleRow = sheet.createRow(rowIndex++); cell(titleRow, 0, title, heading); sheet.addMergedRegion(new CellRangeAddress(rowIndex - 1, rowIndex - 1, 0, 4));
    Row header = sheet.createRow(rowIndex++);
    for (int column = 0; column < headers.size(); column++) cell(header, column, headers.get(column), heading);
    for (List<?> values : rows) {
      Row row = sheet.createRow(rowIndex++);
      for (int column = 0; column < values.size(); column++) {
        Object value = values.get(column);
        if (value instanceof Number number) numericCell(row, column, number.doubleValue(), column >= 2 ? money : text); else cell(row, column, value == null ? "" : value.toString(), text);
      }
    }
    return rowIndex;
  }

  private CellStyle style(XSSFWorkbook workbook, boolean bold, HorizontalAlignment alignment) {
    CellStyle style = workbook.createCellStyle();
    style.setAlignment(alignment); style.setVerticalAlignment(VerticalAlignment.CENTER);
    style.setBorderBottom(BorderStyle.THIN); style.setBorderTop(BorderStyle.THIN); style.setBorderLeft(BorderStyle.THIN); style.setBorderRight(BorderStyle.THIN);
    Font font = workbook.createFont(); font.setBold(bold); font.setFontName("Microsoft YaHei"); style.setFont(font);
    return style;
  }

  private void cell(Row row, int column, String value, CellStyle style) { Cell cell = row.createCell(column); cell.setCellValue(value); cell.setCellStyle(style); }
  private void numericCell(Row row, int column, double value, CellStyle style) { Cell cell = row.createCell(column); cell.setCellValue(value); cell.setCellStyle(style); }
  private double cents(Long amount) { return (amount == null ? 0L : amount) / 100.0; }
  private String text(Object value) { return value == null ? "" : value.toString().replace('T', ' '); }
  private String statusName(String status) { return switch (status) { case "SUBMITTED" -> "待审核"; case "APPROVED" -> "待付款"; case "PAID" -> "已付款"; case "RETURNED" -> "已退回"; case "REJECTED" -> "已驳回"; default -> status; }; }
  private void requireFinanceAccess(String authorization) { sessions.requirePermission(authorization, "EXPENSE_REVIEW"); sessions.requirePermission(authorization, "EXPENSE_ALL_STORE_VIEW"); }
  private ResponseStatusException bad(String message) { return new ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST, message); }

  public record FinanceExpenseSummary(LocalDate from, LocalDate to, FinanceTotals totals, List<StatusSummary> statuses, List<StoreSummary> stores, List<CategorySummary> categories) {}
  public record FinanceTotals(Long claimCount, Long totalAmountCents, Long pendingCount, Long pendingAmountCents, Long approvedCount, Long approvedAmountCents, Long paidCount, Long paidAmountCents) {}
  public record StatusSummary(String status, Long claimCount, Long amountCents) {}
  public record StoreSummary(UUID storeId, String storeName, Long claimCount, Long amountCents, Long paidAmountCents) {}
  public record CategorySummary(UUID expenseCategoryId, String categoryName, Long claimCount, Long amountCents, Long paidAmountCents) {}
  record ExpenseExportRow(String claimNo, String storeName, String categoryName, LocalDate expenseDate, Long amountCents, String status, String applicantName, String payeeName, String receiptType, String description, OffsetDateTime submittedAt, OffsetDateTime reviewedAt, String reviewerName, String paymentMethod, LocalDate paymentDate, String paymentReference) {}
  record DateRange(LocalDate from, LocalDate to) {}
}
