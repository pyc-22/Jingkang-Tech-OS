-- Keep posted wallet amounts immutable; financial reports use the corrected principal.
ALTER TABLE wallet_transaction ADD COLUMN corrected_amount_cents BIGINT;
ALTER TABLE wallet_transaction ADD COLUMN correction_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE wallet_transaction ADD CONSTRAINT wallet_recharge_correction_amount CHECK (
  corrected_amount_cents IS NULL OR (transaction_type='RECHARGE' AND corrected_amount_cents>0)
);
ALTER TABLE wallet_transaction ADD COLUMN corrected_recharge_id UUID REFERENCES wallet_transaction(id);
ALTER TABLE wallet_transaction ADD CONSTRAINT wallet_recharge_correction_link CHECK (
  corrected_recharge_id IS NULL OR (transaction_type='ADJUSTMENT' AND source='RECHARGE_CORRECTION' AND corrected_recharge_id<>id)
);
CREATE INDEX wallet_transaction_correction_idx ON wallet_transaction(corrected_recharge_id)
  WHERE corrected_recharge_id IS NOT NULL;
