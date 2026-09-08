CREATE TABLE service_session_clock_reminder (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  service_session_id UUID NOT NULL REFERENCES service_session(id),
  clock_device_id UUID NOT NULL REFERENCES clock_device(id),
  clock_device_event_id UUID REFERENCES clock_device_event(id),
  reminder_type VARCHAR(20) NOT NULL CHECK (reminder_type IN ('TEN_MINUTES', 'FIVE_MINUTES', 'ENDED')),
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED')),
  delivery_error VARCHAR(500),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_session_id, clock_device_id, reminder_type)
);

CREATE INDEX service_session_clock_reminder_status_idx
  ON service_session_clock_reminder(tenant_id, store_id, delivery_status, created_at DESC);
