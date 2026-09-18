CREATE INDEX expense_claim_submitted_scope_idx
  ON expense_claim(tenant_id, store_id, (coalesce(submitted_at, created_at)) DESC, id DESC);
CREATE INDEX expense_claim_submitted_tenant_idx
  ON expense_claim(tenant_id, (coalesce(submitted_at, created_at)) DESC, id DESC);
