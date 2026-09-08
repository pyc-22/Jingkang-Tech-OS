CREATE TABLE technician_account_binding (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  user_id UUID NOT NULL REFERENCES app_user(id),
  technician_id UUID NOT NULL REFERENCES technician(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id),
  UNIQUE(store_id, technician_id)
);
CREATE INDEX technician_account_binding_scope_idx ON technician_account_binding(tenant_id, store_id, user_id, active);

INSERT INTO app_user(id,tenant_id,login_name,display_name,password_hash) VALUES
('80000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','tech-liqing','李清','LOCAL_DEMO_ONLY');
INSERT INTO technician_account_binding(id,tenant_id,store_id,user_id,technician_id) VALUES
('81000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','80000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002');
