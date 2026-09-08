CREATE TABLE administrative_commission_rule (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  employee_id UUID REFERENCES employee(id),
  service_item_id UUID REFERENCES service_item(id),
  rule_type VARCHAR(12) NOT NULL CHECK (rule_type IN ('NONE','FIXED','PERCENT')),
  fixed_cents BIGINT NOT NULL DEFAULT 0 CHECK (fixed_cents >= 0),
  rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (rate_bp BETWEEN 0 AND 10000),
  active BOOLEAN NOT NULL DEFAULT true,
  effective_business_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(store_id, employee_id, service_item_id, effective_business_date)
);

CREATE INDEX administrative_commission_rule_lookup_idx
  ON administrative_commission_rule(store_id, employee_id, service_item_id, effective_business_date DESC);

CREATE TABLE administrative_referral_record (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  employee_id UUID NOT NULL REFERENCES employee(id),
  employee_name_snapshot VARCHAR(120) NOT NULL,
  service_item_id UUID REFERENCES service_item(id),
  service_name_snapshot VARCHAR(120) NOT NULL,
  order_id UUID REFERENCES sales_order(id),
  order_no_snapshot VARCHAR(40),
  business_date DATE NOT NULL,
  base_amount_cents BIGINT NOT NULL CHECK (base_amount_cents >= 0),
  rule_type VARCHAR(12) NOT NULL CHECK (rule_type IN ('NONE','FIXED','PERCENT')),
  rule_rate_bp INTEGER NOT NULL DEFAULT 0,
  rule_fixed_cents BIGINT NOT NULL DEFAULT 0,
  commission_cents BIGINT NOT NULL DEFAULT 0 CHECK (commission_cents >= 0),
  status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','CANCELLED')),
  note VARCHAR(240),
  referred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX administrative_referral_record_store_date_idx
  ON administrative_referral_record(store_id, business_date, status, referred_at DESC);
