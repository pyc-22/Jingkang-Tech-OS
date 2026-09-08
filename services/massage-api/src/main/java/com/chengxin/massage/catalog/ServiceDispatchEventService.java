package com.chengxin.massage.catalog;

import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class ServiceDispatchEventService {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;

  ServiceDispatchEventService(JdbcClient jdbc) { this.jdbc = jdbc; }

  public void record(UUID storeId, UUID sessionId, UUID participantId, String eventType,
                     UUID fromTechnicianId, UUID toTechnicianId, OffsetDateTime deadline,
                     String reason, UUID actorUserId, String actorName) {
    jdbc.sql("insert into service_dispatch_event(id,tenant_id,store_id,service_session_id,participant_id,event_type,from_technician_id,to_technician_id,acceptance_deadline_at,reason,actor_user_id,actor_name_snapshot) values(:id,:tenant,:store,:session,:participant,:type,:from,:to,:deadline,:reason,:actor,:name)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("session", sessionId)
      .param("participant", participantId).param("type", eventType).param("from", fromTechnicianId).param("to", toTechnicianId)
      .param("deadline", deadline).param("reason", reason).param("actor", actorUserId).param("name", actorName).update();
  }
}
