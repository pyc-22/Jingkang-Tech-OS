ALTER TABLE sales_refund
  ADD COLUMN refund_kind VARCHAR(24) NOT NULL DEFAULT 'PARTIAL_REFUND'
    CHECK (refund_kind IN ('PARTIAL_REFUND','FULL_REVERSAL')),
  ADD COLUMN signed_total_cents BIGINT GENERATED ALWAYS AS (-total_cents) STORED,
  ADD COLUMN requested_by_user_id UUID REFERENCES app_user(id),
  ADD COLUMN requested_by_name_snapshot VARCHAR(120),
  ADD COLUMN completed_by_user_id UUID REFERENCES app_user(id),
  ADD COLUMN completed_by_name_snapshot VARCHAR(120);

CREATE INDEX sales_refund_store_business_kind_idx
  ON sales_refund(tenant_id,store_id,business_date,refund_kind,status);

ALTER TABLE technician_commission_record
  ADD COLUMN record_type VARCHAR(20) NOT NULL DEFAULT 'SETTLEMENT'
    CHECK (record_type IN ('SETTLEMENT','REFUND_REVERSAL')),
  ADD COLUMN refund_id UUID REFERENCES sales_refund(id),
  ADD COLUMN original_commission_record_id UUID REFERENCES technician_commission_record(id),
  ADD COLUMN clock_count_adjustment SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN duration_minutes_adjustment SMALLINT NOT NULL DEFAULT 0;

UPDATE technician_commission_record commission
SET clock_count_adjustment=1,
    duration_minutes_adjustment=session.planned_duration_minutes
FROM service_session session
WHERE commission.service_session_id=session.id
  AND commission.service_session_extension_id IS NULL
  AND session.counts_as_clock_snapshot=true;

ALTER TABLE technician_commission_record
  DROP CONSTRAINT technician_commission_record_base_amount_cents_check,
  DROP CONSTRAINT technician_commission_record_commission_cents_check;

ALTER TABLE technician_commission_record
  ADD CONSTRAINT technician_commission_record_signed_amount_check CHECK (
    (record_type='SETTLEMENT' AND base_amount_cents>=0 AND commission_cents>=0 AND refund_id IS NULL AND original_commission_record_id IS NULL)
    OR
    (record_type='REFUND_REVERSAL' AND base_amount_cents<=0 AND commission_cents<=0 AND refund_id IS NOT NULL AND original_commission_record_id IS NOT NULL)
  ),
  ADD CONSTRAINT technician_commission_record_clock_adjustment_check CHECK (
    (record_type='SETTLEMENT' AND clock_count_adjustment BETWEEN 0 AND 1)
    OR
    (record_type='REFUND_REVERSAL' AND clock_count_adjustment BETWEEN -1 AND 0)
  ),
  ADD CONSTRAINT technician_commission_record_duration_adjustment_check CHECK (
    (record_type='SETTLEMENT' AND duration_minutes_adjustment BETWEEN 0 AND 720)
    OR
    (record_type='REFUND_REVERSAL' AND duration_minutes_adjustment BETWEEN -720 AND 0)
  );

DROP INDEX technician_commission_main_unique_idx;
DROP INDEX technician_commission_extension_unique_idx;

CREATE UNIQUE INDEX technician_commission_main_unique_idx
  ON technician_commission_record(order_id,service_session_id)
  WHERE record_type='SETTLEMENT' AND service_session_extension_id IS NULL;

CREATE UNIQUE INDEX technician_commission_extension_unique_idx
  ON technician_commission_record(order_id,service_session_extension_id)
  WHERE record_type='SETTLEMENT' AND service_session_extension_id IS NOT NULL;

CREATE UNIQUE INDEX technician_commission_refund_adjustment_unique_idx
  ON technician_commission_record(refund_id,original_commission_record_id)
  WHERE record_type='REFUND_REVERSAL';

CREATE INDEX technician_commission_refund_idx
  ON technician_commission_record(tenant_id,store_id,refund_id)
  WHERE record_type='REFUND_REVERSAL';
