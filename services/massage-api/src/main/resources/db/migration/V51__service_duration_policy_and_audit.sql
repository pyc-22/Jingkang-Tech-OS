ALTER TABLE store
  ADD COLUMN service_duration_max_minutes SMALLINT NOT NULL DEFAULT 720
    CHECK (service_duration_max_minutes BETWEEN 15 AND 1440),
  ADD COLUMN technician_extension_max_minutes SMALLINT NOT NULL DEFAULT 120
    CHECK (technician_extension_max_minutes BETWEEN 0 AND 720);

ALTER TABLE service_session
  DROP CONSTRAINT IF EXISTS service_session_planned_duration_minutes_check;

ALTER TABLE service_session
  ADD CONSTRAINT service_session_planned_duration_minutes_check
    CHECK (planned_duration_minutes BETWEEN 15 AND 1440);

CREATE TABLE service_session_duration_change_log (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  service_session_id UUID NOT NULL REFERENCES service_session(id),
  technician_id UUID REFERENCES technician(id),
  service_session_extension_id UUID REFERENCES service_session_extension(id),
  actor_user_id UUID REFERENCES app_user(id),
  actor_name_snapshot VARCHAR(120),
  source VARCHAR(32) NOT NULL CHECK (source IN ('TECHNICIAN_EXTENSION','MANAGER_OVERRIDE')),
  previous_duration_minutes SMALLINT NOT NULL CHECK (previous_duration_minutes >= 15),
  new_duration_minutes SMALLINT NOT NULL CHECK (new_duration_minutes >= 15),
  added_duration_minutes SMALLINT NOT NULL CHECK (added_duration_minutes <> 0),
  previous_expected_end_at TIMESTAMPTZ NOT NULL,
  new_expected_end_at TIMESTAMPTZ NOT NULL,
  reason VARCHAR(240) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX service_session_duration_change_log_session_idx
  ON service_session_duration_change_log(store_id, service_session_id, changed_at DESC, id DESC);

INSERT INTO permission(id, code, name, module) VALUES
  ('91000000-0000-0000-0000-000000000028','SERVICE_DURATION_OVERRIDE','服务时长人工修改','SERVICE')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT role.id, permission.id
FROM role
JOIN permission ON permission.code='SERVICE_DURATION_OVERRIDE'
WHERE role.code='STORE_MANAGER'
ON CONFLICT DO NOTHING;
