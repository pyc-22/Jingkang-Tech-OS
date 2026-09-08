CREATE TABLE store_commission_tier_policy_version (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_business_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(store_id, effective_business_date)
);

CREATE INDEX store_commission_tier_policy_effective_idx
  ON store_commission_tier_policy_version(tenant_id, store_id, effective_business_date DESC);

CREATE TABLE store_commission_tier (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  policy_version_id UUID NOT NULL REFERENCES store_commission_tier_policy_version(id) ON DELETE CASCADE,
  tier_name VARCHAR(80) NOT NULL,
  minimum_monthly_clock_count INTEGER NOT NULL CHECK (minimum_monthly_clock_count >= 0),
  commission_multiplier_bp INTEGER NOT NULL CHECK (commission_multiplier_bp BETWEEN 0 AND 30000),
  sort_order SMALLINT NOT NULL CHECK (sort_order BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(policy_version_id, minimum_monthly_clock_count),
  UNIQUE(policy_version_id, sort_order)
);

CREATE INDEX store_commission_tier_policy_idx
  ON store_commission_tier(tenant_id, store_id, policy_version_id, minimum_monthly_clock_count DESC);

INSERT INTO store_commission_tier_policy_version(id, tenant_id, store_id, active, effective_business_date)
SELECT gen_random_uuid(), tenant_id, id, TRUE, DATE '1970-01-01'
FROM store;

INSERT INTO store_commission_tier(
  id, tenant_id, store_id, policy_version_id, tier_name,
  minimum_monthly_clock_count, commission_multiplier_bp, sort_order
)
SELECT gen_random_uuid(), policy.tenant_id, policy.store_id, policy.id, '基础档', 0, 10000, 1
FROM store_commission_tier_policy_version policy;

ALTER TABLE technician_commission_record
  ADD COLUMN commission_tier_policy_version_id UUID REFERENCES store_commission_tier_policy_version(id),
  ADD COLUMN commission_tier_id UUID REFERENCES store_commission_tier(id),
  ADD COLUMN commission_tier_name_snapshot VARCHAR(80) NOT NULL DEFAULT '基础档',
  ADD COLUMN commission_tier_minimum_clock_count_snapshot INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN commission_multiplier_bp_snapshot INTEGER NOT NULL DEFAULT 10000
    CHECK (commission_multiplier_bp_snapshot BETWEEN 0 AND 30000),
  ADD COLUMN monthly_clock_count_snapshot INTEGER NOT NULL DEFAULT 0
    CHECK (monthly_clock_count_snapshot >= 0);

CREATE INDEX technician_commission_monthly_tier_idx
  ON technician_commission_record(tenant_id, store_id, technician_id, business_date, record_type, source_type);
