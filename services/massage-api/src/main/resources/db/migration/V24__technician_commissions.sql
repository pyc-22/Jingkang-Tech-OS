CREATE TABLE service_item_commission_rule (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(store_id, service_item_id)
);
CREATE INDEX service_item_commission_rule_scope_idx ON service_item_commission_rule(tenant_id, store_id, active);

CREATE TABLE technician_commission_record (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  order_id UUID NOT NULL REFERENCES sales_order(id),
  order_line_id UUID NOT NULL REFERENCES sales_order_line(id),
  service_session_id UUID REFERENCES service_session(id),
  service_session_extension_id UUID REFERENCES service_session_extension(id),
  service_item_id UUID REFERENCES service_item(id),
  technician_id UUID NOT NULL REFERENCES technician(id),
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('MAIN','EXTENSION')),
  clock_type VARCHAR(20) NOT NULL CHECK (clock_type IN ('QUEUE','CALL','EXTENSION')),
  order_no_snapshot VARCHAR(40) NOT NULL,
  settlement_no_snapshot VARCHAR(40),
  technician_name_snapshot VARCHAR(80) NOT NULL,
  service_name_snapshot VARCHAR(120) NOT NULL,
  rule_type VARCHAR(20) NOT NULL CHECK (rule_type IN ('NONE','FIXED','PERCENT')),
  rule_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (rule_rate_bp BETWEEN 0 AND 10000),
  rule_fixed_cents BIGINT NOT NULL DEFAULT 0 CHECK (rule_fixed_cents >= 0),
  base_amount_cents BIGINT NOT NULL CHECK (base_amount_cents >= 0),
  commission_cents BIGINT NOT NULL CHECK (commission_cents >= 0),
  settled_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX technician_commission_main_unique_idx ON technician_commission_record(order_id, service_session_id) WHERE service_session_extension_id IS NULL;
CREATE UNIQUE INDEX technician_commission_extension_unique_idx ON technician_commission_record(order_id, service_session_extension_id) WHERE service_session_extension_id IS NOT NULL;
CREATE INDEX technician_commission_store_settled_idx ON technician_commission_record(tenant_id, store_id, settled_at DESC);
CREATE INDEX technician_commission_technician_idx ON technician_commission_record(tenant_id, store_id, technician_id, settled_at DESC);
