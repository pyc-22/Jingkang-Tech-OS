-- Supporting indexes for the unified daily-report read path.
-- This migration is additive and does not change existing data or constraints.
CREATE INDEX IF NOT EXISTS payment_record_store_order_idx
  ON payment_record(store_id, order_id, created_at);

CREATE INDEX IF NOT EXISTS refund_payment_record_store_status_idx
  ON refund_payment_record(store_id, status, created_at);

CREATE INDEX IF NOT EXISTS wallet_transaction_store_business_type_source_idx
  ON wallet_transaction(store_id, business_date, transaction_type, source);

CREATE INDEX IF NOT EXISTS wallet_transaction_member_recharge_rank_idx
  ON wallet_transaction(tenant_id, member_id, created_at, id)
  WHERE transaction_type = 'RECHARGE';

CREATE INDEX IF NOT EXISTS member_recharge_refund_store_business_status_idx
  ON member_recharge_refund(store_id, business_date, status);
