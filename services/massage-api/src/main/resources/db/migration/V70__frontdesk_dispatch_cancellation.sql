ALTER TABLE service_session
  DROP CONSTRAINT IF EXISTS service_session_status_check,
  DROP CONSTRAINT IF EXISTS service_session_timing_check;

ALTER TABLE service_session
  ADD CONSTRAINT service_session_status_check
    CHECK (status IN ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE','COMPLETED','CANCELLED','VOIDED')),
  ADD CONSTRAINT service_session_timing_check
    CHECK (
      (status IN ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED') AND started_at IS NULL AND expected_end_at IS NULL AND ended_at IS NULL)
      OR (status = 'IN_SERVICE' AND started_at IS NOT NULL AND expected_end_at IS NOT NULL AND ended_at IS NULL)
      OR (status IN ('COMPLETED','CANCELLED') AND started_at IS NOT NULL AND expected_end_at IS NOT NULL AND ended_at IS NOT NULL)
      OR (status = 'VOIDED' AND ((started_at IS NULL AND expected_end_at IS NULL AND ended_at IS NULL) OR (started_at IS NOT NULL AND expected_end_at IS NOT NULL AND ended_at IS NOT NULL)))
    );

ALTER TABLE service_session_participant
  DROP CONSTRAINT IF EXISTS service_session_participant_check;

ALTER TABLE service_session_participant
  ADD CONSTRAINT service_session_participant_check
    CHECK (
      (status IN ('PENDING_ACCEPTANCE','ACCEPTED','REJECTED','EXPIRED') AND service_started_at IS NULL AND service_ended_at IS NULL)
      OR (status = 'IN_SERVICE' AND service_started_at IS NOT NULL AND service_ended_at IS NULL)
      OR (status = 'COMPLETED' AND service_started_at IS NOT NULL AND service_ended_at IS NOT NULL)
      OR (status = 'CANCELLED' AND ((service_started_at IS NULL AND service_ended_at IS NULL) OR (service_started_at IS NOT NULL AND service_ended_at IS NOT NULL)))
      OR (status = 'VOIDED' AND ((service_started_at IS NULL AND service_ended_at IS NULL) OR (service_started_at IS NOT NULL AND service_ended_at IS NOT NULL)))
    );

ALTER TABLE service_dispatch_event
  DROP CONSTRAINT IF EXISTS service_dispatch_event_event_type_check;

ALTER TABLE service_dispatch_event
  ADD CONSTRAINT service_dispatch_event_event_type_check
    CHECK (event_type IN ('ASSIGNED','ACCEPTED','REJECTED','EXPIRED','REASSIGNED','DISPATCH_CANCELLED','TRANSFER_REQUESTED','TRANSFER_APPROVED','TRANSFER_REJECTED'));

DROP INDEX IF EXISTS service_session_active_room_idx;
CREATE UNIQUE INDEX service_session_active_room_idx
  ON service_session(tenant_id,store_id,room_id)
  WHERE status IN ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE');
