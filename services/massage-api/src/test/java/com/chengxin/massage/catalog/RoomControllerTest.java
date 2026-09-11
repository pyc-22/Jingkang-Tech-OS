package com.chengxin.massage.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class RoomControllerTest {
  @Test
  void cleaningCompletionReplayIsNarrowlyRecognized() {
    assertThat(RoomController.isCleaningCompletionReplay("IDLE", "Cleaning completed")).isTrue();
    assertThat(RoomController.isCleaningCompletionReplay("IDLE", "Manual status change")).isFalse();
    assertThat(RoomController.isCleaningCompletionReplay("CLEANING", "Cleaning completed")).isFalse();
  }
}
