-- A new principal references itself; its bonus rows reference that principal.
-- NULL on legacy rows means unreviewed, including recharges with no known bonus.
ALTER TABLE wallet_transaction ADD COLUMN recharge_id UUID REFERENCES wallet_transaction(id);
ALTER TABLE wallet_transaction ADD CONSTRAINT wallet_recharge_link_type CHECK (
  recharge_id IS NULL OR
  (transaction_type='RECHARGE' AND recharge_id=id) OR
  (transaction_type='BONUS' AND recharge_id<>id)
);
CREATE INDEX wallet_transaction_recharge_idx ON wallet_transaction(recharge_id) WHERE recharge_id IS NOT NULL;
