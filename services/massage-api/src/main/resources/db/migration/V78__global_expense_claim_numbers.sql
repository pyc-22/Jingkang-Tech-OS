CREATE SEQUENCE expense_claim_no_seq AS BIGINT START WITH 1 INCREMENT BY 1;

SELECT setval(
  'expense_claim_no_seq',
  COALESCE(
    (
      SELECT max(
        CASE
          WHEN claim_no ~ '^EXP-[0-9]{8}-[0-9]+$'
            THEN split_part(claim_no, '-', 3)::BIGINT
          ELSE 0
        END
      )
      FROM expense_claim
    ),
    0
  ) + 1,
  false
);
