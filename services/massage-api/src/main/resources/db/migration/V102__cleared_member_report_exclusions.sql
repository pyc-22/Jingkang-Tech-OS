-- Reporting metadata only: never delete members, wallet history or financial amounts.
ALTER TABLE wallet_transaction ADD COLUMN report_excluded BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX wallet_transaction_report_excluded_idx ON wallet_transaction(tenant_id,member_id)
  WHERE report_excluded;

-- Ordinary MEMBER_DEACTIVATED is deliberately not a test-data cleanup.
WITH cleanup AS (
  SELECT tenant_id,member_id,max(created_at) cleared_at FROM (
    SELECT tenant_id,member_id,created_at FROM wallet_transaction
    WHERE transaction_type='ADJUSTMENT' AND source='ADMIN_TEST_CLEANUP'
    UNION ALL
    SELECT tenant_id,entity_id,created_at FROM audit_log
    WHERE entity_type='member' AND result='SUCCESS'
      AND action IN ('MEMBER_TEST_BALANCE_CLEARED_AND_DEACTIVATED','MEMBER_PURGED')
  ) evidence GROUP BY tenant_id,member_id
)
UPDATE wallet_transaction wt SET report_excluded=TRUE FROM cleanup c
WHERE wt.tenant_id=c.tenant_id AND wt.member_id=c.member_id AND wt.created_at<=c.cleared_at
  AND (wt.transaction_type IN ('RECHARGE','BONUS')
    OR (wt.transaction_type='ADJUSTMENT' AND wt.source IN ('RECHARGE_REFUND','RECHARGE_REFUND_BONUS')));

-- Linked gifts/refunds follow the original recharge even if posted after cleanup.
-- Consumption and order refunds remain real business and are not excluded.
CREATE VIEW reporting_wallet_transaction AS
SELECT wt.* FROM wallet_transaction wt
WHERE NOT wt.report_excluded
  AND NOT EXISTS (
    SELECT 1 FROM wallet_transaction original
    WHERE original.id=wt.recharge_id AND original.tenant_id=wt.tenant_id
      AND original.member_id=wt.member_id AND original.report_excluded
      AND wt.transaction_type='BONUS'
  )
  AND NOT EXISTS (
    SELECT 1 FROM member_recharge_refund refund
    JOIN wallet_transaction original ON original.id=refund.original_transaction_id
    WHERE refund.tenant_id=wt.tenant_id AND refund.store_id=wt.store_id
      AND refund.member_id=wt.member_id AND refund.refund_no=wt.note
      AND original.report_excluded AND wt.transaction_type='ADJUSTMENT'
      AND wt.source IN ('RECHARGE_REFUND','RECHARGE_REFUND_BONUS')
  );

-- Saved financial snapshots are repaired by the application using DailyReportService.
-- Keep before/after evidence without rewriting publication history or manual fields.
CREATE TABLE member_cleanup_report_repair (
  id UUID PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES daily_operating_report(id),
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  business_date DATE NOT NULL,
  before_data JSONB NOT NULL,
  after_data JSONB NOT NULL,
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
