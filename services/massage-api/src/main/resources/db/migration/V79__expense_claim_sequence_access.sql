DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'expense_claim_no_seq')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'massage_app') THEN
    GRANT USAGE, SELECT ON SEQUENCE expense_claim_no_seq TO massage_app;
  END IF;
END
$$;
