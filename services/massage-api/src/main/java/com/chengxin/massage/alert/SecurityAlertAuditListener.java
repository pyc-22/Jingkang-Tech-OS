package com.chengxin.massage.alert;

import com.chengxin.massage.audit.AuditRecordedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
public class SecurityAlertAuditListener {
  private static final Logger LOGGER = LoggerFactory.getLogger(SecurityAlertAuditListener.class);
  private final SecurityAlertService alerts;

  SecurityAlertAuditListener(SecurityAlertService alerts) { this.alerts = alerts; }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onAuditRecorded(AuditRecordedEvent event) {
    try { alerts.evaluate(event.auditId()); }
    catch (RuntimeException exception) { LOGGER.warn("Security alert evaluation failed for audit {}", event.auditId(), exception); }
  }
}
