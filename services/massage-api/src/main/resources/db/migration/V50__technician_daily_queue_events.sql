CREATE TABLE technician_queue_day (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  business_date DATE NOT NULL,
  initialized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, business_date)
);

CREATE TABLE technician_queue_position (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  queue_day_id UUID NOT NULL REFERENCES technician_queue_day(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES technician(id),
  queue_position INTEGER NOT NULL CHECK (queue_position > 0),
  default_queue_order INTEGER NOT NULL CHECK (default_queue_order > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(queue_day_id, technician_id),
  UNIQUE(queue_day_id, queue_position)
);

CREATE TABLE technician_queue_event (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  queue_day_id UUID NOT NULL REFERENCES technician_queue_day(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  technician_id UUID REFERENCES technician(id),
  service_session_id UUID REFERENCES service_session(id),
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('DAY_INITIALIZED','TECHNICIAN_JOINED','MANUAL_REORDER','SERVICE_ROTATED')),
  from_position INTEGER,
  to_position INTEGER,
  reason VARCHAR(240),
  actor_user_id UUID REFERENCES app_user(id),
  actor_name_snapshot VARCHAR(120),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX technician_queue_position_store_day_idx
  ON technician_queue_position(store_id, queue_day_id, queue_position);
CREATE INDEX technician_queue_event_store_day_idx
  ON technician_queue_event(store_id, business_date, occurred_at DESC, id DESC);
