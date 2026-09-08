ALTER TABLE service_session
  ADD COLUMN clock_type VARCHAR(12) NOT NULL DEFAULT 'QUEUE'
    CHECK (clock_type IN ('QUEUE', 'CALL'));

ALTER TABLE service_session
  DROP CONSTRAINT service_session_planned_duration_minutes_check;

ALTER TABLE service_session
  ADD CONSTRAINT service_session_planned_duration_minutes_check
    CHECK (planned_duration_minutes BETWEEN 15 AND 720);

CREATE TABLE service_session_extension (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  service_session_id UUID NOT NULL REFERENCES service_session(id),
  technician_id UUID NOT NULL REFERENCES technician(id),
  service_item_id UUID NOT NULL REFERENCES service_item(id),
  service_name_snapshot VARCHAR(120) NOT NULL,
  service_price_cents INTEGER NOT NULL CHECK (service_price_cents >= 0),
  planned_duration_minutes SMALLINT NOT NULL CHECK (planned_duration_minutes BETWEEN 15 AND 360),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX service_session_extension_session_idx
  ON service_session_extension(tenant_id, store_id, service_session_id, added_at);
