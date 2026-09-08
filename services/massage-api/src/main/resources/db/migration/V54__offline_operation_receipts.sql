CREATE TABLE offline_operation_receipt (
  operation_id UUID PRIMARY KEY,
  request_method VARCHAR(10) NOT NULL,
  request_path VARCHAR(300) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('PROCESSING','APPLIED')),
  response_status INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ
);

CREATE INDEX offline_operation_receipt_status_created_idx
  ON offline_operation_receipt(status, created_at DESC);
