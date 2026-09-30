-- A wallet is a payment account.  Existing members keep their current
-- balance as the default account; additional accounts can be added without
-- changing historical transactions.
ALTER TABLE member_wallet ADD COLUMN IF NOT EXISTS account_code VARCHAR(40);
ALTER TABLE member_wallet ADD COLUMN IF NOT EXISTS account_name VARCHAR(80);
ALTER TABLE member_wallet ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE member_wallet ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE member_wallet
   SET account_code = 'CARD-' || replace(id::text, '-', '')
 WHERE account_code IS NULL;
UPDATE member_wallet
   SET account_name = '默认卡'
 WHERE account_name IS NULL;

ALTER TABLE member_wallet ALTER COLUMN account_code SET NOT NULL;
ALTER TABLE member_wallet ALTER COLUMN account_name SET NOT NULL;
ALTER TABLE member_wallet ALTER COLUMN account_code SET DEFAULT ('CARD-' || replace(gen_random_uuid()::text, '-', ''));
ALTER TABLE member_wallet ALTER COLUMN account_name SET DEFAULT '默认卡';
ALTER TABLE member_wallet DROP CONSTRAINT IF EXISTS member_wallet_member_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS member_wallet_tenant_account_code_uq
  ON member_wallet(tenant_id, account_code);
CREATE UNIQUE INDEX IF NOT EXISTS member_wallet_member_default_uq
  ON member_wallet(member_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS member_wallet_member_active_idx
  ON member_wallet(member_id, active, is_default, created_at);

ALTER TABLE payment_record ADD COLUMN IF NOT EXISTS wallet_id UUID REFERENCES member_wallet(id);
UPDATE payment_record payment
   SET wallet_id = wallet.id
  FROM sales_order order_header
  JOIN member_wallet wallet ON wallet.member_id = order_header.member_id AND wallet.is_default
 WHERE payment.order_id = order_header.id
   AND payment.payment_method = 'MEMBER_BALANCE'
   AND payment.wallet_id IS NULL;
ALTER TABLE payment_record
  DROP CONSTRAINT IF EXISTS payment_record_wallet_method_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'payment_record'::regclass
       AND conname = 'payment_record_wallet_method_check'
  ) THEN
    ALTER TABLE payment_record
      ADD CONSTRAINT payment_record_wallet_method_check
      CHECK ((payment_method = 'MEMBER_BALANCE') = (wallet_id IS NOT NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS payment_record_wallet_idx
  ON payment_record(wallet_id, created_at);

ALTER TABLE refund_payment_record ADD COLUMN IF NOT EXISTS wallet_id UUID REFERENCES member_wallet(id);
UPDATE refund_payment_record refund_payment
   SET wallet_id = payment.wallet_id
  FROM payment_record payment
 WHERE refund_payment.original_payment_id = payment.id
   AND refund_payment.payment_method = 'MEMBER_BALANCE'
   AND refund_payment.wallet_id IS NULL;
ALTER TABLE refund_payment_record
  DROP CONSTRAINT IF EXISTS refund_payment_record_wallet_method_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'refund_payment_record'::regclass
       AND conname = 'refund_payment_record_wallet_method_check'
  ) THEN
    ALTER TABLE refund_payment_record
      ADD CONSTRAINT refund_payment_record_wallet_method_check
      CHECK ((payment_method = 'MEMBER_BALANCE') = (wallet_id IS NOT NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS refund_payment_record_wallet_idx
  ON refund_payment_record(wallet_id, created_at);

COMMENT ON COLUMN member_wallet.account_code IS 'Payment card/account code shown at settlement';
COMMENT ON COLUMN member_wallet.account_name IS 'Payment card/account display name';
COMMENT ON COLUMN payment_record.wallet_id IS 'Actual wallet used by this payment; null for external channels';
COMMENT ON COLUMN refund_payment_record.wallet_id IS 'Original wallet receiving this member-balance refund';
