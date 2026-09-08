ALTER TABLE sales_order
  ADD COLUMN business_correction_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE sales_order_business_correction (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  order_id UUID NOT NULL REFERENCES sales_order(id),
  order_line_id UUID NOT NULL REFERENCES sales_order_line(id),
  service_session_id UUID NOT NULL REFERENCES service_session(id),
  correction_version INTEGER NOT NULL,
  old_technician_id UUID NOT NULL REFERENCES technician(id),
  old_technician_name_snapshot VARCHAR(80) NOT NULL,
  new_technician_id UUID NOT NULL REFERENCES technician(id),
  new_technician_name_snapshot VARCHAR(80) NOT NULL,
  old_clock_type VARCHAR(20) NOT NULL,
  new_clock_type VARCHAR(20) NOT NULL,
  reason VARCHAR(240) NOT NULL,
  corrected_by_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  corrected_by_name_snapshot VARCHAR(120) NOT NULL,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, correction_version)
);

CREATE INDEX sales_order_business_correction_order_idx
  ON sales_order_business_correction(order_id, correction_version DESC);

ALTER TABLE technician_commission_record
  ADD COLUMN business_correction_id UUID REFERENCES sales_order_business_correction(id);

ALTER TABLE technician_commission_record
  DROP CONSTRAINT technician_commission_record_record_type_check,
  DROP CONSTRAINT technician_commission_record_signed_amount_check,
  DROP CONSTRAINT technician_commission_record_clock_adjustment_check,
  DROP CONSTRAINT technician_commission_record_duration_adjustment_check,
  DROP CONSTRAINT IF EXISTS technician_commission_record_clock_type_check;

ALTER TABLE technician_commission_record
  ALTER COLUMN record_type TYPE VARCHAR(32),
  ADD CONSTRAINT technician_commission_record_record_type_check CHECK (
    record_type IN ('SETTLEMENT','REFUND_REVERSAL','ORDER_VOID_REVERSAL','BUSINESS_CORRECTION_REVERSAL','BUSINESS_CORRECTION')
  ),
  ADD CONSTRAINT technician_commission_record_signed_amount_check CHECK (
    (record_type='SETTLEMENT' AND base_amount_cents>=0 AND commission_cents>=0 AND refund_id IS NULL AND original_commission_record_id IS NULL AND business_correction_id IS NULL)
    OR (record_type='REFUND_REVERSAL' AND base_amount_cents<=0 AND commission_cents<=0 AND refund_id IS NOT NULL AND original_commission_record_id IS NOT NULL AND business_correction_id IS NULL)
    OR (record_type='ORDER_VOID_REVERSAL' AND base_amount_cents<=0 AND commission_cents<=0 AND refund_id IS NULL AND original_commission_record_id IS NOT NULL AND business_correction_id IS NULL)
    OR (record_type='BUSINESS_CORRECTION_REVERSAL' AND base_amount_cents<=0 AND commission_cents<=0 AND refund_id IS NULL AND original_commission_record_id IS NOT NULL AND business_correction_id IS NOT NULL)
    OR (record_type='BUSINESS_CORRECTION' AND base_amount_cents>=0 AND commission_cents>=0 AND refund_id IS NULL AND original_commission_record_id IS NULL AND business_correction_id IS NOT NULL)
  ),
  ADD CONSTRAINT technician_commission_record_clock_adjustment_check CHECK (
    (record_type IN ('SETTLEMENT','BUSINESS_CORRECTION') AND clock_count_adjustment BETWEEN 0 AND 1)
    OR (record_type IN ('REFUND_REVERSAL','ORDER_VOID_REVERSAL','BUSINESS_CORRECTION_REVERSAL') AND clock_count_adjustment BETWEEN -1 AND 0)
  ),
  ADD CONSTRAINT technician_commission_record_duration_adjustment_check CHECK (
    (record_type IN ('SETTLEMENT','BUSINESS_CORRECTION') AND duration_minutes_adjustment BETWEEN 0 AND 720)
    OR (record_type IN ('REFUND_REVERSAL','ORDER_VOID_REVERSAL','BUSINESS_CORRECTION_REVERSAL') AND duration_minutes_adjustment BETWEEN -720 AND 0)
  ),
  ADD CONSTRAINT technician_commission_record_clock_type_check CHECK (
    clock_type IN ('QUEUE','CALL','SELECTED','BOOKED_QUEUE','BOOKED_CALL','EXTENSION')
  );

CREATE UNIQUE INDEX technician_commission_business_correction_reversal_unique_idx
  ON technician_commission_record(business_correction_id, original_commission_record_id)
  WHERE record_type='BUSINESS_CORRECTION_REVERSAL';

CREATE INDEX technician_commission_business_correction_idx
  ON technician_commission_record(tenant_id, store_id, business_correction_id)
  WHERE business_correction_id IS NOT NULL;
