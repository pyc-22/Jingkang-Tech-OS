CREATE TABLE daily_operating_report (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  business_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SAVED','PUBLISHED')),
  daily_target_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_target_cents >= 0),
  daily_sales_amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_sales_amount_cents >= 0),
  daily_cash_flow_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_cash_flow_cents >= 0),
  daily_card_sale_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_card_sale_cents >= 0),
  daily_card_open_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_card_open_cents >= 0),
  daily_card_renew_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_card_renew_cents >= 0),
  daily_card_cancellation_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_card_cancellation_cents >= 0),
  daily_card_consumption_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_card_consumption_cents >= 0),
  daily_customer_count INTEGER NOT NULL DEFAULT 0 CHECK (daily_customer_count >= 0),
  daily_call_clock_count INTEGER NOT NULL DEFAULT 0 CHECK (daily_call_clock_count >= 0),
  daily_cash_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_cash_cents >= 0),
  daily_alipay_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_alipay_cents >= 0),
  daily_douyin_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_douyin_cents >= 0),
  daily_meituan_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_meituan_cents >= 0),
  daily_free_order_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_free_order_cents >= 0),
  daily_entertainment_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_entertainment_cents >= 0),
  manager_count INTEGER NOT NULL DEFAULT 0 CHECK (manager_count >= 0),
  cashier_count INTEGER NOT NULL DEFAULT 0 CHECK (cashier_count >= 0),
  technician_count INTEGER NOT NULL DEFAULT 0 CHECK (technician_count >= 0),
  chef_count INTEGER NOT NULL DEFAULT 0 CHECK (chef_count >= 0),
  cleaner_count INTEGER NOT NULL DEFAULT 0 CHECK (cleaner_count >= 0),
  incident_note TEXT,
  extended_shift_note TEXT,
  next_day_rest_count INTEGER NOT NULL DEFAULT 0 CHECK (next_day_rest_count >= 0),
  customer_loss_count INTEGER NOT NULL DEFAULT 0 CHECK (customer_loss_count >= 0),
  next_day_improvement_note TEXT,
  created_by_user_id UUID REFERENCES app_user(id),
  updated_by_user_id UUID REFERENCES app_user(id),
  published_by_user_id UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(store_id, business_date)
);

CREATE INDEX daily_operating_report_store_date_idx
  ON daily_operating_report(tenant_id, store_id, business_date DESC);
CREATE INDEX daily_operating_report_status_idx
  ON daily_operating_report(tenant_id, store_id, status, business_date DESC);

CREATE TABLE daily_report_month_target (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  target_month DATE NOT NULL CHECK (EXTRACT(DAY FROM target_month) = 1),
  monthly_target_cents BIGINT NOT NULL DEFAULT 0 CHECK (monthly_target_cents >= 0),
  updated_by_user_id UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(store_id, target_month)
);

CREATE TABLE daily_report_field_config (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  field_code VARCHAR(80) NOT NULL,
  field_label VARCHAR(120) NOT NULL,
  section_code VARCHAR(40) NOT NULL CHECK (section_code IN ('MONTHLY','DAILY','PERSONNEL','HANDOVER')),
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 100 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(store_id, field_code)
);

CREATE INDEX daily_report_field_config_store_section_idx
  ON daily_report_field_config(tenant_id, store_id, section_code, sort_order);

CREATE TABLE daily_operating_report_revision (
  id UUID PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES daily_operating_report(id),
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  revision_no INTEGER NOT NULL CHECK (revision_no > 0),
  action VARCHAR(20) NOT NULL CHECK (action IN ('CREATE','SAVE','PUBLISH')),
  before_data JSONB,
  after_data JSONB NOT NULL,
  actor_user_id UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(report_id, revision_no)
);

CREATE INDEX daily_operating_report_revision_report_idx
  ON daily_operating_report_revision(report_id, revision_no DESC);

INSERT INTO permission(id,code,name,module) VALUES
  ('91000000-0000-0000-0000-000000000009','DAILY_REPORT_VIEW','每日营业日报查看','DAILY_REPORT'),
  ('91000000-0000-0000-0000-000000000010','DAILY_REPORT_EDIT','每日营业日报编辑','DAILY_REPORT'),
  ('91000000-0000-0000-0000-000000000011','DAILY_REPORT_PUBLISH','每日营业日报发布','DAILY_REPORT'),
  ('91000000-0000-0000-0000-000000000012','DAILY_REPORT_CONFIG','每日营业日报设置','DAILY_REPORT');

INSERT INTO role_permission(role_id,permission_id)
SELECT role.id, permission.id
FROM role
JOIN permission ON permission.code IN ('DAILY_REPORT_VIEW','DAILY_REPORT_EDIT','DAILY_REPORT_PUBLISH','DAILY_REPORT_CONFIG')
WHERE role.code='STORE_MANAGER';

INSERT INTO role_permission(role_id,permission_id)
SELECT role.id, permission.id
FROM role
JOIN permission ON permission.code='DAILY_REPORT_VIEW'
WHERE role.code='CASHIER';
