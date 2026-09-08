ALTER TABLE clock_device_event
  ADD COLUMN delivery_status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED'
    CHECK (delivery_status IN ('RECEIVED', 'PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED')),
  ADD COLUMN delivery_error VARCHAR(500),
  ADD COLUMN delivered_at TIMESTAMPTZ,
  ADD COLUMN reply_to_event_id UUID REFERENCES clock_device_event(id);

CREATE INDEX clock_device_event_delivery_idx
  ON clock_device_event(tenant_id, store_id, delivery_status, received_at DESC);
