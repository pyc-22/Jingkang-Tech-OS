-- Preserve existing service orders while removing their device-dependent pending state.
DELETE FROM room_status_event WHERE source = 'CLOCK_DEVICE';

WITH activated AS (
  UPDATE service_session
  SET status = 'IN_SERVICE',
      technician_confirmed_at = COALESCE(technician_confirmed_at, started_at),
      updated_at = now(),
      version = version + 1
  WHERE status = 'PENDING_CLOCK_IN'
  RETURNING tenant_id, store_id, room_id, service_name_snapshot
)
INSERT INTO room_status_event(id, tenant_id, store_id, room_id, status, reason, source)
SELECT md5(random()::text || clock_timestamp()::text || room_id::text)::uuid,
       tenant_id,
       store_id,
       room_id,
       'IN_SERVICE',
       'Active service retained after device removal: ' || service_name_snapshot,
       'SYSTEM_MIGRATION'
FROM activated;

ALTER TABLE service_session
  DROP CONSTRAINT IF EXISTS service_session_status_check,
  DROP CONSTRAINT IF EXISTS service_session_check1;

ALTER TABLE service_session
  ADD CONSTRAINT service_session_status_check
    CHECK (status IN ('IN_SERVICE', 'COMPLETED', 'CANCELLED')),
  ADD CONSTRAINT service_session_check1
    CHECK (
      (status = 'IN_SERVICE' AND ended_at IS NULL)
      OR
      (status IN ('COMPLETED', 'CANCELLED') AND ended_at IS NOT NULL)
    );

DROP INDEX IF EXISTS service_session_active_technician_idx;
DROP INDEX IF EXISTS service_session_active_room_idx;

CREATE UNIQUE INDEX service_session_active_technician_idx
  ON service_session(tenant_id, store_id, technician_id)
  WHERE status = 'IN_SERVICE';

CREATE UNIQUE INDEX service_session_active_room_idx
  ON service_session(tenant_id, store_id, room_id)
  WHERE status = 'IN_SERVICE';

UPDATE security_alert
SET source_audit_id = NULL
WHERE source_audit_id IN (
  SELECT id FROM audit_log
  WHERE module_code = 'CLOCK_DEVICE'
     OR entity_type IN ('clock_device', 'clock_device_event')
);

DELETE FROM security_alert_evidence
WHERE audit_log_id IN (
  SELECT id FROM audit_log
  WHERE module_code = 'CLOCK_DEVICE'
     OR entity_type IN ('clock_device', 'clock_device_event')
);

DELETE FROM audit_log
WHERE module_code = 'CLOCK_DEVICE'
   OR entity_type IN ('clock_device', 'clock_device_event');

DROP TABLE IF EXISTS service_session_clock_reminder;
DROP TABLE IF EXISTS clock_device_event;
DROP TABLE IF EXISTS clock_device;

DELETE FROM role_permission
WHERE permission_id IN (
  SELECT id FROM permission
  WHERE code IN ('CLOCK_DEVICE_MANAGE', 'CLOCK_DEVICE_EVENT_VIEW')
);

DELETE FROM permission
WHERE code IN ('CLOCK_DEVICE_MANAGE', 'CLOCK_DEVICE_EVENT_VIEW');

DROP INDEX IF EXISTS technician_store_wrist_card_no_idx;
ALTER TABLE technician DROP COLUMN IF EXISTS wrist_card_no;
