ALTER TABLE service_item
  ADD COLUMN counts_as_clock BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE service_item_price_version (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  service_item_id UUID NOT NULL REFERENCES service_item(id),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  effective_business_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(service_item_id, effective_business_date)
);

INSERT INTO service_item_price_version(
  id,tenant_id,store_id,service_item_id,price_cents,effective_business_date
)
SELECT id,tenant_id,store_id,id,price_cents,DATE '1970-01-01'
FROM service_item;

CREATE INDEX service_item_price_version_effective_idx
  ON service_item_price_version(tenant_id,store_id,service_item_id,effective_business_date DESC);

CREATE TABLE service_item_commission_rule_version (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  service_item_id UUID NOT NULL REFERENCES service_item(id),
  queue_rule_type VARCHAR(20) NOT NULL DEFAULT 'NONE' CHECK (queue_rule_type IN ('NONE','FIXED','PERCENT')),
  queue_fixed_cents BIGINT NOT NULL DEFAULT 0 CHECK (queue_fixed_cents >= 0),
  queue_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (queue_rate_bp BETWEEN 0 AND 10000),
  call_rule_type VARCHAR(20) NOT NULL DEFAULT 'NONE' CHECK (call_rule_type IN ('NONE','FIXED','PERCENT')),
  call_fixed_cents BIGINT NOT NULL DEFAULT 0 CHECK (call_fixed_cents >= 0),
  call_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (call_rate_bp BETWEEN 0 AND 10000),
  extension_rule_type VARCHAR(20) NOT NULL DEFAULT 'NONE' CHECK (extension_rule_type IN ('NONE','FIXED','PERCENT')),
  extension_fixed_cents BIGINT NOT NULL DEFAULT 0 CHECK (extension_fixed_cents >= 0),
  extension_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (extension_rate_bp BETWEEN 0 AND 10000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_business_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(service_item_id, effective_business_date)
);

INSERT INTO service_item_commission_rule_version(
  id,tenant_id,store_id,service_item_id,
  queue_rule_type,queue_fixed_cents,queue_rate_bp,
  call_rule_type,call_fixed_cents,call_rate_bp,
  extension_rule_type,extension_fixed_cents,extension_rate_bp,
  active,effective_business_date
)
SELECT item.id,item.tenant_id,item.store_id,item.id,
  coalesce(rule.queue_rule_type,'NONE'),coalesce(rule.queue_fixed_cents,0),coalesce(rule.queue_rate_bp,0),
  coalesce(rule.call_rule_type,'NONE'),coalesce(rule.call_fixed_cents,0),coalesce(rule.call_rate_bp,0),
  coalesce(rule.extension_rule_type,'NONE'),coalesce(rule.extension_fixed_cents,0),coalesce(rule.extension_rate_bp,0),
  coalesce(rule.active,TRUE),DATE '1970-01-01'
FROM service_item item
LEFT JOIN service_item_commission_rule rule
  ON rule.store_id=item.store_id AND rule.service_item_id=item.id;

CREATE INDEX service_item_commission_version_effective_idx
  ON service_item_commission_rule_version(tenant_id,store_id,service_item_id,effective_business_date DESC);

ALTER TABLE service_session
  ADD COLUMN price_version_id UUID REFERENCES service_item_price_version(id),
  ADD COLUMN commission_rule_version_id UUID REFERENCES service_item_commission_rule_version(id),
  ADD COLUMN counts_as_clock_snapshot BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE service_session session
SET price_version_id=item.id,
    commission_rule_version_id=item.id,
    counts_as_clock_snapshot=item.counts_as_clock
FROM service_item item
WHERE item.id=session.service_item_id;

ALTER TABLE service_session_extension
  ADD COLUMN price_version_id UUID REFERENCES service_item_price_version(id),
  ADD COLUMN commission_rule_version_id UUID REFERENCES service_item_commission_rule_version(id),
  ADD COLUMN counts_as_clock_snapshot BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE service_session_extension extension
SET price_version_id=item.id,
    commission_rule_version_id=item.id,
    counts_as_clock_snapshot=item.counts_as_clock
FROM service_item item
WHERE item.id=extension.service_item_id;

ALTER TABLE service_reservation
  ADD COLUMN price_version_id UUID REFERENCES service_item_price_version(id),
  ADD COLUMN counts_as_clock_snapshot BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE service_reservation reservation
SET price_version_id=item.id,
    counts_as_clock_snapshot=item.counts_as_clock
FROM service_item item
WHERE item.id=reservation.service_item_id;
