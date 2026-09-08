CREATE TABLE member_recharge_refund (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  member_id UUID NOT NULL REFERENCES member(id),
  original_transaction_id UUID NOT NULL REFERENCES wallet_transaction(id),
  refund_no VARCHAR(40) NOT NULL,
  request_key VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING','COMPLETED','CANCELLED')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  reason VARCHAR(240) NOT NULL,
  requested_by_user_id UUID,
  requested_by_name_snapshot VARCHAR(120) NOT NULL,
  completed_by_user_id UUID,
  completed_by_name_snapshot VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  business_date DATE,
  CONSTRAINT member_recharge_refund_request_key_uq UNIQUE (store_id, request_key)
);
CREATE INDEX member_recharge_refund_member_idx ON member_recharge_refund(store_id, member_id, created_at DESC);
CREATE INDEX member_recharge_refund_status_idx ON member_recharge_refund(store_id, status, created_at DESC);
