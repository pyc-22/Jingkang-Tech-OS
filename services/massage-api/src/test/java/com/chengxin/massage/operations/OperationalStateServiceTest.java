package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.RETURNS_SELF;

import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.catalog.ServiceSessionExtensionQueryService;
import com.chengxin.massage.catalog.ServiceSessionExtensionQueryService.Extension;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

class OperationalStateServiceTest {
  @Test
  void serviceDetailsExposeStructuredExtensionsAndExplicitTotals() {
    var row = serviceRow((short) 60, "IN_SERVICE", "");
    var json = new ObjectMapper().findAndRegisterModules().valueToTree(row.state(List.of()));

    assertThat(json.has("extensions")).isTrue();
    assertThat(json.get("extensions").isArray()).isTrue();
    assertThat(json.get("mainDurationMinutes").asInt()).isEqualTo(60);
    assertThat(json.get("totalDurationMinutes").asInt()).isEqualTo(60);
    assertThat(json.get("servicePriceCents").asInt()).isEqualTo(16900);
    assertThat(json.get("totalAmountCents").asLong()).isEqualTo(16900);
    assertThat(json.get("plannedDurationMinutes").asInt()).isEqualTo(60);
    assertThat(json.get("extensionSummary").asText()).isEmpty();
  }

  @Test
  void threeExtensionsRetainEveryDetailWithoutCountingTheirDurationTwice() {
    var row = serviceRow((short) 195, "IN_SERVICE", "Extension 1 60 / Extension 2 15 / Extension 3 60");
    List<Extension> extensions = List.of(
        extension(row.serviceSessionId(), "Extension 1", 15900, (short) 60, "14:20"),
        extension(row.serviceSessionId(), "Extension 2", 35600, (short) 15, "14:35"),
        extension(row.serviceSessionId(), "Extension 3", 28900, (short) 60, "14:50"));
    var state = row.state(extensions);

    assertThat(state.extensions()).containsExactlyElementsOf(extensions);
    assertThat(state.mainDurationMinutes()).isEqualTo(60);
    assertThat(state.totalDurationMinutes()).isEqualTo(195);
    assertThat(state.mainDurationMinutes() + state.extensions().stream().mapToInt(Extension::plannedDurationMinutes).sum())
        .isEqualTo(state.totalDurationMinutes());
    assertThat(state.totalAmountCents()).isEqualTo(97300);
    assertThat(state.extensionSummary()).isEqualTo(row.extensionSummary());
    assertThat(state.technicianCode()).isEqualTo("18");
    assertThat(state.technicianName()).isEqualTo("Main technician");
    assertThat(state.businessDate()).isEqualTo(LocalDate.of(2026, 10, 3));
    var json = new ObjectMapper().findAndRegisterModules().valueToTree(state);
    assertThat(json.get("extensions").get(0).get("technicianCode").asText()).isEqualTo("32");
    assertThat(json.get("extensions").get(0).get("technicianName").asText()).isEqualTo("Extension technician");
    assertThat(json.get("extensions").get(0).get("serviceNameSnapshot").asText()).isEqualTo("Extension 1");
    assertThat(json.get("extensions").get(0).get("servicePriceCents").asInt()).isEqualTo(15900);
    assertThat(json.get("extensions").get(0).get("plannedDurationMinutes").asInt()).isEqualTo(60);
    assertThat(json.get("extensions").get(0).hasNonNull("addedAt")).isTrue();
  }

  @Test
  void completedUnsettledServicesKeepTheSameExtensionAndTotalContract() {
    var row = serviceRow((short) 120, "COMPLETED_UNSETTLED", "Extension 60");
    var state = row.state(List.of(extension(row.serviceSessionId(), "Extension", 15900, (short) 60, "14:20")));

    assertThat(state.serviceStatus()).isEqualTo("COMPLETED_UNSETTLED");
    assertThat(state.mainDurationMinutes()).isEqualTo(60);
    assertThat(state.totalDurationMinutes()).isEqualTo(120);
    assertThat(state.totalAmountCents()).isEqualTo(32800);
  }

  @Test
  void liveStateLoadsExtensionsOnceForOnlyTheReturnedStoreAndSessions() {
    var jdbc = mock(JdbcClient.class);
    var clock = mock(BusinessClockService.class);
    var extensions = mock(ServiceSessionExtensionQueryService.class);
    UUID storeId = UUID.randomUUID();
    var row = serviceRow((short) 120, "IN_SERVICE", "Extension 60");
    var extension = extension(row.serviceSessionId(), "Extension", 15900, (short) 60, "14:20");
    when(clock.currentBusinessDate(storeId)).thenReturn(LocalDate.of(2026, 10, 3));
    stubQuery(jdbc, OperationalStateService.roomSql(), OperationalStateService.RoomRow.class,
        List.of(new OperationalStateService.RoomRow(row.roomId(), "001", "Room 1", 2, "IN_SERVICE", null, row.startedAt())));
    stubQuery(jdbc, OperationalStateService.serviceSql(), OperationalStateService.ServiceRow.class, List.of(row));
    stubQuery(jdbc, OperationalStateService.technicianSql(), OperationalStateService.TechnicianState.class, List.of());
    stubQuery(jdbc, OperationalStateService.attentionSql(), OperationalStateService.Attention.class,
        List.of(new OperationalStateService.Attention(0L, 0L)));
    when(extensions.forSessions(storeId, List.of(row.serviceSessionId())))
        .thenReturn(Map.of(row.serviceSessionId(), List.of(extension)));

    var live = new OperationalStateService(jdbc, clock, extensions).live(storeId);

    verify(extensions).forSessions(storeId, List.of(row.serviceSessionId()));
    assertThat(live.rooms().getFirst().services().getFirst().extensions()).containsExactly(extension);
    assertThat(live.rooms().getFirst().services().getFirst().totalAmountCents()).isEqualTo(32800);
    assertThat(live.rooms().getFirst().occupiedBedCount()).isEqualTo(1);
    assertThat(live.rooms().getFirst().availableBedCount()).isEqualTo(1);
  }

  @Test
  void legacyWrappersKeepTheirShapeAndAllLiveEndpointsRemainNoStore() {
    UUID storeId = UUID.randomUUID();
    var context = mock(StoreContextService.class);
    var service = mock(OperationalStateService.class);
    var row = serviceRow((short) 60, "IN_SERVICE", "");
    var room = new OperationalStateService.RoomState(row.roomId(), "001", "Room 1", "IN_SERVICE", null,
        row.startedAt(), 2, 1L, 1L, List.of(row.state(List.of())));
    var state = new OperationalStateService.LiveState("2026-10-03", 0L, 0L, List.of(room), List.of());
    when(context.currentStore("Bearer fixture", storeId.toString())).thenReturn(storeId);
    when(service.live(storeId)).thenReturn(state);
    var controller = new OperationsReportController(null, context, null, null, null, service);
    var liveResponse = new MockHttpServletResponse();
    var roomResponse = new MockHttpServletResponse();
    var technicianResponse = new MockHttpServletResponse();

    assertThat(controller.liveState("Bearer fixture", storeId.toString(), liveResponse)).isSameAs(state);
    var rooms = controller.liveRoomStatus("Bearer fixture", storeId.toString(), roomResponse);
    assertThat(rooms.getFirst().services().getFirst().serviceSessionId()).isEqualTo(row.serviceSessionId());
    assertThat(rooms.getFirst().occupiedBedCount()).isEqualTo(1);
    assertThat(controller.liveTechnicianStatus("Bearer fixture", storeId.toString(), technicianResponse).businessDate())
        .isEqualTo("2026-10-03");
    for (var response : List.of(liveResponse, roomResponse, technicianResponse)) {
      assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store, max-age=0");
    }
  }

  @Test
  void liveStateReadsSessionTotalsAndExtensionRowsFromOneSnapshot() throws Exception {
    var transaction = OperationalStateService.class.getMethod("live", UUID.class).getAnnotation(Transactional.class);

    assertThat(transaction.readOnly()).isTrue();
    assertThat(transaction.isolation()).isEqualTo(Isolation.REPEATABLE_READ);
  }

  private OperationalStateService.ServiceRow serviceRow(short duration, String status, String summary) {
    return new OperationalStateService.ServiceRow(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
        "001-1", "Bed 1", "Main", "QUEUE", duration, summary, status,
        OffsetDateTime.parse("2026-10-03T14:00:00+08:00"),
        OffsetDateTime.parse("2026-10-03T14:00:00+08:00").plusMinutes(duration), "", "18 Main technician", 1L,
        16900, UUID.randomUUID(), "18", "Main technician", LocalDate.of(2026, 10, 3));
  }

  private Extension extension(UUID sessionId, String name, int price, short duration, String time) {
    return new Extension(UUID.randomUUID(), sessionId, UUID.randomUUID(), "32", "Extension technician",
        UUID.randomUUID(), name, price, duration, OffsetDateTime.parse("2026-10-03T" + time + ":00+08:00"));
  }

  @SuppressWarnings("unchecked")
  private <T> void stubQuery(JdbcClient jdbc, String sql, Class<T> type, List<T> rows) {
    var statement = mock(JdbcClient.StatementSpec.class, RETURNS_SELF);
    var result = (JdbcClient.MappedQuerySpec<T>) mock(JdbcClient.MappedQuerySpec.class);
    when(jdbc.sql(sql)).thenReturn(statement);
    when(statement.query(type)).thenReturn(result);
    when(result.list()).thenReturn(rows);
    if (!rows.isEmpty()) when(result.single()).thenReturn(rows.getFirst());
  }

  @Test
  void roomStateTreatsCompletedUnsettledServicesAsOccupiedAndKeepsBedsIndependent() {
    String roomSql = OperationalStateService.roomSql().toLowerCase();
    String serviceSql = OperationalStateService.serviceSql().toLowerCase();

    assertThat(roomSql).contains("then 'pending_payment'");
    assertThat(roomSql).contains("from room_bed active_bed");
    assertThat(roomSql).contains("active_bed.active=true");
    assertThat(roomSql).contains("linked_order.refund_status='full'");
    assertThat(roomSql).contains("when linked_order.status='settled' and linked_order.refund_status='full' then true");
    assertThat(roomSql).contains("when linked_order.status='settled' then false");
    assertThat(serviceSql).contains("when ss.status='completed' then 'completed_unsettled'");
    assertThat(serviceSql).contains("ss.bed_id");
    assertThat(serviceSql).contains("linked_order.status='cancelled'");
    assertThat(serviceSql).contains("then false");
  }

  @Test
  void technicianStateUsesTheSameStoreAndNoClientCacheContract() {
    assertThat(OperationalStateService.technicianSql()).contains(":store");
    assertThat(OperationalStateService.technicianSql()).contains(":businessDate");
  }

  @Test
  void auditAndRepairKeepFullyRefundedButNotCancelledOrdersOnTheirBeds() throws IOException {
    String audit = Files.readString(Path.of("..", "..", "tools", "regression", "operational-state-audit.sql"))
        .toLowerCase().replaceAll("\\s+", "");
    String repair = Files.readString(Path.of("..", "..", "tools", "regression", "operational-state-repair-template.sql"))
        .toLowerCase().replaceAll("\\s+", "");

    assertThat(audit.split("whenlatest_order.order_status='settled'andlatest_order.refund_status='full'thentrue", -1))
        .hasSize(4);
    assertThat(audit).contains("whenlatest_order.order_status='cancelled'then'link_order'")
        .doesNotContain("andnot(latest_order.order_status='settled'andlatest_order.refund_status='full')");
    assertThat(repair).contains("whenlinked_order.status='settled'andlinked_order.refund_status='full'thentrue")
        .contains("whenlinked_order.status='settled'thenfalse");
  }
}
