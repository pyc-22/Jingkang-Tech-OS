# Expense Workspace

Release: `20260918-expense-workspace-v1`

## Changes

- Manager mobile: persisted date/status filters, four clickable metrics, state-striped rows, newest submissions first, twenty-row pages, automatic loading near the bottom and a loaded/total counter. Manual refresh resets pagination; background refresh preserves already loaded pages.
- Finance desktop: two plus three metric layout, store/applicant/category/status/date/number filters, date presets and reset, sticky time/amount-sortable table, pagination and batch review.
- Details: maximum 900px width, basic/expense/review/payment information, attachment navigation and an operation timeline. Existing category assignment, submission and payment workflows remain available.
- Both clients export every matching record, not only the current page. XLSX includes number, submission time, category, numeric amount, status, applicant, remarks, store and expense date. User text is written as text, not formulas.
- Lucide static 1.47.0 icons are bundled locally with their license; no runtime CDN is required.

## Scope and Statistics

- Dates refer to submission time in `Asia/Shanghai`, inclusive of both selected days. The default is today plus the preceding 29 days. Drafts use creation time for date inclusion.
- Effective application amount includes only `SUBMITTED`, `APPROVED` and `PAID`. Draft, returned, rejected and withdrawn claims contribute no effective amount.
- Pending means `SUBMITTED`; manager "reviewed" and finance "awaiting payment" both mean `APPROVED`; paid means `PAID`.
- Metrics describe all records matching the selected filters, including the status filter, not just loaded rows. Click an active status card again to return to all statuses.
- The manager is scoped to the selected, permitted store. Finance defaults to all stores. Select the same store, dates and status to compare both clients.
- The lower, existing finance report retains its own date/store controls. Its default date range and effective-amount definition now match the claim browser.
- Read queries use a shared repeatable-read snapshot. Authentication/session renewal completes before the read-only statistics transaction starts.

## APIs and Compatibility

New GET endpoints:

- `/api/v1/expense-claims/page` and `/export`: `EXPENSE_STORE_VIEW` plus store-scope validation.
- `/api/v1/finance/expense-claims/page` and `/export`: `EXPENSE_REVIEW` plus `EXPENSE_ALL_STORE_VIEW`.

Query fields: `from`, `to`, `storeId`, `categoryId`, `applicant`, `status`, `claimNo`, `sort=time|amount`, `direction=asc|desc`, `page` (zero-based), `size` (default 20, maximum 100). Store endpoints always use the authenticated store scope. `status=EFFECTIVE` selects submitted, approved and paid claims. Parent categories include their children. Exports ignore pagination.

`POST /api/v1/finance/expense-claims/batch-review`:

```json
{"ids":["CLAIM_UUID"],"action":"APPROVED","comment":"Receipts verified"}
```

Use `APPROVED` or `REJECTED`, 1-100 distinct IDs and a nonblank common comment. Pending-finance-classification claims still require classification before approval. Sorted row locks serialize overlapping batches and single reviews. A missing, stale or otherwise ineligible claim rolls back the entire batch. Each successful claim retains its own actor, audit record and review history.

Existing nonpaged list endpoints and their response shapes remain unchanged. Flyway V100 adds two browse indexes only; no business records are rewritten.

## Verification

Verified on 2026-09-18: 195 frontend tests, 179 backend tests and 59 PostgreSQL/API/browser integration tests passed, with no skips. The Java 21 release JAR builds successfully. The integration run applied all 100 Flyway migrations to a fresh database and checked the release health endpoint. Screenshots at 390px, 1200px and 1440px were inspected.

Commands, with Java 21 and PostgreSQL 16 tools installed:

```powershell
npm.cmd test
npm.cmd run build:api
$env:REVIEW_BROWSER = '<Playwright module directory>'
node --test tools/regression/quality-review.test.js
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/release/package-quality-release.ps1
$env:REVIEW_RELEASE_DIR = '<absolute release directory>'
node --test tools/regression/quality-review.test.js
```

The integration harness creates a fresh loopback PostgreSQL cluster and starts the JAR and console proxy. It does not connect to the production database. Coverage includes full summaries beyond 500 rows, matching mobile/finance scopes, China midnight boundaries, literal search, sort order, permissions, complete XLSX exports, audit/history, atomic rollback, independent-session concurrency and session/statistics concurrency.

Browser checks cover 390px mobile and 1200/1440px desktop, persisted filters, automatic paging, downloads, sorting, batch review, grouped details, attachments and document overflow. Screenshots are written under the run's `.artifacts/quality-review-*` directory.

## Deployment

1. Back up deployed files and the database using the existing deployment process.
2. Deploy console assets and the JAR together. Preserve server-specific configuration, credentials and uploaded attachments.
3. Start the API with Java 21; confirm Flyway V100 succeeds and `/api/health` returns `UP` with this release identifier.
4. Compare manager and finance totals using the same store/date/status selection, export a filtered file, and verify a small batch review and its audit entries.
5. The release contains `release.json` with the source commit and `SHA256SUMS.txt`. Verify these before deployment.

Production deployment and production database inspection are not part of the local verification run. Existing recharge-correction migration compatibility requirements from the preceding release remain applicable.
