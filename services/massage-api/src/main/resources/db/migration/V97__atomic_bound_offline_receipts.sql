ALTER TABLE offline_operation_receipt
  ADD COLUMN user_id UUID REFERENCES app_user(id),
  ADD COLUMN store_id UUID REFERENCES store(id),
  ADD COLUMN request_hash VARCHAR(64);
ALTER TABLE offline_operation_receipt DROP CONSTRAINT offline_operation_receipt_status_check;
ALTER TABLE offline_operation_receipt ADD CONSTRAINT offline_operation_receipt_status_check
  CHECK (status IN ('PROCESSING','APPLIED','REVIEW_REQUIRED'));
-- Legacy PROCESSING can mean the business transaction committed before a crash.
-- Never delete these receipts or blindly replay their money movement.
UPDATE offline_operation_receipt SET status='REVIEW_REQUIRED' WHERE status='PROCESSING';
