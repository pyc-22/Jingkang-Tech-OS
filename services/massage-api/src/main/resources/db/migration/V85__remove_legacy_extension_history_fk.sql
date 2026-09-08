-- V84 created the replacement SET NULL foreign key, but older databases may
-- still contain the legacy, truncated constraint name. Remove only that
-- duplicate NO ACTION constraint; the V84 SET NULL constraint remains.
ALTER TABLE service_session_duration_change_log
  DROP CONSTRAINT IF EXISTS service_session_duration_chan_service_session_extension_id_fkey;
