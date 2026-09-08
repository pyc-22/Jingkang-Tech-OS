ALTER TABLE service_session
  ADD COLUMN void_reason VARCHAR(240),
  ADD COLUMN voided_at TIMESTAMPTZ,
  ADD COLUMN voided_by UUID REFERENCES app_user(id);

ALTER TABLE service_session
  DROP CONSTRAINT IF EXISTS service_session_status_check,
  DROP CONSTRAINT IF EXISTS service_session_timing_check;

ALTER TABLE service_session
  ADD CONSTRAINT service_session_status_check
    CHECK (status IN ('PENDING_ACCEPTANCE', 'ACCEPTED', 'REASSIGNMENT_REQUIRED', 'IN_SERVICE', 'COMPLETED', 'CANCELLED', 'VOIDED')),
  ADD CONSTRAINT service_session_timing_check
    CHECK (
      (status IN ('PENDING_ACCEPTANCE', 'ACCEPTED', 'REASSIGNMENT_REQUIRED') AND started_at IS NULL AND expected_end_at IS NULL AND ended_at IS NULL)
      OR (status = 'IN_SERVICE' AND started_at IS NOT NULL AND expected_end_at IS NOT NULL AND ended_at IS NULL)
      OR (status IN ('COMPLETED', 'CANCELLED') AND started_at IS NOT NULL AND expected_end_at IS NOT NULL AND ended_at IS NOT NULL)
      OR (status = 'VOIDED' AND ((started_at IS NULL AND expected_end_at IS NULL AND ended_at IS NULL) OR (started_at IS NOT NULL AND expected_end_at IS NOT NULL AND ended_at IS NOT NULL)))
    ),
  ADD CONSTRAINT service_session_void_metadata_check
    CHECK ((status = 'VOIDED' AND void_reason IS NOT NULL AND voided_at IS NOT NULL AND voided_by IS NOT NULL) OR (status <> 'VOIDED' AND void_reason IS NULL AND voided_at IS NULL AND voided_by IS NULL));

ALTER TABLE service_session_participant
  DROP CONSTRAINT IF EXISTS service_session_participant_status_check,
  DROP CONSTRAINT IF EXISTS service_session_participant_check;

ALTER TABLE service_session_participant
  ADD CONSTRAINT service_session_participant_status_check
    CHECK (status IN ('PENDING_ACCEPTANCE','ACCEPTED','REJECTED','EXPIRED','IN_SERVICE','COMPLETED','CANCELLED','VOIDED')),
  ADD CONSTRAINT service_session_participant_check
    CHECK (
      (status IN ('PENDING_ACCEPTANCE','ACCEPTED','REJECTED','EXPIRED') AND service_started_at IS NULL AND service_ended_at IS NULL)
      OR (status = 'IN_SERVICE' AND service_started_at IS NOT NULL AND service_ended_at IS NULL)
      OR (status IN ('COMPLETED','CANCELLED') AND service_started_at IS NOT NULL AND service_ended_at IS NOT NULL)
      OR (status = 'VOIDED' AND ((service_started_at IS NULL AND service_ended_at IS NULL) OR (service_started_at IS NOT NULL AND service_ended_at IS NOT NULL)))
    );

CREATE INDEX service_session_voided_idx ON service_session(tenant_id, store_id, voided_at DESC) WHERE status = 'VOIDED';
