ALTER TABLE expense_review_history
  DROP CONSTRAINT IF EXISTS expense_review_history_action_check;

ALTER TABLE expense_review_history
  ADD CONSTRAINT expense_review_history_action_check
  CHECK (action IN ('SUBMIT','RESUBMIT','WITHDRAW','APPROVE','RETURN','REJECT','PAY','VOID_PAYMENT','CLASSIFY'));

INSERT INTO expense_category(
  id, tenant_id, parent_id, code, name, category_level,
  receipt_required, no_receipt_allowed, sort_order, active
) VALUES (
  '93000000-0000-0000-0000-000000000099',
  '11111111-1111-1111-1111-111111111111',
  NULL,
  'PENDING_FINANCE_CLASSIFICATION',
  '待财务分类',
  1,
  FALSE,
  TRUE,
  9999,
  TRUE
) ON CONFLICT (tenant_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  receipt_required = EXCLUDED.receipt_required,
  no_receipt_allowed = EXCLUDED.no_receipt_allowed,
  active = TRUE,
  updated_at = now();

COMMENT ON COLUMN expense_review_history.action IS
  'Workflow action including finance category reassignment';
