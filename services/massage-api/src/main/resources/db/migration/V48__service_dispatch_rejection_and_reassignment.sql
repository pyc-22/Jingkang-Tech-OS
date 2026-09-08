ALTER TABLE service_session
  ADD COLUMN acceptance_deadline_at TIMESTAMPTZ;

ALTER TABLE service_session_participant
  ADD COLUMN acceptance_deadline_at TIMESTAMPTZ,
  ADD COLUMN declined_at TIMESTAMPTZ,
  ADD COLUMN decline_reason VARCHAR(240),
  ADD COLUMN timed_out_at TIMESTAMPTZ;

ALTER TABLE service_session
  DROP CONSTRAINT IF EXISTS service_session_status_check,
  DROP CONSTRAINT IF EXISTS service_session_timing_check;

ALTER TABLE service_session
  ADD CONSTRAINT service_session_status_check
    CHECK (status IN ('PENDING_ACCEPTANCE', 'ACCEPTED', 'REASSIGNMENT_REQUIRED', 'IN_SERVICE', 'COMPLETED', 'CANCELLED')),
  ADD CONSTRAINT service_session_timing_check
    CHECK (
      (status IN ('PENDING_ACCEPTANCE', 'ACCEPTED', 'REASSIGNMENT_REQUIRED') AND started_at IS NULL AND expected_end_at IS NULL AND ended_at IS NULL)
      OR
      (status = 'IN_SERVICE' AND started_at IS NOT NULL AND expected_end_at IS NOT NULL AND ended_at IS NULL)
      OR
      (status IN ('COMPLETED', 'CANCELLED') AND started_at IS NOT NULL AND expected_end_at IS NOT NULL AND ended_at IS NOT NULL)
    );

ALTER TABLE service_session_participant
  DROP CONSTRAINT IF EXISTS service_session_participant_status_check,
  DROP CONSTRAINT IF EXISTS service_session_participant_check;

ALTER TABLE service_session_participant
  ADD CONSTRAINT service_session_participant_status_check
    CHECK (status IN ('PENDING_ACCEPTANCE', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'IN_SERVICE', 'COMPLETED', 'CANCELLED')),
  ADD CONSTRAINT service_session_participant_check
    CHECK (
      (status IN ('PENDING_ACCEPTANCE', 'ACCEPTED', 'REJECTED', 'EXPIRED') AND service_started_at IS NULL AND service_ended_at IS NULL)
      OR (status = 'IN_SERVICE' AND service_started_at IS NOT NULL AND service_ended_at IS NULL)
      OR (status IN ('COMPLETED', 'CANCELLED') AND service_started_at IS NOT NULL AND service_ended_at IS NOT NULL)
    );

DROP INDEX IF EXISTS service_session_active_room_idx;
CREATE UNIQUE INDEX service_session_active_room_idx
  ON service_session(tenant_id, store_id, room_id)
  WHERE status IN ('PENDING_ACCEPTANCE', 'ACCEPTED', 'REASSIGNMENT_REQUIRED', 'IN_SERVICE');

CREATE TABLE service_dispatch_event (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  service_session_id UUID NOT NULL REFERENCES service_session(id),
  participant_id UUID REFERENCES service_session_participant(id),
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('ASSIGNED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REASSIGNED')),
  from_technician_id UUID REFERENCES technician(id),
  to_technician_id UUID REFERENCES technician(id),
  acceptance_deadline_at TIMESTAMPTZ,
  reason VARCHAR(240),
  actor_user_id UUID REFERENCES app_user(id),
  actor_name_snapshot VARCHAR(120),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX service_dispatch_event_session_idx
  ON service_dispatch_event(tenant_id, store_id, service_session_id, occurred_at, id);

CREATE INDEX service_session_participant_acceptance_deadline_idx
  ON service_session_participant(store_id, acceptance_deadline_at)
  WHERE status='PENDING_ACCEPTANCE' AND acceptance_deadline_at IS NOT NULL;
