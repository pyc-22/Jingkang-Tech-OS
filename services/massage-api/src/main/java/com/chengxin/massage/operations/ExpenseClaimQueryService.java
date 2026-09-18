package com.chengxin.massage.operations;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ExpenseClaimQueryService {
  private static final UUID TENANT = UUID.fromString("11111111-1111-1111-1111-111111111111");
  static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
  static final String CLAIM_TIME = "coalesce(c.submitted_at,c.created_at)";
  private static final String JOINS = " from expense_claim c join store s on s.id=c.store_id join app_user u on u.id=c.applicant_user_id join expense_category k on k.id=c.expense_category_id left join expense_category p on p.id=k.parent_id ";
  private static final String COLUMNS = "c.id,c.claim_no,c.store_id,s.name store_name,c.expense_category_id,coalesce(p.name || ' / ','') || k.name category_name,c.expense_date,c.amount_cents,c.status,c.submitted_at,c.created_at,c.applicant_user_id,u.display_name applicant_name,c.description,(select count(*) from expense_attachment a where a.claim_id=c.id and a.active) attachment_count";
  private final JdbcClient jdbc;

  ExpenseClaimQueryService(JdbcClient jdbc) { this.jdbc = jdbc; }

  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
  public ClaimPage page(Query query, UUID fixedStore) {
    Criteria criteria = criteria(query, fixedStore);
    Summary summary = jdbc.sql("""
      select count(*)::bigint claim_count,
        coalesce(sum(c.amount_cents) filter(where c.status in ('SUBMITTED','APPROVED','PAID')),0)::bigint effective_amount_cents,
        count(*) filter(where c.status='SUBMITTED')::bigint pending_count,
        count(*) filter(where c.status='APPROVED')::bigint approved_count,
        count(*) filter(where c.status='PAID')::bigint paid_count,
        coalesce(sum(c.amount_cents) filter(where c.status='APPROVED'),0)::bigint approved_amount_cents,
        coalesce(sum(c.amount_cents) filter(where c.status='PAID'),0)::bigint paid_amount_cents
      """ + JOINS + criteria.where()).params(criteria.params()).query(Summary.class).single();
    List<ClaimItem> items = jdbc.sql("select " + COLUMNS + JOINS + criteria.where() + criteria.order() + " limit :limit offset :offset")
      .params(criteria.params()).param("limit", criteria.size()).param("offset", (long) criteria.page() * criteria.size()).query(ClaimItem.class).list();
    List<StoreOption> stores = jdbc.sql("select id,name from store where tenant_id=:tenant" + (fixedStore == null ? "" : " and id=:store") + " order by name,id")
      .params(fixedStore == null ? Map.of("tenant", TENANT) : Map.of("tenant", TENANT, "store", fixedStore)).query(StoreOption.class).list();
    return new ClaimPage(items, summary.claimCount(), summary, criteria.page(), criteria.size(), stores);
  }

  @Transactional(readOnly = true)
  public byte[] export(Query query, UUID fixedStore) {
    Criteria criteria = criteria(query, fixedStore);
    List<ClaimItem> items = jdbc.sql("select " + COLUMNS + JOINS + criteria.where() + criteria.order())
      .params(criteria.params()).query(ClaimItem.class).list();
    return workbook(items);
  }

  static Criteria criteria(Query query, UUID fixedStore) {
    LocalDate today = LocalDate.now(ZONE);
    LocalDate from = query.from() == null ? today.minusDays(29) : query.from();
    LocalDate to = query.to() == null ? today : query.to();
    if (from.isAfter(to)) throw bad("开始日期应早于或等于结束日期");
    int page = query.page() == null ? 0 : query.page();
    int size = query.size() == null ? 20 : query.size();
    if (page < 0 || size < 1 || size > 100) throw bad("分页参数超出范围");
    String status = query.status() == null ? "" : query.status().trim().toUpperCase(Locale.ROOT);
    if (!List.of("", "EFFECTIVE", "DRAFT", "SUBMITTED", "APPROVED", "PAID", "RETURNED", "REJECTED", "WITHDRAWN").contains(status)) throw bad("报销状态无效");
    String sort = query.sort() == null ? "time" : query.sort();
    String direction = query.direction() == null ? "desc" : query.direction().toLowerCase(Locale.ROOT);
    if (!List.of("time", "amount").contains(sort) || !List.of("asc", "desc").contains(direction)) throw bad("排序参数无效");
    Map<String, Object> params = new HashMap<>();
    params.put("tenant", TENANT);
    params.put("from", from.atStartOfDay(ZONE).toOffsetDateTime());
    params.put("until", to.plusDays(1).atStartOfDay(ZONE).toOffsetDateTime());
    StringBuilder where = new StringBuilder(" where c.tenant_id=:tenant and " + CLAIM_TIME + ">=:from and " + CLAIM_TIME + "<:until");
    UUID store = fixedStore == null ? query.storeId() : fixedStore;
    if (store != null) { where.append(" and c.store_id=:store"); params.put("store", store); }
    if (query.categoryId() != null) { where.append(" and (c.expense_category_id=:category or k.parent_id=:category)"); params.put("category", query.categoryId()); }
    if (!status.isEmpty()) {
      if (status.equals("EFFECTIVE")) where.append(" and c.status in ('SUBMITTED','APPROVED','PAID')");
      else { where.append(" and c.status=:status"); params.put("status", status); }
    }
    if (query.applicant() != null && !query.applicant().isBlank()) { where.append(" and strpos(lower(u.display_name),lower(:applicant))>0"); params.put("applicant", query.applicant().trim()); }
    if (query.claimNo() != null && !query.claimNo().isBlank()) { where.append(" and strpos(lower(c.claim_no),lower(:number))>0"); params.put("number", query.claimNo().trim()); }
    String order = " order by " + (sort.equals("amount") ? "c.amount_cents" : CLAIM_TIME) + " " + direction + ",c.id " + direction;
    return new Criteria(where.toString(), params, order, page, size);
  }

  static byte[] workbook(List<ClaimItem> items) {
    try (XSSFWorkbook book = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      var sheet = book.createSheet("费用报销");
      String[] headings = {"单号", "提交时间", "分类", "金额（元）", "状态", "报销人", "备注", "门店", "发生日期"};
      var headingStyle = book.createCellStyle();
      var font = book.createFont(); font.setBold(true); headingStyle.setFont(font);
      var money = book.createCellStyle(); money.setDataFormat(book.createDataFormat().getFormat("#,##0.00"));
      var header = sheet.createRow(0);
      for (int i = 0; i < headings.length; i++) { var cell = header.createCell(i); cell.setCellValue(headings[i]); cell.setCellStyle(headingStyle); sheet.setColumnWidth(i, (i == 6 ? 40 : 24) * 256); }
      for (ClaimItem item : items) {
        var row = sheet.createRow(sheet.getLastRowNum() + 1);
        String time = item.submittedAt() == null ? "" : item.submittedAt().atZoneSameInstant(ZONE).toLocalDateTime().toString().replace('T', ' ');
        String[] values = {item.claimNo(), time, item.categoryName(), "", statusName(item.status()), item.applicantName(), item.description(), item.storeName(), item.expenseDate().toString()};
        for (int i = 0; i < values.length; i++) row.createCell(i).setCellValue(values[i] == null ? "" : values[i]);
        row.getCell(3).setCellValue(item.amountCents() / 100.0); row.getCell(3).setCellStyle(money);
      }
      sheet.createFreezePane(0, 1);
      sheet.setAutoFilter(new org.apache.poi.ss.util.CellRangeAddress(0, sheet.getLastRowNum(), 0, headings.length - 1));
      book.write(out);
      return out.toByteArray();
    } catch (IOException exception) { throw new IllegalStateException("Expense export failed", exception); }
  }

  private static String statusName(String status) { return switch (status) { case "SUBMITTED" -> "待审核"; case "APPROVED" -> "已审核（待付款）"; case "PAID" -> "已付款"; case "DRAFT" -> "草稿"; case "RETURNED" -> "已退回"; case "REJECTED" -> "已驳回"; case "WITHDRAWN" -> "已撤回"; default -> status; }; }
  private static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  public record Query(LocalDate from, LocalDate to, UUID storeId, UUID categoryId, String applicant, String status, String claimNo, String sort, String direction, Integer page, Integer size) {}
  record Criteria(String where, Map<String, Object> params, String order, int page, int size) {}
  public record ClaimItem(UUID id, String claimNo, UUID storeId, String storeName, UUID expenseCategoryId, String categoryName, LocalDate expenseDate, Long amountCents, String status, OffsetDateTime submittedAt, OffsetDateTime createdAt, UUID applicantUserId, String applicantName, String description, Long attachmentCount) {}
  public record Summary(Long claimCount, Long effectiveAmountCents, Long pendingCount, Long approvedCount, Long paidCount, Long approvedAmountCents, Long paidAmountCents) {}
  public record StoreOption(UUID id, String name) {}
  public record ClaimPage(List<ClaimItem> items, Long total, Summary summary, int page, int size, List<StoreOption> stores) {}
}
