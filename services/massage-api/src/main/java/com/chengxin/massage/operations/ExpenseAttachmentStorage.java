package com.chengxin.massage.operations;

import java.awt.AlphaComposite;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ExpenseAttachmentStorage {
  private static final long MAX_FILE_SIZE = 10 * 1024 * 1024;
  private final Path root;

  ExpenseAttachmentStorage(@Value("${massage.expense.storage-dir:data/expense-attachments}") String configuredRoot) {
    try {
      root = Path.of(configuredRoot).toAbsolutePath().normalize();
      Files.createDirectories(root);
    } catch (IOException exception) {
      throw new IllegalStateException("Unable to initialize expense attachment storage", exception);
    }
  }

  StoredFile store(UUID tenantId, UUID storeId, UUID claimId, MultipartFile file) {
    if (file == null || file.isEmpty()) throw badRequest("Attachment file is required");
    if (file.getSize() > MAX_FILE_SIZE) throw badRequest("Attachment file must not exceed 10 MB");
    String contentType = file.getContentType() == null ? "" : file.getContentType().toLowerCase(Locale.ROOT);
    String extension = switch (contentType) {
      case "image/jpeg" -> ".jpg";
      case "image/png" -> ".png";
      case "application/pdf" -> ".pdf";
      default -> throw badRequest("Only JPG, PNG, and PDF attachments are supported");
    };
    String originalName = originalName(file.getOriginalFilename());
    String relative = Path.of(tenantId.toString(), storeId.toString(), claimId.toString(), UUID.randomUUID() + extension).toString();
    Path target = root.resolve(relative).normalize();
    if (!target.startsWith(root)) throw new IllegalStateException("Invalid attachment path");
    try {
      Files.createDirectories(target.getParent());
      try (InputStream input = file.getInputStream()) {
        Files.copy(input, target, StandardCopyOption.REPLACE_EXISTING);
      }
      return new StoredFile(relative, originalName, contentType, file.getSize(), sha256(target));
    } catch (IOException exception) {
      throw new IllegalStateException("Unable to store expense attachment", exception);
    }
  }

  StoredImage storeManagerYueImage(UUID tenantId, UUID storeId, UUID recordId, MultipartFile file, String watermark) {
    if (file == null || file.isEmpty()) throw badRequest("约客截图不能为空");
    String contentType = file.getContentType() == null ? "" : file.getContentType().toLowerCase(Locale.ROOT);
    if (!contentType.equals("image/jpeg") && !contentType.equals("image/png")) {
      throw badRequest("约客截图只支持 JPG 或 PNG");
    }
    StoredFile original = store(tenantId, storeId, recordId, file);
    Path watermarkedTarget = null;
    try {
      BufferedImage source = ImageIO.read(new ByteArrayInputStream(file.getBytes()));
      if (source == null) throw badRequest("约客截图格式无法识别");
      BufferedImage marked = new BufferedImage(source.getWidth(), source.getHeight(), BufferedImage.TYPE_INT_RGB);
      Graphics2D graphics = marked.createGraphics();
      try {
        graphics.drawImage(source, 0, 0, null);
        graphics.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        graphics.setFont(new Font(Font.SANS_SERIF, Font.BOLD, Math.max(14, source.getWidth() / 45)));
        String text = watermark == null || watermark.isBlank() ? "靖康门店绩效凭证" : watermark;
        int padding = Math.max(10, source.getWidth() / 100);
        int textWidth = graphics.getFontMetrics().stringWidth(text);
        int x = Math.max(padding, source.getWidth() - textWidth - padding);
        int y = Math.max(graphics.getFont().getSize() + padding, source.getHeight() - padding);
        graphics.setComposite(AlphaComposite.SrcOver.derive(0.55f));
        graphics.setColor(Color.BLACK);
        graphics.fillRect(x - padding / 2, y - graphics.getFont().getSize(), textWidth + padding, graphics.getFont().getSize() + padding / 2);
        graphics.setComposite(AlphaComposite.SrcOver);
        graphics.setColor(Color.WHITE);
        graphics.drawString(text, x, y);
      } finally {
        graphics.dispose();
      }
      String extension = contentType.equals("image/png") ? ".png" : ".jpg";
      String relative = Path.of(tenantId.toString(), storeId.toString(), recordId.toString(), UUID.randomUUID() + "-watermarked" + extension).toString();
      watermarkedTarget = root.resolve(relative).normalize();
      if (!watermarkedTarget.startsWith(root)) throw new IllegalStateException("Invalid attachment path");
      Files.createDirectories(watermarkedTarget.getParent());
      ByteArrayOutputStream output = new ByteArrayOutputStream();
      if (!ImageIO.write(marked, contentType.equals("image/png") ? "png" : "jpg", output)) {
        throw new IllegalStateException("Unable to encode watermarked attachment");
      }
      Files.write(watermarkedTarget, output.toByteArray());
      return new StoredImage(original.storageKey(), relative, original.originalFilename(), contentType,
          original.fileSizeBytes(), original.sha256(), sha256(watermarkedTarget));
    } catch (IOException exception) {
      cleanupStoredImage(original, watermarkedTarget);
      throw new IllegalStateException("Unable to store watermarked attachment", exception);
    } catch (RuntimeException exception) {
      cleanupStoredImage(original, watermarkedTarget);
      throw exception;
    }
  }

  private void cleanupStoredImage(StoredFile original, Path watermarkedTarget) {
    try { delete(original.storageKey()); } catch (RuntimeException ignored) { }
    if (watermarkedTarget != null) {
      try { Files.deleteIfExists(watermarkedTarget); } catch (IOException ignored) { }
    }
  }

  void delete(String storageKey) {
    if (storageKey == null || storageKey.isBlank()) return;
    Path target = root.resolve(storageKey).normalize();
    if (!target.startsWith(root)) throw new IllegalStateException("Invalid attachment path");
    try {
      Files.deleteIfExists(target);
    } catch (IOException exception) {
      throw new IllegalStateException("Unable to delete expense attachment", exception);
    }
  }

  byte[] read(String storageKey) {
    Path target = target(storageKey);
    try {
      if (!Files.isRegularFile(target)) throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, "Attachment file not found");
      return Files.readAllBytes(target);
    } catch (IOException exception) {
      throw new IllegalStateException("Unable to read expense attachment", exception);
    }
  }

  private Path target(String storageKey) {
    if (storageKey == null || storageKey.isBlank()) throw new IllegalStateException("Invalid attachment path");
    Path target = root.resolve(storageKey).normalize();
    if (!target.startsWith(root)) throw new IllegalStateException("Invalid attachment path");
    return target;
  }

  private String originalName(String value) {
    String name = value == null || value.isBlank() ? "attachment" : Path.of(value).getFileName().toString().trim();
    return name.length() <= 255 ? name : name.substring(name.length() - 255);
  }

  private String sha256(Path path) throws IOException {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      try (InputStream input = Files.newInputStream(path)) {
        byte[] buffer = new byte[8192];
        int read;
        while ((read = input.read(buffer)) >= 0) {
          if (read > 0) digest.update(buffer, 0, read);
        }
      }
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 is not available", exception);
    }
  }

  private org.springframework.web.server.ResponseStatusException badRequest(String message) {
    return new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST, message);
  }

  record StoredFile(String storageKey, String originalFilename, String contentType, long fileSizeBytes, String sha256) {}
  record StoredImage(String originalStorageKey, String watermarkedStorageKey, String originalFilename,
                     String contentType, long fileSizeBytes, String sha256, String watermarkedSha256) {}
}
