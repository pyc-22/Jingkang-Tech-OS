package com.chengxin.massage.admin;

import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class StoreContextService {
  public static final UUID DEFAULT_STORE_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
  private final AdminSessionService adminSessions;

  StoreContextService(AdminSessionService adminSessions) { this.adminSessions = adminSessions; }

  public UUID currentStore(String authorization, String requestedStoreId) {
    UUID storeId = DEFAULT_STORE_ID;
    if (requestedStoreId != null && !requestedStoreId.isBlank()) {
      try {
        storeId = UUID.fromString(requestedStoreId);
      } catch (IllegalArgumentException exception) {
        throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST, "Invalid store identifier");
      }
    }
    adminSessions.requireStoreAccess(authorization, storeId);
    return storeId;
  }
}
