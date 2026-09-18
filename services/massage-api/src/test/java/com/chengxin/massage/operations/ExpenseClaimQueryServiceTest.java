package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.*;
import java.io.ByteArrayInputStream;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class ExpenseClaimQueryServiceTest {
  private ExpenseClaimQueryService.Query query(String status, String sort, String direction, Integer page, Integer size) {
    return new ExpenseClaimQueryService.Query(LocalDate.parse("2026-09-01"),LocalDate.parse("2026-09-30"),UUID.randomUUID(),null,"A_%",status,null,sort,direction,page,size);
  }

  @Test void defaultRangeIncludesExactlyThirtyChinaCalendarDays() {
    var q=new ExpenseClaimQueryService.Query(null,null,null,null,null,null,null,null,null,null,null);
    var criteria=ExpenseClaimQueryService.criteria(q,null);
    var from=(OffsetDateTime)criteria.params().get("from");
    var until=(OffsetDateTime)criteria.params().get("until");
    assertThat(java.time.Duration.between(from,until).toDays()).isEqualTo(30);
    assertThat(until.toLocalDate()).isEqualTo(LocalDate.now(ExpenseClaimQueryService.ZONE).plusDays(1));
    assertThat(criteria.size()).isEqualTo(20);
  }

  @Test void storeScopeOverridesClientAndDatesUseHalfOpenSubmissionInstants() {
    UUID store=UUID.randomUUID();
    var c=ExpenseClaimQueryService.criteria(query("EFFECTIVE","time","desc",0,20),store);
    assertThat(c.params().get("store")).isEqualTo(store);
    assertThat(c.params().get("from")).isEqualTo(OffsetDateTime.parse("2026-09-01T00:00:00+08:00"));
    assertThat(c.params().get("until")).isEqualTo(OffsetDateTime.parse("2026-10-01T00:00:00+08:00"));
    assertThat(c.where()).contains("coalesce(c.submitted_at,c.created_at)","('SUBMITTED','APPROVED','PAID')").doesNotContain("expense_date");
  }

  @Test void filtersAreBoundAndSortHasStableTieBreaker() {
    var c=ExpenseClaimQueryService.criteria(query("PAID","amount","asc",2,20),null);
    assertThat(c.where()).contains("c.status=:status","lower(:applicant)").doesNotContain("A_%");
    assertThat(c.params().get("applicant")).isEqualTo("A_%");
    assertThat(c.order()).isEqualTo(" order by c.amount_cents asc,c.id asc");
  }

  @Test void invalidPaginationStatusAndSortAreRejected() {
    for(var q:List.of(query("INVALID","time","desc",0,20),query("","amount;drop table","desc",0,20),query("","time","sideways",0,20),query("","time","desc",-1,20),query("","time","desc",0,101)))
      assertThatThrownBy(()->ExpenseClaimQueryService.criteria(q,null)).isInstanceOf(ResponseStatusException.class);
  }

  @Test void reversedDateRangeIsRejected() {
    var q=new ExpenseClaimQueryService.Query(LocalDate.parse("2026-09-02"),LocalDate.parse("2026-09-01"),null,null,null,null,null,null,null,null,null);
    assertThatThrownBy(()->ExpenseClaimQueryService.criteria(q,null)).isInstanceOf(ResponseStatusException.class);
  }

  @Test void workbookHasNumericAmountsAndLiteralUserText() throws Exception {
    var item=new ExpenseClaimQueryService.ClaimItem(UUID.randomUUID(),"EX-1",UUID.randomUUID(),"Store",UUID.randomUUID(),"Travel",LocalDate.parse("2026-08-31"),12345L,"SUBMITTED",OffsetDateTime.parse("2026-09-01T01:02:00Z"),null,UUID.randomUUID(),"=1+1","<script>alert(1)</script>",0L);
    try(var book=new XSSFWorkbook(new ByteArrayInputStream(ExpenseClaimQueryService.workbook(List.of(item))))) {
      var sheet=book.getSheetAt(0);var row=sheet.getRow(1);
      assertThat(sheet.getLastRowNum()).isEqualTo(1);
      assertThat(row.getCell(3).getNumericCellValue()).isEqualTo(123.45);
      assertThat(row.getCell(5).getCellType()).isEqualTo(CellType.STRING);
      assertThat(row.getCell(5).getStringCellValue()).isEqualTo("=1+1");
      assertThat(row.getCell(1).getStringCellValue()).isEqualTo("2026-09-01 09:02");
      assertThat(sheet.getPaneInformation().isFreezePane()).isTrue();
    }
  }
}
