CREATE TABLE service_session_extension_change_log (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  service_session_id UUID NOT NULL REFERENCES service_session(id),
  extension_id UUID NOT NULL,
  technician_id UUID NOT NULL REFERENCES technician(id),
  previous_service_item_id UUID NOT NULL REFERENCES service_item(id),
  previous_service_name_snapshot VARCHAR(120) NOT NULL,
  previous_price_cents INTEGER NOT NULL,
  previous_duration_minutes SMALLINT NOT NULL,
  new_service_item_id UUID NOT NULL REFERENCES service_item(id),
  new_service_name_snapshot VARCHAR(120) NOT NULL,
  new_price_cents INTEGER NOT NULL,
  new_duration_minutes SMALLINT NOT NULL,
  previous_price_version_id UUID,
  new_price_version_id UUID,
  previous_commission_rule_version_id UUID,
  new_commission_rule_version_id UUID,
  previous_counts_as_clock_snapshot BOOLEAN NOT NULL,
  new_counts_as_clock_snapshot BOOLEAN NOT NULL,
  actor_user_id UUID,
  actor_name_snapshot VARCHAR(120) NOT NULL,
  reason VARCHAR(240) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX service_session_extension_change_session_idx
  ON service_session_extension_change_log(store_id, service_session_id, changed_at DESC);
