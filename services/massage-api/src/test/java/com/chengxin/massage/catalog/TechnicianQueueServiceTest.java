package com.chengxin.massage.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class TechnicianQueueServiceTest {
  @Test
  void movesOnlyQueueServiceParticipantsToTheTailInTheirExistingOrder() {
    assertThat(TechnicianQueueService.rotatedOrder(List.of("A", "B", "C", "D"), Set.of("B", "D")))
      .containsExactly("A", "C", "B", "D");
  }

  @Test
  void leavesTheQueueUntouchedWhenNoParticipantIsMoved() {
    assertThat(TechnicianQueueService.rotatedOrder(List.of("A", "B"), Set.of()))
      .containsExactly("A", "B");
  }

  @Test
  void rebuildsLockedQueueWithoutTemporaryOffsetUpdates() throws Exception {
    String source = java.nio.file.Files.readString(java.nio.file.Path.of(
      "src/main/java/com/chengxin/massage/catalog/TechnicianQueueService.java"))
      .replaceAll("\\s+", " ");

    assertThat(source).doesNotContain("queue_position=queue_position+");
    assertThat(source).contains("delete from technician_queue_position where queue_day_id=:day");
    assertThat(source).contains("insert into technician_queue_position");
    assertThat(source.indexOf("delete from technician_queue_position where queue_day_id=:day"))
      .isLessThan(source.indexOf("insert into technician_queue_position", source.indexOf("private void rewritePositions")));
  }

  @Test
  void preservesParticipantOrderWhenMovingSeveralTechniciansToTheTail() {
    assertThat(TechnicianQueueService.rotatedOrder(List.of("15", "20", "24", "27", "12", "19"), Set.of("15", "24")))
      .containsExactly("20", "27", "12", "19", "15", "24");
  }
}
