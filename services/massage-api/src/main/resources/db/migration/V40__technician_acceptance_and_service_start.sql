ALTER TABLE service_session
  ALTER COLUMN started_at DROP NOT NULL,
  ALTER COLUMN expected_end_at DROP NOT NULL;

ALTER TABLE service_session
  DROP CONSTRAINT IF EXISTS service_session_status_check,
  DROP CONSTRAINT IF EXISTS service_session_check,
  DROP CONSTRAINT IF EXISTS service_session_check1,
  DROP CONSTRAINT IF EXISTS service_session_timing_check;

ALTER TABLE service_session
  ADD CONSTRAINT service_session_status_check
    CHECK (status IN ('PENDING_ACCEPTANCE', 'ACCEPTED', 'IN_SERVICE', 'COMPLETED', 'CANCELLED')),
  ADD CONSTRAINT service_session_timing_check
    CHECK (
      (status IN ('PENDING_ACCEPTANCE', 'ACCEPTED') AND started_at IS NULL AND expected_end_at IS NULL AND ended_at IS NULL)
      OR
      (status = 'IN_SERVICE' AND started_at IS NOT NULL AND expected_end_at IS NOT NULL AND ended_at IS NULL)
      OR
      (status IN ('COMPLETED', 'CANCELLED') AND started_at IS NOT NULL AND expected_end_at IS NOT NULL AND ended_at IS NOT NULL)
    ),
  ADD CONSTRAINT service_session_expected_end_check
    CHECK (expected_end_at IS NULL OR expected_end_at > started_at);

DROP INDEX IF EXISTS service_session_active_technician_idx;
DROP INDEX IF EXISTS service_session_active_room_idx;

CREATE UNIQUE INDEX service_session_active_technician_idx
  ON service_session(tenant_id, store_id, technician_id)
  WHERE status IN ('PENDING_ACCEPTANCE', 'ACCEPTED', 'IN_SERVICE');

CREATE UNIQUE INDEX service_session_active_room_idx
  ON service_session(tenant_id, store_id, room_id)
  WHERE status IN ('PENDING_ACCEPTANCE', 'ACCEPTED', 'IN_SERVICE');
