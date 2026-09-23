# 20260923-member-cleanup-reports-v1

## Scope

V102 marks recharge, gift and recharge-refund wallet rows associated with successful test-balance cleanup as excluded from performance reports. Wallet balances, members and posted ledger rows are not deleted. Ordinary member deactivation does not exclude real business. Saved daily reports are refreshed on startup for affected store dates; their prior and new values are recorded in `member_cleanup_report_repair`.

## Deploy

1. Stop `JingkangMassageApi` and take a new full PostgreSQL backup before deploying. Also retain the current JAR and console files. Do not rely on a backup made before later production transactions.
2. Verify the release checksum and replace the JAR and console files from this package. If V101 has not yet run, complete its separate member-code backup preflight first.
3. Start the service. Confirm `/api/health` reports `UP` and release `20260923-member-cleanup-reports-v1`, Flyway V102 succeeded, and the startup log reports `Member cleanup report repair checked ... report(s)`.
4. Compare the affected dates and payment channels in the daily report. For example, locate F00009 by member code, inspect its cleanup adjustment and recharge rows, and verify the original business dates no longer include its 1288 recharge. The correction is date-scoped; the cleanup date is not credited or debited again.

```sql
SELECT version, success FROM flyway_schema_history WHERE version = '102';
SELECT m.code, wt.business_date, wt.transaction_type, wt.amount_cents, wt.report_excluded
FROM member m JOIN wallet_transaction wt ON wt.member_id = m.id
WHERE m.code = 'F00009' ORDER BY wt.created_at, wt.id;
SELECT r.business_date, r.store_id, r.before_data->>'daily_card_sale_cents' AS before_sale_cents,
       r.after_data->>'daily_card_sale_cents' AS after_sale_cents, r.created_at
FROM member_cleanup_report_repair r ORDER BY r.created_at DESC;
```

The F00009 query is an inspection aid, not a migration prerequisite: the production account and dates are not present in the local test fixture. If there is no successful cleanup audit or `ADMIN_TEST_CLEANUP` transaction for an old case, review the evidence before changing its reporting classification.

## Rollback

For an application rollback, restore the previous JAR and console files; keep the V102 database schema and correction evidence intact. For a database rollback, stop the service and restore the full pre-deployment backup into a separate database first, verify its contents, and follow the normal controlled database restore process. Do not delete repair evidence or reset Flyway history by hand.
