package com.chengxin.massage.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class P0ConflictRegressionTest {
  @Test
  void roomCommandsSerializeOnTheRoomAndUseStableEventOrdering() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/catalog/RoomController.java"));

    assertThat(source).contains("from room where id=:id and store_id=:store for update");
    assertThat(source).contains("order by occurred_at desc,id desc");
    assertThat(source).contains("isCleaningCompletionReplay");
    assertThat(source).contains("'PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE'");
  }

  @Test
  void clockInSerializesTechniciansAndMapsUniqueConstraintRaces() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/catalog/ServiceSessionController.java"));

    assertThat(source).contains("from technician where id=:id and store_id=:store for update");
    assertThat(source).contains("DataIntegrityViolationException");
    assertThat(source).contains("Clock-in database conflict");
    assertThat(source).doesNotContain("for update skip locked");
  }

  @Test
  void roomOccupancyChecksUseEveryDatabaseOccupyingState() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/catalog/RoomController.java"));

    assertThat(source).contains("'PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE'");
  }

  @Test
  void cleaningCompletionProtectsCurrentRoomStateBeforeTreatingARequestAsReplay() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/catalog/RoomController.java"));
    String method = source.substring(source.indexOf("void completeCleaning"), source.indexOf("void confirmPayment"));

    assertThat(method.indexOf("if (!room.active())")).isLessThan(method.indexOf("boolean hasActiveService"));
    assertThat(method.indexOf("boolean hasActiveService")).isLessThan(method.indexOf("isCleaningCompletionReplay"));
    assertThat(method.indexOf("isCleaningCompletionReplay")).isLessThan(method.indexOf("if (!\"CLEANING\".equals"));
  }

  @Test
  void everyRoomStatusWriterLocksTheRoomAndUsesStatementTime() throws Exception {
    String session = Files.readString(Path.of("src/main/java/com/chengxin/massage/catalog/ServiceSessionController.java"));
    String mobile = Files.readString(Path.of("src/main/java/com/chengxin/massage/mobile/TechnicianMobileController.java"));
    String reservation = Files.readString(Path.of("src/main/java/com/chengxin/massage/catalog/ServiceReservationController.java"));
    String transfer = Files.readString(Path.of("src/main/java/com/chengxin/massage/catalog/ServiceRoomTransferController.java"));
    String sales = Files.readString(Path.of("src/main/java/com/chengxin/massage/sales/SalesOrderController.java"));

    assertThat(session).contains("select id from room where id=:room and store_id=:store for update");
    assertThat(mobile).contains("roomStates.record(");
    assertThat(reservation).contains("select id from room where id=:room and store_id=:store for update");
    assertThat(transfer).contains("roomStates.record(");
    assertThat(sales).contains("order by id for update").contains("source,occurred_at").contains("clock_timestamp()");
    assertThat(session).contains("roomStates.record(");
    assertThat(mobile).contains("roomStates.record(");
    assertThat(Files.readString(Path.of("src/main/java/com/chengxin/massage/catalog/RoomStateService.java")))
      .contains("for update").contains("source,occurred_at").contains("clock_timestamp()");
    assertThat(reservation).contains("source,occurred_at").contains("clock_timestamp()");
  }

  @Test
  void roomTransfersUseBedCapacityAndReservePendingTargets() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/catalog/ServiceRoomTransferController.java"));

    assertThat(source).contains("ensureRoomCapacity(storeId, targetRoomId, pendingTransferCount(storeId, targetRoomId))");
    assertThat(source).contains("pendingTransferCountExcluding(storeId, transfer.toRoomId(), transfer.id())");
    assertThat(source).contains("select count(*) from room_bed where store_id=:store and room_id=:room and active=true");
    assertThat(source).contains("occupied + pendingTransferReservations >= capacity");
    assertThat(source).contains("limit 1 offset :reserved for update of b");
    assertThat(source).contains("acceptsAnotherService");
  }

  @Test
  void roomStateRecomputesMultiBedOccupancyAfterAServiceMoves() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/catalog/RoomStateService.java"));

    assertThat(source).contains("status='IN_SERVICE'");
    assertThat(source).contains("if (occupancy.inService()) status = \"IN_SERVICE\";");
    assertThat(source).contains("else if (occupancy.pending()");
  }

  @Test
  void technicianReplacementStaysInOneSessionAndSettlementIsIdempotent() throws Exception {
    String participant = Files.readString(Path.of("src/main/java/com/chengxin/massage/catalog/ServiceParticipantController.java"));
    String sales = Files.readString(Path.of("src/main/java/com/chengxin/massage/sales/SalesOrderController.java"));

    assertThat(participant).contains("status='COMPLETED',service_ended_at=:ended");
    assertThat(participant).contains("participation_type,allocation_bp,status,joined_at,accepted_at,service_started_at,replaced_participant_id");
    assertThat(participant).contains("replaced_participant_id");
    assertThat(sales).contains("findExistingSettledOrder(storeId, input.lines())");
    assertThat(sales).contains("where link.service_session_id=:session and linked_order.status <> 'CANCELLED' and linked_order.refund_status <> 'FULL'");
    assertThat(sales).contains("validateSettlementParticipants(participants)");
  }

  @Test
  void roomStatusReadsUseEventIdAsStableTieBreaker() throws Exception {
    String mobile = Files.readString(Path.of("src/main/java/com/chengxin/massage/mobile/TechnicianMobileController.java"));
    String operations = Files.readString(Path.of("src/main/java/com/chengxin/massage/operations/OperationsReportController.java"));
    assertThat(mobile).contains("order by event.occurred_at desc,event.id desc limit 1");
    assertThat(operations).contains("order by event.occurred_at desc,event.id desc limit 1");
  }

  @Test
  void duplicateOfflineOperationWaitsForTheFirstReceiptInsteadOfImmediatelyConflicting() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/admin/OfflineOperationIdempotencyFilter.java"));

    assertThat(source).contains("transaction.executeWithoutResult");
    assertThat(source).contains("on conflict do nothing");
    assertThat(source).contains("status.setRollbackOnly()");
    assertThat(source).contains("X-Offline-Operation-Replayed");
    assertThat(source).contains("existing.requestHash()").contains("existing.userId()").contains("existing.storeId()");
  }

  @Test
  void historicalBackfillUsesTheSharedOfflineIdempotencyFilter() throws Exception {
    String source = Files.readString(Path.of(
        "src/main/java/com/chengxin/massage/admin/OfflineOperationIdempotencyFilter.java"));
    assertThat(source).contains("path.equals(\"/api/v1/sales-orders/historical-backfill\")");
  }
}
