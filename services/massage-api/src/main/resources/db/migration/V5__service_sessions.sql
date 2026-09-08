CREATE TABLE service_session (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  technician_id UUID NOT NULL REFERENCES technician(id),
  room_id UUID NOT NULL REFERENCES room(id),
  bed_id UUID REFERENCES room_bed(id),
  service_item_id UUID NOT NULL REFERENCES service_item(id),
  service_name_snapshot VARCHAR(120) NOT NULL,
  service_price_cents INTEGER NOT NULL CHECK (service_price_cents >= 0),
  planned_duration_minutes SMALLINT NOT NULL CHECK (planned_duration_minutes BETWEEN 15 AND 360),
  started_at TIMESTAMPTZ NOT NULL,
  expected_end_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL CHECK (status IN ('IN_SERVICE','COMPLETED','CANCELLED')),
  note VARCHAR(240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  CHECK (expected_end_at > started_at),
  CHECK ((status = 'IN_SERVICE' AND ended_at IS NULL) OR (status <> 'IN_SERVICE' AND ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX service_session_active_technician_idx ON service_session(tenant_id, store_id, technician_id) WHERE status = 'IN_SERVICE';
CREATE UNIQUE INDEX service_session_active_room_idx ON service_session(tenant_id, store_id, room_id) WHERE status = 'IN_SERVICE';
CREATE INDEX service_session_store_status_started_idx ON service_session(tenant_id, store_id, status, started_at DESC);
