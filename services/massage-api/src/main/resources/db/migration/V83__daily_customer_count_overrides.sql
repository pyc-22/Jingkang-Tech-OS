CREATE TABLE daily_customer_count_override (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  business_date DATE NOT NULL,
  customer_count INTEGER NOT NULL CHECK (customer_count >= 0),
  reason VARCHAR(500) NOT NULL,
  updated_by_user_id UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, business_date)
);

CREATE INDEX daily_customer_count_override_store_date_idx
  ON daily_customer_count_override(tenant_id, store_id, business_date);

COMMENT ON TABLE daily_customer_count_override IS 'Manual daily customer-count corrections; NULL means the live order count is used';
