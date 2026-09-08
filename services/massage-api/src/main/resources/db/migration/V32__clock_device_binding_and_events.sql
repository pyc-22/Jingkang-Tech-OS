CREATE TABLE clock_device (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  device_id VARCHAR(120) NOT NULL,
  name VARCHAR(120) NOT NULL,
  protocol VARCHAR(12) NOT NULL DEFAULT 'UDP' CHECK (protocol IN ('UDP')),
  ip_address VARCHAR(45),
  port INTEGER NOT NULL DEFAULT 6000 CHECK (port BETWEEN 1 AND 65535),
  room_id UUID REFERENCES room(id),
  room_name VARCHAR(80),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  last_source_ip VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, device_id)
);

CREATE INDEX clock_device_store_active_idx
  ON clock_device(tenant_id, store_id, active, name);

CREATE TABLE clock_device_event (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID REFERENCES store(id),
  clock_device_id UUID REFERENCES clock_device(id),
  device_id VARCHAR(120) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('upload', 'download')),
  event_type INTEGER NOT NULL CHECK (event_type >= 1),
  room_name VARCHAR(80),
  unlock_card_id VARCHAR(120),
  payload_json JSONB NOT NULL,
  source_ip VARCHAR(45),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX clock_device_event_store_received_idx
  ON clock_device_event(tenant_id, store_id, received_at DESC);
CREATE INDEX clock_device_event_device_received_idx
  ON clock_device_event(tenant_id, device_id, received_at DESC);
CREATE INDEX clock_device_event_unbound_idx
  ON clock_device_event(tenant_id, received_at DESC)
  WHERE store_id IS NULL;

INSERT INTO permission(id, code, name, module) VALUES
  ('91000000-0000-0000-0000-000000000024', 'CLOCK_DEVICE_MANAGE', '报钟器设备管理', 'CLOCK_DEVICE'),
  ('91000000-0000-0000-0000-000000000025', 'CLOCK_DEVICE_EVENT_VIEW', '查看报钟器事件', 'CLOCK_DEVICE')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.code IN ('CLOCK_DEVICE_MANAGE', 'CLOCK_DEVICE_EVENT_VIEW')
WHERE r.code = 'STORE_MANAGER'
ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.code = 'CLOCK_DEVICE_EVENT_VIEW'
WHERE r.code = 'CASHIER'
ON CONFLICT DO NOTHING;
