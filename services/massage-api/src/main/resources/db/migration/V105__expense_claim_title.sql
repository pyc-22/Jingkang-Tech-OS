ALTER TABLE expense_claim
  ADD COLUMN IF NOT EXISTS title VARCHAR(200);

COMMENT ON COLUMN expense_claim.title IS 'Short purpose/title entered by the applicant; null is retained for historical claims';
