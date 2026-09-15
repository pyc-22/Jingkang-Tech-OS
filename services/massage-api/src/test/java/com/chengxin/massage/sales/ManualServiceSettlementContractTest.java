package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class ManualServiceSettlementContractTest {
  private static final Path SOURCE = Path.of(
    "src/main/java/com/chengxin/massage/sales/SalesOrderController.java");

  @Test
  void settlementAcceptsAndValidatesManualServiceAttribution() throws Exception {
    String source = Files.readString(SOURCE);

    assertThat(source)
      .contains("record LineInput(UUID serviceItemId, UUID serviceSessionId, Short durationMinutes, String clockType, UUID roomId")
      .contains("List<@Valid ManualTechnicianAllocation> technicians")
      .contains("normalizeManualAllocations(storeId, input.technicians())")
      .contains("一个项目最多选择 4 位技师")
      .contains("同一项目的技师分配比例必须合计 100%")
      .contains("所选房间不可用、非空闲或不属于当前门店")
      .contains("Set.of(\"QUEUE\", \"CALL\", \"SELECTED\", \"BOOKED_QUEUE\", \"BOOKED_CALL\")");
  }

  @Test
  void attributedManualLinesUseTheNormalServiceAndCommissionPath() throws Exception {
    String source = Files.readString(SOURCE);

    assertThat(source)
      .contains("materializeManualLine(storeId, line, settledAt, businessDate)")
      .contains("insert into service_session(")
      .contains("'COMPLETED',:note,:clockType")
      .contains("insert into service_session_participant(")
      .contains("'COMPLETED',:started,:started,:started,:ended")
      .contains("linkServiceSession(storeId, orderId, orderLineId, materialized.serviceSessionId())")
      .contains("createCommissionRecords(storeId, orderId, orderLineId, orderNo, settlementNo, materialized.serviceSessionId()")
      .contains("updateLinkedServiceRoomStates(storeId, materializedLines, orderNo)");
  }

  @Test
  void manualSessionsMayOmitRoomsWithoutDisappearingFromHistory() throws Exception {
    String migration = Files.readString(Path.of(
      "src/main/resources/db/migration/V93__allow_manual_service_sessions_without_room.sql"));
    String sales = Files.readString(SOURCE);
    String mobile = Files.readString(Path.of(
      "src/main/java/com/chengxin/massage/mobile/TechnicianMobileController.java"));

    assertThat(migration).contains("ALTER COLUMN room_id DROP NOT NULL");
    assertThat(sales).contains("left join room room on room.id=session.room_id")
      .contains("left join room r on r.id=ss.room_id");
    assertThat(mobile).contains("left join room on room.id=session.room_id")
      .contains("from service_session ss left join room r on r.id=ss.room_id");
  }
}
