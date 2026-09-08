ALTER TABLE service_session_duration_change_log
  DROP CONSTRAINT IF EXISTS service_session_duration_change_log_service_session_extension_id_fkey;

ALTER TABLE service_session_duration_change_log
  ADD CONSTRAINT service_session_duration_change_log_service_session_extension_id_fkey
  FOREIGN KEY (service_session_extension_id)
  REFERENCES service_session_extension(id)
  ON DELETE SET NULL;
