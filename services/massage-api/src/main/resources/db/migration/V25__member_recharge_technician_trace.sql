ALTER TABLE wallet_transaction ADD COLUMN technician_id UUID REFERENCES technician(id);
ALTER TABLE wallet_transaction ADD COLUMN technician_name_snapshot VARCHAR(80);
ALTER TABLE wallet_transaction ADD COLUMN payment_method_name_snapshot VARCHAR(60);

UPDATE wallet_transaction
SET payment_method_name_snapshot = CASE payment_method
  WHEN 'WECHAT' THEN '微信支付'
  WHEN 'CASH' THEN '现金'
  WHEN 'OTHER' THEN '其他'
  ELSE payment_method
END
WHERE payment_method IS NOT NULL AND payment_method_name_snapshot IS NULL;

ALTER TABLE wallet_transaction DROP CONSTRAINT wallet_transaction_payment_method_check;

CREATE INDEX wallet_transaction_store_recharge_idx
  ON wallet_transaction(tenant_id, store_id, transaction_type, created_at DESC);
CREATE INDEX wallet_transaction_store_technician_idx
  ON wallet_transaction(store_id, technician_id, created_at DESC)
  WHERE technician_id IS NOT NULL;
