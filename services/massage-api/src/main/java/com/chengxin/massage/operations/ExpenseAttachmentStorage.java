package com.chengxin.massage.operations;

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
}
