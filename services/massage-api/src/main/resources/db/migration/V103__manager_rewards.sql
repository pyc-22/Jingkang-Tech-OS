CREATE TABLE manager_reward_month_lock (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  reward_month DATE NOT NULL,
  manager_user_id UUID REFERENCES app_user(id),
  manager_name_snapshot VARCHAR(120),
  locked_by_user_id UUID NOT NULL REFERENCES app_user(id),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, reward_month)
);

CREATE INDEX manager_reward_month_lock_store_idx
  ON manager_reward_month_lock(tenant_id, store_id, reward_month DESC);

CREATE TABLE manager_reward_day_assignment (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  business_date DATE NOT NULL,
  manager_user_id UUID NOT NULL REFERENCES app_user(id),
  manager_name_snapshot VARCHAR(120) NOT NULL,
  attendance_status VARCHAR(20) NOT NULL CHECK (attendance_status IN ('PRESENT','LATE','COMPLETED','LEFT_EARLY')),
  assigned_by_user_id UUID REFERENCES app_user(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note VARCHAR(240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(store_id, business_date)
);

CREATE INDEX manager_reward_day_assignment_scope_idx
  ON manager_reward_day_assignment(tenant_id, store_id, business_date DESC);

CREATE TABLE manager_reward_month_lock_day (
  id UUID PRIMARY KEY,
  lock_id UUID NOT NULL REFERENCES manager_reward_month_lock(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  business_date DATE NOT NULL,
  manager_user_id UUID REFERENCES app_user(id),
  manager_name_snapshot VARCHAR(120),
  cash_flow_cents BIGINT NOT NULL DEFAULT 0,
  cash_flow_reward_cents BIGINT NOT NULL DEFAULT 0,
  yue_count INTEGER NOT NULL DEFAULT 0,
  yue_reward_cents BIGINT NOT NULL DEFAULT 0,
  big_project_count INTEGER NOT NULL DEFAULT 0,
  big_project_reward_cents BIGINT NOT NULL DEFAULT 0,
  recharge_count INTEGER NOT NULL DEFAULT 0,
  recharge_reward_cents BIGINT NOT NULL DEFAULT 0,
  total_reward_cents BIGINT NOT NULL DEFAULT 0,
  attendance_status VARCHAR(20) CHECK (attendance_status IS NULL OR attendance_status IN ('PRESENT','LATE','COMPLETED','LEFT_EARLY')),
  on_duty_day BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lock_id, business_date)
);

CREATE INDEX manager_reward_month_lock_day_store_idx
  ON manager_reward_month_lock_day(tenant_id, store_id, business_date);

CREATE TABLE manager_yue_record (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  manager_user_id UUID NOT NULL REFERENCES app_user(id),
  manager_name_snapshot VARCHAR(120) NOT NULL,
  business_date DATE NOT NULL,
  order_id UUID NOT NULL REFERENCES sales_order(id),
  member_id UUID REFERENCES member(id),
  customer_name_snapshot VARCHAR(120),
  customer_phone_snapshot VARCHAR(40),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  replaced_at TIMESTAMPTZ,
  replaced_by_user_id UUID REFERENCES app_user(id),
  replacement_note VARCHAR(240),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX manager_yue_record_active_order_uq
  ON manager_yue_record(store_id, order_id) WHERE active;
CREATE UNIQUE INDEX manager_yue_record_active_member_day_uq
  ON manager_yue_record(store_id, member_id, business_date)
  WHERE active AND member_id IS NOT NULL;
CREATE INDEX manager_yue_record_store_date_idx
  ON manager_yue_record(tenant_id, store_id, business_date, submitted_at DESC);
CREATE INDEX manager_yue_record_manager_idx
  ON manager_yue_record(tenant_id, manager_user_id, business_date DESC);

CREATE TABLE manager_yue_record_revision (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  yue_record_id UUID NOT NULL REFERENCES manager_yue_record(id) ON DELETE CASCADE,
  previous_order_id UUID NOT NULL REFERENCES sales_order(id),
  previous_member_id UUID REFERENCES member(id),
  previous_customer_name_snapshot VARCHAR(120),
  previous_customer_phone_snapshot VARCHAR(40),
  changed_by_user_id UUID NOT NULL REFERENCES app_user(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note VARCHAR(240)
);

CREATE INDEX manager_yue_record_revision_record_idx
  ON manager_yue_record_revision(tenant_id, store_id, yue_record_id, changed_at DESC);

CREATE TABLE manager_yue_attachment (
  id UUID PRIMARY KEY,
  yue_record_id UUID NOT NULL REFERENCES manager_yue_record(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  original_storage_key VARCHAR(500) NOT NULL,
  watermarked_storage_key VARCHAR(500) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(120) NOT NULL CHECK (content_type IN ('image/jpeg','image/png')),
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  sha256 VARCHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-fA-F]{64}$'),
  watermarked_sha256 VARCHAR(64) NOT NULL CHECK (watermarked_sha256 ~ '^[0-9a-fA-F]{64}$'),
  uploaded_by_user_id UUID NOT NULL REFERENCES app_user(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX manager_yue_attachment_active_uq
  ON manager_yue_attachment(yue_record_id) WHERE active;
CREATE INDEX manager_yue_attachment_store_idx
  ON manager_yue_attachment(tenant_id, store_id, created_at DESC);

CREATE INDEX manager_reward_session_date_idx
  ON service_session(tenant_id, store_id, business_date, status, service_price_cents);
CREATE INDEX manager_reward_extension_session_idx
  ON service_session_extension(tenant_id, store_id, service_session_id, service_price_cents);
CREATE INDEX manager_reward_recharge_date_idx
  ON wallet_transaction(tenant_id, store_id, business_date, transaction_type, id)
  WHERE transaction_type = 'RECHARGE' AND NOT report_excluded;

INSERT INTO permission(id, code, name, module) VALUES
  ('91000000-0000-0000-0000-000000000029', 'MANAGER_REWARD_VIEW', '查看店长绩效', 'MANAGER_REWARD'),
  ('91000000-0000-0000-0000-000000000030', 'MANAGER_REWARD_SUBMIT', '提交约客凭证', 'MANAGER_REWARD'),
  ('91000000-0000-0000-0000-000000000031', 'MANAGER_REWARD_ADMIN_VIEW', '查看全部店长绩效', 'MANAGER_REWARD'),
  ('91000000-0000-0000-0000-000000000032', 'MANAGER_REWARD_LOCK', '锁定店长绩效月结', 'MANAGER_REWARD')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id
FROM role r CROSS JOIN permission p
WHERE r.code = 'STORE_MANAGER' AND p.code IN ('MANAGER_REWARD_VIEW','MANAGER_REWARD_SUBMIT')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id
FROM role r CROSS JOIN permission p
WHERE r.code IN ('TENANT_ADMIN','FINANCE')
  AND p.code IN ('MANAGER_REWARD_VIEW','MANAGER_REWARD_SUBMIT','MANAGER_REWARD_ADMIN_VIEW','MANAGER_REWARD_LOCK')
ON CONFLICT DO NOTHING;
