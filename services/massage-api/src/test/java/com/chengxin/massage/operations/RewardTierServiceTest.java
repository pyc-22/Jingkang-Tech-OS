package com.chengxin.massage.operations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.admin.StoreContextService;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

class RewardTierServiceTest {
  @Test
  void cashFlowUsesExactCentBoundaries() {
    assertThat(RewardTierService.cashFlow(799_999).rewardCents()).isEqualTo(-2_000);
    assertThat(RewardTierService.cashFlow(800_000).rewardCents()).isEqualTo(2_000);
    assertThat(RewardTierService.cashFlow(1_150_000).rewardCents()).isEqualTo(6_000);
    assertThat(RewardTierService.cashFlow(1_999_999).rewardCents()).isEqualTo(35_000);
    assertThat(RewardTierService.cashFlow(2_000_000).rewardCents()).isEqualTo(40_000);
    assertThat(RewardTierService.cashFlow(2_100_000).rewardCents()).isEqualTo(40_000);
  }

  @Test
  void countMetricsUseLowestMatchingTier() {
    assertThat(RewardTierService.yue(4).rewardCents()).isEqualTo(-1_000);
    assertThat(RewardTierService.yue(5).rewardCents()).isEqualTo(500);
    assertThat(RewardTierService.yue(17).rewardCents()).isEqualTo(10_000);
    assertThat(RewardTierService.bigProject(9).rewardCents()).isEqualTo(-1_000);
    assertThat(RewardTierService.bigProject(10).rewardCents()).isEqualTo(500);
    assertThat(RewardTierService.bigProject(55).rewardCents()).isEqualTo(14_000);
    assertThat(RewardTierService.recharge(0).rewardCents()).isEqualTo(-1_000);
    assertThat(RewardTierService.recharge(1).rewardCents()).isEqualTo(1_000);
    assertThat(RewardTierService.recharge(13).rewardCents()).isEqualTo(35_000);
  }

  @Test
  void totalRewardPreservesPositiveAndNegativeComponents() {
    long total = RewardTierService.cashFlow(799_999).rewardCents()
        + RewardTierService.yue(5).rewardCents()
        + RewardTierService.bigProject(10).rewardCents()
        + RewardTierService.recharge(0).rewardCents();
    assertThat(total).isEqualTo(-2_000);
  }

  @Test
  void invalidYueImageRemovesStoredOriginal(@TempDir Path directory) throws Exception {
    ExpenseAttachmentStorage storage = new ExpenseAttachmentStorage(directory.toString());
    MockMultipartFile file = new MockMultipartFile("file", "invalid.png", "image/png", "not an image".getBytes());

    assertThatThrownBy(() -> storage.storeManagerYueImage(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), file, "test"))
        .hasMessageContaining("约客截图格式无法识别");
    try (var paths = Files.walk(directory)) {
      assertThat(paths.filter(Files::isRegularFile)).isEmpty();
    }
  }

  @Test
  void watermarkKeepsOriginalAndImageDimensions(@TempDir Path directory) throws Exception {
    BufferedImage image = new BufferedImage(640, 480, BufferedImage.TYPE_INT_RGB);
    var graphics = image.createGraphics();
    graphics.setColor(Color.WHITE);
    graphics.fillRect(0, 0, image.getWidth(), image.getHeight());
    graphics.dispose();
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    ImageIO.write(image, "png", output);
    byte[] original = output.toByteArray();
    ExpenseAttachmentStorage storage = new ExpenseAttachmentStorage(directory.toString());

    var stored = storage.storeManagerYueImage(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
        new MockMultipartFile("file", "receipt.png", "image/png", original), "Manager reward proof");

    assertThat(storage.read(stored.originalStorageKey())).isEqualTo(original);
    assertThat(stored.watermarkedSha256()).isNotEqualTo(stored.sha256());
    BufferedImage marked = ImageIO.read(new ByteArrayInputStream(storage.read(stored.watermarkedStorageKey())));
    assertThat(marked.getWidth()).isEqualTo(640);
    assertThat(marked.getHeight()).isEqualTo(480);
  }

  @Nested
  class MultipartEndpoints {
    private final UUID storeId = UUID.randomUUID();
    private final UUID actorId = UUID.randomUUID();
    private final UUID orderId = UUID.randomUUID();
    private final String authorization = "Bearer test-session";
    private final ManagerRewardService rewards = mock(ManagerRewardService.class);
    private final StoreContextService stores = mock(StoreContextService.class);
    private final AdminSessionService sessions = mock(AdminSessionService.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
      when(stores.currentStore(authorization, storeId.toString())).thenReturn(storeId);
      when(sessions.requireAuthenticatedUserId(authorization)).thenReturn(actorId);
      mvc = MockMvcBuilders.standaloneSetup(new ManagerRewardController(rewards, stores, sessions,
          mock(BusinessClockService.class))).build();
    }

    @Test
    void createAcceptsBrowserFormDataUuid() throws Exception {
      MockMultipartFile file = new MockMultipartFile("file", "proof.png", "image/png", new byte[] {1});
      mvc.perform(multipart("/api/v1/manager-rewards/yue").file(file).param("orderId", orderId.toString())
          .header("Authorization", authorization).header("X-Store-Id", storeId))
          .andExpect(status().isOk());
      verify(rewards).createYue(storeId, actorId, orderId, file);
    }

    @Test
    void updateAcceptsBrowserFormDataUuidAndText() throws Exception {
      UUID recordId = UUID.randomUUID();
      mvc.perform(multipart("/api/v1/manager-rewards/yue/{id}", recordId)
          .param("orderId", orderId.toString()).param("customerName", "Walk-in")
          .param("customerPhone", "13800000000").param("note", "Corrected proof")
          .with(request -> { request.setMethod("PUT"); return request; })
          .header("Authorization", authorization).header("X-Store-Id", storeId))
          .andExpect(status().isOk());
      verify(rewards).updateYue(storeId, actorId, recordId, orderId, "Walk-in", "13800000000", "Corrected proof", null);
    }

    @Test
    void createRequiresScreenshot() throws Exception {
      mvc.perform(multipart("/api/v1/manager-rewards/yue").param("orderId", orderId.toString())
          .header("Authorization", authorization).header("X-Store-Id", storeId))
          .andExpect(status().isBadRequest());
    }

    @Test
    void managerAttachmentAlwaysUsesWatermarkedImage() throws Exception {
      UUID recordId = UUID.randomUUID();
      when(rewards.attachment(storeId, recordId, false)).thenReturn(
          new ManagerRewardService.AttachmentDownload(new byte[] {1}, "image/png", "proof.png"));
      mvc.perform(get("/api/v1/manager-rewards/yue/{id}/attachment", recordId).param("original", "true")
          .header("Authorization", authorization).header("X-Store-Id", storeId))
          .andExpect(status().isOk());
      verify(sessions).requirePermission(authorization, "MANAGER_REWARD_VIEW");
      verify(rewards).attachment(storeId, recordId, false);
    }

    @Test
    void adminOriginalRequiresLockPermission() throws Exception {
      doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(sessions)
          .requirePermission(eq(authorization), eq("MANAGER_REWARD_LOCK"));
      mvc.perform(get("/api/v1/admin/manager-rewards/yue/{id}/attachment", UUID.randomUUID())
          .param("storeId", storeId.toString()).param("original", "true").header("Authorization", authorization))
          .andExpect(status().isForbidden());
    }
  }
}
