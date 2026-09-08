CREATE TABLE service_room_transfer (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  service_session_id UUID NOT NULL REFERENCES service_session(id),
  from_room_id UUID NOT NULL REFERENCES room(id),
  to_room_id UUID NOT NULL REFERENCES room(id),
  status VARCHAR(20) NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED','APPROVED','REJECTED','CANCELLED')),
  reason VARCHAR(240) NOT NULL,
  rejection_note VARCHAR(240),
  requested_by_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  requested_by_name_snapshot VARCHAR(120),
  approved_by_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  approved_by_name_snapshot VARCHAR(120),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  CHECK (from_room_id <> to_room_id),
  CHECK (status <> 'APPROVED' OR approved_at IS NOT NULL),
  CHECK (status <> 'REJECTED' OR rejection_note IS NOT NULL)
);

CREATE UNIQUE INDEX service_room_transfer_pending_session_uq
  ON service_room_transfer(tenant_id, store_id, service_session_id)
  WHERE status = 'REQUESTED';

CREATE INDEX service_room_transfer_store_status_idx
  ON service_room_transfer(tenant_id, store_id, status, requested_at DESC);

CREATE INDEX service_room_transfer_session_history_idx
  ON service_room_transfer(tenant_id, store_id, service_session_id, requested_at DESC);

INSERT INTO permission(id, code, name, module) VALUES
  ('91000000-0000-0000-0000-000000000026', 'ROOM_TRANSFER_REQUEST', '申请服务换房', 'ROOM'),
  ('91000000-0000-0000-0000-000000000027', 'ROOM_TRANSFER_APPROVE', '确认服务换房', 'ROOM')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.code = 'ROOM_TRANSFER_APPROVE'
WHERE r.code IN ('TENANT_ADMIN', 'STORE_MANAGER', 'CASHIER')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE service_room_transfer IS 'Service room transfer requests and immutable business history';
COMMENT ON COLUMN service_room_transfer.from_room_id IS 'Room occupied before the transfer';
COMMENT ON COLUMN service_room_transfer.to_room_id IS 'Requested destination room';
COMMENT ON COLUMN service_room_transfer.version IS 'Optimistic concurrency version for approval decisions';
