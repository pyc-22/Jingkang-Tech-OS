ALTER TABLE service_session
  ADD COLUMN technician_confirmed_at TIMESTAMPTZ;

CREATE INDEX service_session_pending_confirmation_idx
  ON service_session(tenant_id, store_id, technician_id, started_at DESC)
  WHERE status = 'IN_SERVICE' AND technician_confirmed_at IS NULL;
