# Member Recharge Corrections

Release: `20260918-member-recharge-correction-v1`

## Scope

- Member details include a recharge history independent of the latest 200 wallet entries.
- STORE_MANAGER and TENANT_ADMIN with MEMBER_MANAGE can correct an active external payment method and optionally the principal amount. Cashiers have no correction action and the API rejects their writes.
- Payment choices use the store's configured methods, including WeChat, Alipay, cash, bank card and other methods when enabled.
- A trimmed reason is mandatory. Pending or completed refunds block correction; cancelled refunds do not. Bonus amounts remain unchanged.
- No date-age limit. The original business date is retained; today's recharge statistics do not receive the historical adjustment.

## Data Model

This repository uses `wallet_transaction`, `member_wallet`, `DailyReportService` and `daily_operating_report`. It has no `member_recharge`, `cash_flow` or `daily_snapshot` tables.

Flyway V99 adds `corrected_amount_cents`, `correction_version` and `corrected_recharge_id` to `wallet_transaction`.

- Posted ledger `amount_cents`, balance-before/after and created-at remain immutable.
- Financial principal is `coalesce(corrected_amount_cents, amount_cents)` for RECHARGE rows. Reports, member totals and refund limits use this value.
- A principal change appends a signed ADJUSTMENT / RECHARGE_CORRECTION ledger entry linked to the recharge, and updates the wallet in the same transaction. Its business date is the original recharge date; created-at is the actual edit time. It is not counted as a second recharge or a receipt today.
- Payment method and its name snapshot are corrected on the original recharge row. Payment-only edits create no balance adjustment.
- Saved original-date reports have financial fields recalculated; publication status and manual nonfinancial fields are preserved. Unsaved reports remain live projections. Other dates and stores are not updated.
- Principal, report and wallet locks plus optimistic versions protect simultaneous corrections. Refund reservations invalidate recharge versions. A concurrent change returns 409; reload the profile before resubmitting.
- Exceptions roll back principal, wallet, ledger, report and audit together.

## API and Audit

`PUT /api/v1/members/{memberId}/recharges/{rechargeId}/correction`

```json
{"paymentMethod":"ALIPAY","amountCents":12000,"reason":"Receipt reviewed","version":0}
```

Omit `amountCents` or send null for a payment-only edit. Supply the profile's `correctionVersion`. Existing ledger `amountCents` retains its posted meaning; use `rechargeAmountCents` in the recharge history and refund form.

Audit action: `MEMBER_RECHARGE_CORRECTED`. Existing audit APIs expose the actor ID/name, timestamp, original business date, before/after principal and payment method, reason and adjustment ID.

```sql
SELECT actor_user_id, actor_name_snapshot, created_at, store_id, entity_id,
       summary AS reason, before_data, after_data
FROM audit_log
WHERE action = 'MEMBER_RECHARGE_CORRECTED'
ORDER BY created_at DESC;
```

## Validation

Verified locally: 184 frontend tests, 173 backend tests, and 50 PostgreSQL/HTTP/browser tests passed. The browser test submits a real edit at 1440px and 390px widths and confirms cashier actions are hidden. JAR packaging and a clean V1-V99 migration succeeded.

Run with Java 21 and PostgreSQL 16 tools installed:

```powershell
npm.cmd test
npm.cmd run build:api
node --test tools/regression/quality-review.test.js
```

The HTTP suite always creates a new loopback-only PostgreSQL cluster. It covers clean Flyway migration, permissions, original-date channels and saved reports, unchanged current-day totals, opening and renewal principal, wallet equations, corrected refund quotas, historical records beyond 200 ledger entries, validation, concurrent correction/refund and audit-failure rollback.

For Chrome desktop/mobile browser checks, set `REVIEW_BROWSER` to a resolvable Playwright module name or absolute module directory. Screenshots are written inside the temporary `.artifacts/quality-review-*` run directory.

## Deployment

1. Back up the database and deployed files using the existing deployment process.
2. Deploy the packaged console files and `services/massage-api/target/massage-api-0.1.0.jar` together. Keep server-specific configuration and credentials outside this package.
3. Start the API with Java 21. Flyway applies V99 automatically; confirm successful schema history version 99.
4. Check `/api/health` returns status UP and this release identifier.
5. Verify a manager sees the correction action, a cashier does not, and a historical payment-only correction changes the original report channels with a corresponding audit record.
6. Run the packaged read-only `tools/maintenance/inspect_data_quality.sql` against the deployment database and review any findings. Production data was not accessed during development.

Do not roll back only the application after corrections have been posted: older versions do not understand effective principal values. Use a forward fix, or a coordinated database/application restore from a reviewed backup.
