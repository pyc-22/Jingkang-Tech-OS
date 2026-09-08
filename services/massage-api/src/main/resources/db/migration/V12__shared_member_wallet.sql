ALTER TABLE member RENAME COLUMN store_id TO registered_store_id;
ALTER TABLE member_wallet RENAME COLUMN store_id TO opened_store_id;

ALTER TABLE member DROP CONSTRAINT member_store_id_code_key;
ALTER TABLE member DROP CONSTRAINT member_store_id_phone_key;
ALTER TABLE member_wallet DROP CONSTRAINT member_wallet_store_id_member_id_key;

ALTER TABLE member ADD CONSTRAINT member_tenant_code_key UNIQUE(tenant_id, code);
ALTER TABLE member ADD CONSTRAINT member_tenant_phone_key UNIQUE(tenant_id, phone);
ALTER TABLE member_wallet ADD CONSTRAINT member_wallet_member_id_key UNIQUE(member_id);

CREATE INDEX member_tenant_active_idx ON member(tenant_id, active, created_at DESC);
CREATE INDEX member_wallet_member_idx ON member_wallet(member_id);
