ALTER TABLE technician
  ADD COLUMN wrist_card_no VARCHAR(120);

CREATE UNIQUE INDEX technician_store_wrist_card_no_idx
  ON technician(store_id, wrist_card_no)
  WHERE wrist_card_no IS NOT NULL;
