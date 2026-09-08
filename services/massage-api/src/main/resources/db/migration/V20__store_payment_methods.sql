CREATE TABLE store_payment_method (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  code VARCHAR(30) NOT NULL,
  name VARCHAR(60) NOT NULL,
  method_kind VARCHAR(20) NOT NULL CHECK (method_kind IN ('MEMBER_BALANCE','EXTERNAL')),
  cash_counted BOOLEAN NOT NULL DEFAULT FALSE,
  built_in BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order SMALLINT NOT NULL DEFAULT 100,
  note VARCHAR(240),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(store_id, code)
);
CREATE INDEX store_payment_method_scope_idx ON store_payment_method(tenant_id, store_id, active, sort_order);

INSERT INTO store_payment_method(id,tenant_id,store_id,code,name,method_kind,cash_counted,built_in,sort_order)
SELECT md5('payment-method-' || store.id::text || '-' || seed.code)::uuid,store.tenant_id,store.id,seed.code,seed.name,seed.method_kind,seed.cash_counted,TRUE,seed.sort_order
FROM store CROSS JOIN (VALUES
  ('MEMBER_BALANCE','会员余额','MEMBER_BALANCE',FALSE,10::SMALLINT),
  ('WECHAT','微信支付','EXTERNAL',FALSE,20::SMALLINT),
  ('CASH','现金','EXTERNAL',TRUE,30::SMALLINT)
) AS seed(code,name,method_kind,cash_counted,sort_order);

ALTER TABLE payment_record ADD COLUMN payment_method_name_snapshot VARCHAR(60);
UPDATE payment_record SET payment_method_name_snapshot = CASE payment_method WHEN 'MEMBER_BALANCE' THEN '会员余额' WHEN 'WECHAT' THEN '微信支付' WHEN 'CASH' THEN '现金' ELSE payment_method END;
ALTER TABLE payment_record ALTER COLUMN payment_method_name_snapshot SET NOT NULL;
ALTER TABLE payment_record DROP CONSTRAINT payment_record_payment_method_check;
ALTER TABLE refund_payment_record DROP CONSTRAINT refund_payment_record_payment_method_check;
ALTER TABLE cashier_shift_payment_summary DROP CONSTRAINT cashier_shift_payment_summary_payment_method_check;
