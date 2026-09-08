ALTER TABLE sales_order
  ADD COLUMN cancel_reason VARCHAR(240),
  ADD COLUMN cancelled_at TIMESTAMPTZ;

CREATE INDEX sales_order_cancelled_idx
  ON sales_order(tenant_id, store_id, cancelled_at DESC)
  WHERE status = 'CANCELLED';
