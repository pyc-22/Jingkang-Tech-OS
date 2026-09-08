ALTER TABLE sales_order
  ADD COLUMN corrected_from_order_id UUID REFERENCES sales_order(id),
  ADD COLUMN correction_reason VARCHAR(240);

ALTER TABLE sales_order_service_session
  DROP CONSTRAINT IF EXISTS sales_order_service_session_service_session_id_key;

CREATE INDEX sales_order_corrected_from_idx
  ON sales_order(corrected_from_order_id)
  WHERE corrected_from_order_id IS NOT NULL;

CREATE UNIQUE INDEX sales_order_active_correction_unique_idx
  ON sales_order(corrected_from_order_id)
  WHERE corrected_from_order_id IS NOT NULL
    AND status <> 'CANCELLED'
    AND refund_status <> 'FULL';

ALTER TABLE technician_commission_record
  DROP CONSTRAINT technician_commission_record_record_type_check,
  DROP CONSTRAINT technician_commission_record_signed_amount_check,
  DROP CONSTRAINT technician_commission_record_clock_adjustment_check,
  DROP CONSTRAINT technician_commission_record_duration_adjustment_check;

ALTER TABLE technician_commission_record
  ADD CONSTRAINT technician_commission_record_record_type_check
    CHECK (record_type IN ('SETTLEMENT','REFUND_REVERSAL','ORDER_VOID_REVERSAL')),
  ADD CONSTRAINT technician_commission_record_signed_amount_check CHECK (
    (record_type='SETTLEMENT' AND base_amount_cents>=0 AND commission_cents>=0 AND refund_id IS NULL AND original_commission_record_id IS NULL)
    OR
    (record_type='REFUND_REVERSAL' AND base_amount_cents<=0 AND commission_cents<=0 AND refund_id IS NOT NULL AND original_commission_record_id IS NOT NULL)
    OR
    (record_type='ORDER_VOID_REVERSAL' AND base_amount_cents<=0 AND commission_cents<=0 AND refund_id IS NULL AND original_commission_record_id IS NOT NULL)
  ),
  ADD CONSTRAINT technician_commission_record_clock_adjustment_check CHECK (
    (record_type='SETTLEMENT' AND clock_count_adjustment BETWEEN 0 AND 1)
    OR
    (record_type IN ('REFUND_REVERSAL','ORDER_VOID_REVERSAL') AND clock_count_adjustment BETWEEN -1 AND 0)
  ),
  ADD CONSTRAINT technician_commission_record_duration_adjustment_check CHECK (
    (record_type='SETTLEMENT' AND duration_minutes_adjustment BETWEEN 0 AND 720)
    OR
    (record_type IN ('REFUND_REVERSAL','ORDER_VOID_REVERSAL') AND duration_minutes_adjustment BETWEEN -720 AND 0)
  );

CREATE UNIQUE INDEX technician_commission_order_void_adjustment_unique_idx
  ON technician_commission_record(order_id,original_commission_record_id)
  WHERE record_type='ORDER_VOID_REVERSAL';
