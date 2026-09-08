CREATE TABLE service_reservation (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  room_id UUID NOT NULL REFERENCES room(id),
  technician_id UUID REFERENCES technician(id),
  service_item_id UUID REFERENCES service_item(id),
  reservation_type VARCHAR(20) NOT NULL CHECK (reservation_type IN ('BOOKED_QUEUE','BOOKED_CALL')),
  status VARCHAR(20) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','DISPATCHED','CANCELLED')),
  service_name_snapshot VARCHAR(120),
  service_price_cents INTEGER CHECK (service_price_cents IS NULL OR service_price_cents >= 0),
  planned_duration_minutes SMALLINT CHECK (planned_duration_minutes IS NULL OR planned_duration_minutes BETWEEN 15 AND 360),
  note VARCHAR(240),
  created_by_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_by_name_snapshot VARCHAR(120),
  dispatched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  CHECK (reservation_type <> 'BOOKED_CALL' OR technician_id IS NOT NULL),
  CHECK (status <> 'DISPATCHED' OR dispatched_at IS NOT NULL)
);
CREATE INDEX service_reservation_store_status_idx ON service_reservation(store_id,status,created_at DESC);
CREATE INDEX service_reservation_technician_status_idx ON service_reservation(store_id,technician_id,status,created_at);
CREATE UNIQUE INDEX service_reservation_pending_room_uq
  ON service_reservation(store_id,room_id) WHERE status='WAITING';

ALTER TABLE service_session DROP CONSTRAINT IF EXISTS service_session_clock_type_check;
ALTER TABLE service_session ADD CONSTRAINT service_session_clock_type_check
  CHECK (clock_type IN ('QUEUE','CALL','SELECTED','BOOKED_QUEUE','BOOKED_CALL'));
