ALTER TABLE wallet_transaction ADD COLUMN payment_method VARCHAR(30);
ALTER TABLE wallet_transaction ADD CONSTRAINT wallet_transaction_payment_method_check CHECK (payment_method IS NULL OR payment_method IN ('CASH','WECHAT','OTHER'));

CREATE TABLE cashier_shift (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  operator_name_snapshot VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('OPEN','CLOSED')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opening_cash_cents BIGINT NOT NULL DEFAULT 0 CHECK (opening_cash_cents >= 0),
  expected_cash_cents BIGINT,
  actual_cash_cents BIGINT,
  cash_difference_cents BIGINT,
  settled_order_count INTEGER,
  completed_refund_count INTEGER,
  recharge_cents BIGINT,
  bonus_cents BIGINT,
  member_consumption_cents BIGINT,
  note VARCHAR(240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'OPEN' AND closed_at IS NULL) OR (status = 'CLOSED' AND closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX cashier_shift_one_open_per_store_idx ON cashier_shift(tenant_id,store_id) WHERE status = 'OPEN';
CREATE INDEX cashier_shift_store_closed_idx ON cashier_shift(tenant_id,store_id,closed_at DESC);

CREATE TABLE cashier_shift_payment_summary (
  id UUID PRIMARY KEY,
  shift_id UUID NOT NULL REFERENCES cashier_shift(id),
  category VARCHAR(20) NOT NULL CHECK (category IN ('SALE','REFUND','RECHARGE')),
  payment_method VARCHAR(30) NOT NULL CHECK (payment_method IN ('CASH','WECHAT','MEMBER_BALANCE','OTHER')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  transaction_count INTEGER NOT NULL CHECK (transaction_count >= 0),
  UNIQUE(shift_id,category,payment_method)
);
