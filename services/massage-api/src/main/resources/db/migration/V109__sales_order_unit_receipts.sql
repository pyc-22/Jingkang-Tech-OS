ALTER TABLE sales_order_line
  ADD COLUMN IF NOT EXISTS settlement_amount_cents BIGINT;

ALTER TABLE sales_order_line
  DROP CONSTRAINT IF EXISTS sales_order_line_settlement_amount_cents_check;

ALTER TABLE sales_order_line
  ADD CONSTRAINT sales_order_line_settlement_amount_cents_check
  CHECK (settlement_amount_cents >= 0);

COMMENT ON COLUMN sales_order_line.settlement_amount_cents IS
  'Settlement-time unit receipt snapshot. NULL preserves legacy header-only pricing; display falls back to line_amount_cents.';
