ALTER TABLE sales_order
  ADD COLUMN financial_correction_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE sales_order_financial_correction (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  order_id UUID NOT NULL REFERENCES sales_order(id),
  correction_version INTEGER NOT NULL,
  old_paid_cents BIGINT NOT NULL CHECK (old_paid_cents >= 0),
  new_paid_cents BIGINT NOT NULL CHECK (new_paid_cents >= 0),
  reason VARCHAR(240) NOT NULL,
  corrected_by_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  corrected_by_name_snapshot VARCHAR(120) NOT NULL,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, correction_version)
);

CREATE TABLE sales_order_financial_correction_payment (
  id UUID PRIMARY KEY,
  correction_id UUID NOT NULL REFERENCES sales_order_financial_correction(id) ON DELETE CASCADE,
  snapshot_side VARCHAR(10) NOT NULL CHECK (snapshot_side IN ('BEFORE','AFTER')),
  payment_method VARCHAR(30) NOT NULL,
  payment_method_name_snapshot VARCHAR(60) NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0)
);

CREATE INDEX sales_order_financial_correction_order_idx
  ON sales_order_financial_correction(order_id, correction_version DESC);
