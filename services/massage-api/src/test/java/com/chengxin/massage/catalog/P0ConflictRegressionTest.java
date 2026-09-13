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
    assertThat(mobile).contains("select id from room where id=:room and store_id=:store for update");
    assertThat(reservation).contains("select id from room where id=:room and store_id=:store for update");
    assertThat(transfer).contains("source,occurred_at").contains("clock_timestamp()");
    assertThat(sales).contains("order by id for update").contains("source,occurred_at").contains("clock_timestamp()");
    assertThat(session).contains("source,occurred_at").contains("clock_timestamp()");
    assertThat(mobile).contains("source,occurred_at").contains("clock_timestamp()");
    assertThat(reservation).contains("source,occurred_at").contains("clock_timestamp()");
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

    assertThat(source).contains("PROCESSING_WAIT_ATTEMPTS");
    assertThat(source).contains("Thread.sleep(PROCESSING_WAIT_MILLIS)");
    assertThat(source).contains("if (current == null) return false");
    assertThat(source).contains("X-Offline-Operation-Replayed");
    assertThat(source).contains("Retry-After");
    assertThat(source).contains("SC_SERVICE_UNAVAILABLE");
  }

  @Test
  void historicalBackfillUsesTheSharedOfflineIdempotencyFilter() throws Exception {
    String source = Files.readString(Path.of(
        "src/main/java/com/chengxin/massage/admin/OfflineOperationIdempotencyFilter.java"));
    assertThat(source).contains("path.equals(\"/api/v1/sales-orders/historical-backfill\")");
  }
}
