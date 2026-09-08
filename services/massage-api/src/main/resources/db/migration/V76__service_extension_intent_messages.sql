CREATE TABLE service_extension_intent (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  service_session_id UUID NOT NULL REFERENCES service_session(id),
  technician_id UUID NOT NULL REFERENCES technician(id),
  room_id UUID NOT NULL REFERENCES room(id),
  member_id UUID REFERENCES member(id),
  technician_name_snapshot VARCHAR(80) NOT NULL,
  room_code_snapshot VARCHAR(40) NOT NULL,
  member_name_snapshot VARCHAR(80),
  service_name_snapshot VARCHAR(120) NOT NULL,
  technician_note VARCHAR(240),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONTACTED','REJECTED','EXPIRED')),
  rejection_reason VARCHAR(240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at TIMESTAMPTZ,
  handled_by_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  handled_by_name_snapshot VARCHAR(120),
  version BIGINT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX service_extension_intent_pending_session_idx
  ON service_extension_intent(store_id, service_session_id)
  WHERE status='PENDING';
CREATE INDEX service_extension_intent_store_status_idx
  ON service_extension_intent(store_id, status, created_at DESC);
CREATE INDEX service_extension_intent_technician_idx
  ON service_extension_intent(store_id, technician_id, created_at DESC);
