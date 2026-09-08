CREATE TABLE service_session_extension_cancel_log (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  service_session_id UUID NOT NULL REFERENCES service_session(id),
  extension_id UUID NOT NULL,
  technician_id UUID NOT NULL REFERENCES technician(id),
  service_item_id UUID NOT NULL REFERENCES service_item(id),
  service_name_snapshot VARCHAR(120) NOT NULL,
  service_price_cents INTEGER NOT NULL,
  planned_duration_minutes SMALLINT NOT NULL,
  price_version_id UUID,
  commission_rule_version_id UUID,
  counts_as_clock_snapshot BOOLEAN NOT NULL,
  actor_user_id UUID,
  actor_name_snapshot VARCHAR(120) NOT NULL,
  reason VARCHAR(240) NOT NULL,
  cancelled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, extension_id)
);
CREATE INDEX service_session_extension_cancel_session_idx
  ON service_session_extension_cancel_log(store_id, service_session_id, cancelled_at DESC);
