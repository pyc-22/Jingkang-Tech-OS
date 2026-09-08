DROP INDEX IF EXISTS service_session_participant_active_technician_idx;

CREATE UNIQUE INDEX service_session_participant_in_service_technician_idx
  ON service_session_participant(tenant_id,store_id,technician_id)
  WHERE status='IN_SERVICE';
