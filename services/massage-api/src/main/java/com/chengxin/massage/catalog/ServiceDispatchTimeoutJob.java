package com.chengxin.massage.catalog;

import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
class ServiceDispatchTimeoutJob {
  private final JdbcClient jdbc;
  private final ServiceDispatchEventService events;

  ServiceDispatchTimeoutJob(JdbcClient jdbc, ServiceDispatchEventService events) {
    this.jdbc = jdbc;
    this.events = events;
  }

  @Scheduled(fixedDelayString = "${massage.dispatch.timeout-scan-ms:30000}")
  @Transactional
  void expireUnacceptedDispatches() {
    List<DueParticipant> due = jdbc.sql("select participant.id participant_id,participant.store_id,participant.service_session_id,participant.technician_id from service_session_participant participant join service_session session on session.id=participant.service_session_id where participant.status='PENDING_ACCEPTANCE' and session.status in ('PENDING_ACCEPTANCE','REASSIGNMENT_REQUIRED') and participant.acceptance_deadline_at is not null and participant.acceptance_deadline_at<=now() order by participant.acceptance_deadline_at limit 100")
      .query(DueParticipant.class).list();
    due.forEach(this::expire);
  }

  @Transactional
  void expire(DueParticipant due) {
    int updated = jdbc.sql("update service_session_participant set status='EXPIRED',timed_out_at=now() where id=:id and status='PENDING_ACCEPTANCE' and acceptance_deadline_at<=now()")
      .param("id", due.participantId()).update();
    if (updated == 0) return;
    jdbc.sql("update service_session set status='REASSIGNMENT_REQUIRED',updated_at=now(),version=version+1 where id=:session and store_id=:store and status='PENDING_ACCEPTANCE'")
      .param("session", due.serviceSessionId()).param("store", due.storeId()).update();
    events.record(due.storeId(), due.serviceSessionId(), due.participantId(), "EXPIRED", due.technicianId(), null,
      null, "Acceptance timed out", null, "System");
  }

  record DueParticipant(UUID participantId, UUID storeId, UUID serviceSessionId, UUID technicianId) {}
}
