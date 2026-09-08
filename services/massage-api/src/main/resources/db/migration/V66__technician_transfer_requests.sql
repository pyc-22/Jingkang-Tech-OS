ALTER TABLE service_dispatch_event
  DROP CONSTRAINT IF EXISTS service_dispatch_event_event_type_check;

ALTER TABLE service_dispatch_event
  ADD CONSTRAINT service_dispatch_event_event_type_check
    CHECK (event_type IN ('ASSIGNED','ACCEPTED','REJECTED','EXPIRED','REASSIGNED','TRANSFER_REQUESTED','TRANSFER_APPROVED','TRANSFER_REJECTED'));

CREATE TABLE service_transfer_request (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  service_session_id UUID NOT NULL REFERENCES service_session(id),
  from_participant_id UUID NOT NULL REFERENCES service_session_participant(id),
  from_technician_id UUID NOT NULL REFERENCES technician(id),
  to_technician_id UUID NOT NULL REFERENCES technician(id),
  reason VARCHAR(240) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED')),
  review_note VARCHAR(240),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id UUID REFERENCES app_user(id),
  reviewed_by_name_snapshot VARCHAR(120)
);

CREATE UNIQUE INDEX service_transfer_request_pending_idx
  ON service_transfer_request(service_session_id, from_participant_id)
  WHERE status='REQUESTED';
CREATE INDEX service_transfer_request_store_status_idx
  ON service_transfer_request(store_id, status, requested_at DESC);
