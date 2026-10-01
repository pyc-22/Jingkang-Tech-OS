package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ManagerRewardOwnershipTest {
  private final UUID firstId = UUID.randomUUID();
  private final UUID secondId = UUID.randomUUID();
  private final ManagerRewardService.ManagerIdentity first =
      new ManagerRewardService.ManagerIdentity(firstId, "First", "NOT_REQUIRED", false);
  private final ManagerRewardService.ManagerIdentity primary =
      new ManagerRewardService.ManagerIdentity(secondId, "Primary", "NOT_REQUIRED", true);

  @Test
  void manualAssignmentWinsOverPrimaryWithoutAttendance() {
    assertThat(ManagerRewardService.preferredManager(List.of(first, primary), firstId)).contains(first);
  }

  @Test
  void primaryWinsWhenNoValidManualAssignment() {
    assertThat(ManagerRewardService.preferredManager(List.of(first, primary), null)).contains(primary);
    assertThat(ManagerRewardService.preferredManager(List.of(first, primary), UUID.randomUUID())).contains(primary);
  }

  @Test
  void soleManagerIsAutomaticAndAmbiguousStoreNeedsConfiguration() {
    assertThat(ManagerRewardService.preferredManager(List.of(first), null)).contains(first);
    assertThat(ManagerRewardService.preferredManager(List.of(first,
        new ManagerRewardService.ManagerIdentity(secondId, "Second", "PRESENT", false)), null)).isEmpty();
    assertThat(ManagerRewardService.preferredManager(List.of(), null)).isEmpty();
  }

  @Test
  void noAttendanceCanBePersistedInAssignmentAndMonthSnapshot() throws Exception {
    String migration = Files.readString(Path.of("src/main/resources/db/migration/V106__store_primary_manager.sql"));
    String service = Files.readString(Path.of("src/main/java/com/chengxin/massage/operations/ManagerRewardService.java"));
    assertThat(migration).contains("manager_reward_day_assignment_attendance_status_check")
        .contains("manager_reward_month_lock_day_attendance_status_check");
    assertThat(migration.split("'NOT_REQUIRED'", -1)).hasSize(3);
    assertThat(service).contains("case when a.status in ('PRESENT','LATE','COMPLETED','LEFT_EARLY') then a.status else 'NOT_REQUIRED' end attendance_status");
  }

  @Test
  void dailyYueCountRemainsStoreWideWhenPrimaryManagerChanges() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/operations/ManagerRewardService.java"));
    assertThat(source).contains("countYue(storeId, date)");
    assertThat(source).doesNotContain("and manager_user_id=:manager");
  }
}
