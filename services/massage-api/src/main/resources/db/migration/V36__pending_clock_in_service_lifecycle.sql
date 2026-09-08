ALTER TABLE service_session
  DROP CONSTRAINT IF EXISTS service_session_status_check,
  DROP CONSTRAINT IF EXISTS service_session_check1;

ALTER TABLE service_session
  ADD CONSTRAINT service_session_status_check
    CHECK (status IN ('PENDING_CLOCK_IN', 'IN_SERVICE', 'COMPLETED', 'CANCELLED')),
  ADD CONSTRAINT service_session_check1
    CHECK (
      (status IN ('PENDING_CLOCK_IN', 'IN_SERVICE') AND ended_at IS NULL)
      OR
      (status IN ('COMPLETED', 'CANCELLED') AND ended_at IS NOT NULL)
    );

DROP INDEX IF EXISTS service_session_active_technician_idx;
DROP INDEX IF EXISTS service_session_active_room_idx;

CREATE UNIQUE INDEX service_session_active_technician_idx
  ON service_session(tenant_id, store_id, technician_id)
  WHERE status IN ('PENDING_CLOCK_IN', 'IN_SERVICE');

CREATE UNIQUE INDEX service_session_active_room_idx
  ON service_session(tenant_id, store_id, room_id)
  WHERE status IN ('PENDING_CLOCK_IN', 'IN_SERVICE');
