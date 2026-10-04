package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.anyShort;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.RETURNS_SELF;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.chengxin.massage.ApiExceptionHandler;
import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.catalog.ServiceItemVersionService;
import com.chengxin.massage.operations.BusinessClockService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class SalesOrderUnitSettlementTest {
  private static final UUID STORE = UUID.fromString("00000000-0000-0000-0000-000000000001");
  private static final UUID ITEM = UUID.fromString("00000000-0000-0000-0000-000000000002");
  private static final UUID TECHNICIAN = UUID.fromString("00000000-0000-0000-0000-000000000003");
  private static final UUID RULE = UUID.fromString("00000000-0000-0000-0000-000000000004");
  private static final List<UUID> SESSIONS = List.of(
      UUID.fromString("00000000-0000-0000-0000-000000000011"),
      UUID.fromString("00000000-0000-0000-0000-000000000012"),
      UUID.fromString("00000000-0000-0000-0000-000000000013"));
  private static final List<Integer> ORIGINALS = List.of(97300, 15900, 28900);
  private static final List<Integer> MAIN_PRICES = List.of(30000, 15900, 28900);
  private static final List<Integer> EXTENSION_PRICES = List.of(19900, 18900, 28500);
  private static final LocalDate DATE = LocalDate.of(2026, 10, 3);
  private static final ObjectMapper JSON = new ObjectMapper();

  @Test
  void settlesThreeUnitsAtActualTotalsAndPersistsOriginalsSeparately() throws Exception {
    Fixture fixture = new Fixture("PERCENT");
    fixture.mvc.perform(post("/api/v1/sales-orders/settle").contentType(MediaType.APPLICATION_JSON)
        .content(request(List.of(97300L, 15000L, 28000L), null, 140300L)))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.receivableCents").value(140300))
      .andExpect(jsonPath("$.paidCents").value(140300));

    assertThat(fixture.writes("insert into sales_order_line"))
      .extracting(write -> write.parameters.get("amount"), write -> write.parameters.get("settlementAmount"))
      .containsExactly(tuple(97300, 97300L), tuple(15900, 15000L), tuple(28900, 28000L));
    assertThat(fixture.writes("insert into sales_order("))
      .extracting(write -> write.parameters.get("total"), write -> write.parameters.get("paid"))
      .containsExactly(tuple(140300L, 140300L));
    assertThat(fixture.writes("insert into payment_record"))
      .extracting(write -> write.parameters.get("amount")).containsExactly(140300L);
    assertThat(fixture.writes("update service_session")).isEmpty();
  }

  @ParameterizedTest
  @ValueSource(strings = {"FIXED", "PERCENT"})
  void reducedReceiptsDoNotChangeMainOrExtensionCommissions(String ruleType) throws Exception {
    Fixture original = new Fixture(ruleType);
    Fixture reduced = new Fixture(ruleType);
    original.mvc.perform(post("/api/v1/sales-orders/settle").contentType(MediaType.APPLICATION_JSON)
        .content(request(List.of(97300L, 15900L, 28900L), null, 142100L))).andExpect(status().isOk());
    reduced.mvc.perform(post("/api/v1/sales-orders/settle").contentType(MediaType.APPLICATION_JSON)
        .content(request(List.of(97300L, 15000L, 28000L), null, 140300L))).andExpect(status().isOk());

    List<Map<String, Object>> originalCommissions = commissionFacts(original);
    assertThat(originalCommissions).hasSize(6);
    assertThat(commissionFacts(reduced)).containsExactlyElementsOf(originalCommissions);
    assertThat(originalCommissions.stream().mapToLong(row -> (Long) row.get("commission")).sum())
      .isEqualTo("FIXED".equals(ruleType) ? 19500L : 21690L);
  }

  @Test
  void changingSettledReceiptsDoesNotWriteOrRecomputeCommissions() {
    Fixture fixture = new Fixture("PERCENT");
    var result = fixture.controller.correctFinancials(UUID.randomUUID(),
        new SalesOrderController.FinancialCorrectionInput(140300L,
            List.of(new SalesOrderController.PaymentInput("CASH", 140300L)), "抹零更正", 0), null, null);

    assertThat(result.newPaidCents()).isEqualTo(140300L);
    assertThat(fixture.writes("insert into technician_commission_record")).isEmpty();
    assertThat(fixture.statements).noneMatch(write -> write.sql.contains("technician_commission_record"));
    verify(fixture.tiers, never()).resolve(any(), any(), any(), anyShort());
    verify(fixture.versions, never()).commissionRule(any(UUID.class), any(UUID.class));
  }

  @Test
  void allowsSurchargeWithoutIncreasingCommissions() throws Exception {
    Fixture original = new Fixture("PERCENT");
    Fixture surcharge = new Fixture("PERCENT");
    original.mvc.perform(post("/api/v1/sales-orders/settle").contentType(MediaType.APPLICATION_JSON)
        .content(request(List.of(97300L, 15900L, 28900L), null, 142100L))).andExpect(status().isOk());
    surcharge.mvc.perform(post("/api/v1/sales-orders/settle").contentType(MediaType.APPLICATION_JSON)
        .content(request(List.of(98300L, 15900L, 28900L), null, 143100L)))
      .andExpect(status().isOk()).andExpect(jsonPath("$.paidCents").value(143100));

    assertThat(commissionFacts(surcharge)).containsExactlyElementsOf(commissionFacts(original));
    surcharge.unitAmounts = List.of(98300L, 15900L, 28900L);
    surcharge.currentPaid = 143100L;
    assertThat(surcharge.controller.detail(UUID.randomUUID(), null, null).settlementTotals().adjustmentCents())
      .isEqualTo(-1000L);
  }

  @Test
  void acceptsHeaderOnlyLegacyDiscountAndLeavesUnitAmountsUnallocated() throws Exception {
    Fixture fixture = new Fixture("PERCENT");
    fixture.mvc.perform(post("/api/v1/sales-orders/settle").contentType(MediaType.APPLICATION_JSON)
        .content(request(Collections.nCopies(3, null), 140300L, 140300L)))
      .andExpect(status().isOk()).andExpect(jsonPath("$.paidCents").value(140300));

    assertThat(fixture.writes("insert into sales_order_line"))
      .extracting(write -> write.parameters.get("settlementAmount")).containsExactly(null, null, null);
  }

  @Test
  void historicalDetailFallsBackToOriginalPricesWithoutChangingExistingFields() throws Exception {
    Fixture fixture = new Fixture("PERCENT");
    fixture.currentPaid = 140300L;
    fixture.mvc.perform(get("/api/v1/sales-orders/" + UUID.randomUUID()))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.lines[0].settlementAmountCents").value(97300))
      .andExpect(jsonPath("$.lines[0].settlementAmountEstimated").value(true))
      .andExpect(jsonPath("$.lines[0].lineAmountCents").value(97300))
      .andExpect(jsonPath("$.lines[1].lineAmountCents").value(15900))
      .andExpect(jsonPath("$.lines[2].lineAmountCents").value(28900))
      .andExpect(jsonPath("$.settlementTotals.originalTotalCents").value(142100))
      .andExpect(jsonPath("$.settlementTotals.settlementAmountCents").value(140300))
      .andExpect(jsonPath("$.settlementTotals.adjustmentCents").value(1800));

    assertThat(fixture.statements.stream().filter(call -> call.sql.contains("from sales_order_line line")))
      .singleElement().satisfies(call -> assertThat(call.sql)
        .contains("coalesce(line.settlement_amount_cents,line.line_amount_cents) settlement_amount_cents")
        .contains("line.settlement_amount_cents is null settlement_amount_estimated"));
  }

  @Test
  void detailRetainsSettlementTimeUnitSnapshotsButTotalsUseCurrentFinancialCorrection() throws Exception {
    Fixture fixture = new Fixture("PERCENT");
    fixture.unitAmounts = List.of(97300L, 15000L, 28000L);
    fixture.currentPaid = 140000L;
    fixture.mvc.perform(get("/api/v1/sales-orders/" + UUID.randomUUID()))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.lines[1].settlementAmountCents").value(15000))
      .andExpect(jsonPath("$.lines[1].settlementAmountEstimated").value(false))
      .andExpect(jsonPath("$.settlementTotals.settlementAmountCents").value(140000))
      .andExpect(jsonPath("$.settlementTotals.adjustmentCents").value(2100));
    assertThat(fixture.statements).noneMatch(call -> call.updated);
  }

  @Test
  void rejectsPaymentsAtOriginalTotalBeforeWritingAnyFinancialRecords() throws Exception {
    Fixture fixture = new Fixture("PERCENT");
    fixture.mvc.perform(post("/api/v1/sales-orders/settle").contentType(MediaType.APPLICATION_JSON)
        .content(request(List.of(97300L, 15000L, 28000L), null, 142100L)))
      .andExpect(status().isBadRequest())
      .andExpect(jsonPath("$.message").value("各收款方式合计必须等于实收金额"));
    assertThat(fixture.statements).noneMatch(write -> write.updated);
  }

  @Test
  void rejectsDeclaredTotalThatDisagreesWithUnitReceipts() throws Exception {
    Fixture fixture = new Fixture("PERCENT");
    fixture.mvc.perform(post("/api/v1/sales-orders/settle").contentType(MediaType.APPLICATION_JSON)
        .content(request(List.of(97300L, 15000L, 28000L), 142100L, 142100L)))
      .andExpect(status().isBadRequest())
      .andExpect(jsonPath("$.message").value("总实收金额必须等于各单元实收合计"));
    assertThat(fixture.statements).noneMatch(write -> write.updated);
  }

  @Test
  void rejectsNegativeUnitAmountEvenWhenTheSessionWasAlreadySettled() throws Exception {
    Fixture fixture = new Fixture("PERCENT");
    fixture.alreadySettled = true;
    fixture.mvc.perform(post("/api/v1/sales-orders/settle").contentType(MediaType.APPLICATION_JSON)
        .content(request(List.of(-1L, 15000L, 28000L), null, 140300L)))
      .andExpect(status().isBadRequest())
      .andExpect(jsonPath("$.message").value("单元实收金额不得为负数"));
    assertThat(fixture.statements).noneMatch(call -> call.updated);
  }

  @ParameterizedTest
  @ValueSource(strings = {"\"abc\"", "15000.5", "9223372036854775808", "-1"})
  void rejectsInvalidUnitAmountsBeforeWriting(String amount) throws Exception {
    Fixture fixture = new Fixture("PERCENT");
    String body = "{\"lines\":[{\"serviceSessionId\":\"" + SESSIONS.getFirst()
        + "\",\"settlementAmountCents\":" + amount + "}],\"payments\":[{\"method\":\"CASH\",\"amountCents\":97300}]}";
    fixture.mvc.perform(post("/api/v1/sales-orders/settle").contentType(MediaType.APPLICATION_JSON).content(body))
      .andExpect(status().isBadRequest())
      .andExpect(jsonPath("$.message").value(amount.equals("-1") ? "单元实收金额不得为负数"
          : amount.equals("9223372036854775808") ? "单元实收金额超出支持范围" : "单元实收金额必须为整数分"));
    assertThat(fixture.statements).noneMatch(write -> write.updated);
  }

  private List<Map<String, Object>> commissionFacts(Fixture fixture) {
    return fixture.writes("insert into technician_commission_record").stream().map(write -> {
      Map<String, Object> facts = new LinkedHashMap<>();
      for (String key : List.of("session", "extension", "source", "baseAmount", "commission", "clockAdjustment", "tierMultiplier")) {
        facts.put(key, write.parameters.get(key));
      }
      return facts;
    }).toList();
  }

  private String request(List<Long> amounts, Long total, long payment) throws Exception {
    List<Map<String, Object>> lines = new ArrayList<>();
    for (int index = 0; index < SESSIONS.size(); index++) {
      Map<String, Object> line = new LinkedHashMap<>();
      line.put("serviceSessionId", SESSIONS.get(index));
      if (amounts.get(index) != null) line.put("settlementAmountCents", amounts.get(index));
      lines.add(line);
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("lines", lines);
    body.put("payments", List.of(Map.of("method", "CASH", "amountCents", payment)));
    if (total != null) body.put("settlementAmountCents", total);
    return JSON.writeValueAsString(body);
  }

  private static class SqlCall {
    final String sql;
    final Map<String, Object> parameters = new LinkedHashMap<>();
    boolean updated;

    SqlCall(String sql) { this.sql = sql; }
  }

  private static class Fixture {
    final List<SqlCall> statements = new ArrayList<>();
    final MonthlyCommissionTierService tiers = mock(MonthlyCommissionTierService.class);
    final ServiceItemVersionService versions = mock(ServiceItemVersionService.class);
    final SalesOrderController controller;
    final MockMvc mvc;
    List<Long> unitAmounts = Collections.nCopies(3, null);
    long currentPaid = 142100L;
    boolean alreadySettled;

    Fixture(String ruleType) {
      JdbcClient jdbc = mock(JdbcClient.class);
      when(jdbc.sql(anyString())).thenAnswer(invocation -> statement(invocation.getArgument(0)));
      StoreContextService stores = mock(StoreContextService.class);
      when(stores.currentStore(any(), any())).thenReturn(STORE);
      BusinessClockService clock = mock(BusinessClockService.class);
      when(clock.businessDate(eq(STORE), any())).thenReturn(DATE);
      AdminSessionService admins = mock(AdminSessionService.class);
      when(admins.authenticatedIdentity(any())).thenReturn(
          new AdminSessionService.AuthenticatedIdentity(TECHNICIAN, "收银员", List.of("STORE_MANAGER")));
      when(versions.commissionRule(STORE, RULE)).thenReturn(
          new ServiceItemVersionService.CommissionRuleVersion(RULE, ITEM, ruleType, 5000L, 2000,
              ruleType, 5000L, 2000, ruleType, 1500L, 1000, true, DATE));
      when(tiers.resolve(eq(STORE), eq(TECHNICIAN), eq(DATE), anyShort()))
        .thenReturn(MonthlyCommissionTierService.TierSnapshot.baseline(1));
      controller = new SalesOrderController(jdbc, stores, mock(AuditService.class), clock, versions, tiers, admins);
      mvc = MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new ApiExceptionHandler()).build();
    }

    List<SqlCall> writes(String prefix) {
      return statements.stream().filter(call -> call.updated && call.sql.startsWith(prefix)).toList();
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private JdbcClient.StatementSpec statement(String sql) {
      SqlCall call = new SqlCall(sql);
      statements.add(call);
      var statement = mock(JdbcClient.StatementSpec.class, RETURNS_SELF);
      when(statement.param(anyString(), any())).thenAnswer(invocation -> {
        call.parameters.put(invocation.getArgument(0), invocation.getArgument(1));
        return statement;
      });
      when(statement.update()).thenAnswer(invocation -> { call.updated = true; return 1; });
      when(statement.query(any(Class.class))).thenAnswer(invocation -> {
        Class<?> type = invocation.getArgument(0);
        var query = mock(JdbcClient.MappedQuerySpec.class);
        when(query.list()).thenAnswer(ignored -> rows(type, call));
        when(query.optional()).thenAnswer(ignored -> rows(type, call).stream().findFirst());
        when(query.single()).thenAnswer(ignored -> rows(type, call).getFirst());
        return query;
      });
      return statement;
    }

    private List<?> rows(Class<?> type, SqlCall call) {
      UUID session = (UUID) call.parameters.getOrDefault("session", call.parameters.get("id"));
      int index = session == null ? -1 : SESSIONS.indexOf(session);
      if (type == UUID.class) return call.sql.startsWith("select room_id") ? List.of() : List.of(session);
      if (type == Boolean.class) return List.of(false);
      if (type == Long.class) return List.of(1L);
      if (type == SalesOrderController.ExistingSessionOrder.class) {
        if (!alreadySettled) return List.of();
        return SESSIONS.stream().map(id -> new SalesOrderController.ExistingSessionOrder(id, ITEM, "SO-TEST",
            currentPaid, currentPaid, "SETTLED", OffsetDateTime.now())).toList();
      }
      if (type == SalesOrderController.OrderSummary.class) {
        return List.of(new SalesOrderController.OrderSummary(session, "SO-TEST", "JS-TEST", "收银员",
            "SETTLED", "NONE", currentPaid, currentPaid, OffsetDateTime.now(), OffsetDateTime.now(),
            null, null, null, null, null, 0L, null, null, null, 0, 0, false, null, null, null, null));
      }
      if (type == SalesOrderController.OrderLine.class) {
        return SESSIONS.stream().map(id -> {
          int unit = SESSIONS.indexOf(id);
          Long actual = unitAmounts.get(unit);
          return new SalesOrderController.OrderLine(id, ITEM, "服务项目", ORIGINALS.get(unit).longValue(),
              (short) 60, (short) 1, ORIGINALS.get(unit).longValue(), id, TECHNICIAN, "技师", "001",
              "测试房", OffsetDateTime.now(), "QUEUE", 1L,
              actual == null ? ORIGINALS.get(unit).longValue() : actual, actual == null);
        }).toList();
      }
      if (type == SalesOrderController.BusinessCorrectionView.class) return List.of();
      if (type == SalesOrderController.ServiceSessionForSettlement.class) {
        return List.of(new SalesOrderController.ServiceSessionForSettlement(session, ITEM, "主服务", ORIGINALS.get(index),
            (short) (index == 0 ? 195 : 60), index == 0 ? "加钟三项" : "", DATE));
      }
      if (type == SalesOrderController.SettlementParticipant.class) {
        return List.of(new SalesOrderController.SettlementParticipant(session, (short) 1, (short) 1,
            "PRIMARY", 10000, "COMPLETED", null));
      }
      if (type == SalesOrderController.SettlementUnit.class) {
        return SESSIONS.stream().filter(id -> ((List<?>) call.parameters.get("sessions")).contains(id))
          .map(id -> new SalesOrderController.SettlementUnit(id, null, null,
            ORIGINALS.get(SESSIONS.indexOf(id)).longValue(), id.equals(SESSIONS.getFirst()) ? 3L : 0L)).toList();
      }
      if (type == SalesOrderController.ParticipantCommissionBase.class) {
        return List.of(new SalesOrderController.ParticipantCommissionBase(session, session, ITEM, TECHNICIAN,
            "技师", "主服务", MAIN_PRICES.get(index), "QUEUE", RULE, DATE, true, (short) 60,
            (short) 1, (short) 1, 10000, 3600));
      }
      if (type == SalesOrderController.CommissionBase.class) {
        if (index != 0) return List.of();
        return EXTENSION_PRICES.stream().map(price -> new SalesOrderController.CommissionBase(session,
            UUID.nameUUIDFromBytes(price.toString().getBytes(java.nio.charset.StandardCharsets.US_ASCII)), ITEM,
            TECHNICIAN, "技师", "加钟", price, "EXTENSION", RULE, DATE, true, (short) 0,
            null, 10000, 0, (short) 0, 10000)).toList();
      }
      if (type == SalesOrderController.PaymentMethod.class) {
        return List.of(new SalesOrderController.PaymentMethod("CASH", "现金", "EXTERNAL"));
      }
      if (type == SalesOrderController.Payment.class) {
        return List.of(new SalesOrderController.Payment(UUID.randomUUID(), "CASH", "现金", null, null, null,
            null, null, null, 142100L, OffsetDateTime.now()));
      }
      if (type == SalesOrderController.FinancialCorrectionOrder.class) {
        return List.of(new SalesOrderController.FinancialCorrectionOrder(session, null, "SO-TEST", "SETTLED", "NONE",
            142100L, 0, DATE));
      }
      throw new AssertionError("Unexpected query: " + type + " / " + call.sql);
    }
  }
}
