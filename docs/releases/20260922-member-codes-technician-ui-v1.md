# 20260922-member-codes-technician-ui-v1

## Scope

- Technician queue and dispatch choices display the technician code in the green avatar and a larger centered heading, without the employee-number label. Names, queue positions, status, counters and selection behavior remain intact.
- New members and card openings allocate a store letter plus five digits. Allocation is an atomic store-row update in the member transaction; failed writes roll back the counter.
- Flyway V101 ranks stores by `(created_at, id)` within each tenant and members by `(created_at, id)` within their registration store. Archived members are included. Reactivation retains the existing code.
- Letters remain stable after migration. New stores take the next letter. The single-letter format supports 26 stores per tenant and 99999 allocated member numbers per store. Exhaustion fails explicitly rather than reusing identifiers.

## Association Review

The current schema references `member.id`, not `member.code`, from wallets, wallet transactions, sales orders and recharge refunds. Commissions reference orders or wallet transactions. Reports resolve members through those UUIDs. V101 changes no UUID, financial amount, business date or business detail row. API queries and member search join the current member code automatically. Immutable audit JSON and previously downloaded reports retain their original historical content; the backup mapping preserves old-to-new traceability.

Custom external systems that store member codes must use `member_code_backup` to reconcile their references before reopening service. V101 intentionally fails if a custom foreign key depends on the old code unique constraint; it does not drop dependent constraints.

## Deployment and Backup

1. Use JDK 21 and PostgreSQL 16. Stop **all** API instances, background jobs and other database writers. Keep the previous JAR and frontend package.
2. Set PostgreSQL credentials using `PGPASSFILE`, `pgpass.conf`, or a process-local `PGPASSWORD`. Never put passwords into scripts, source control or command history.
3. Run the bundled backup script before deploying the new JAR:

```powershell
powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\tools\maintenance\backup-member-codes.ps1 -DatabaseHost 127.0.0.1 -Port 5432 -Database massage_platform -User postgres -MigrationUser massage_app -BackupDirectory C:\wwwroot\jingkang-platform\backup -ApplicationStopped
```

The script creates a full custom-format dump, validates its archive directory, computes SHA256, stores a pre-migration member snapshot, and exports that mapping separately. Retain the entire timestamped backup directory off-server. Restrict it to database operators: it contains personal and financial data.

With the v4 tools, `-MigrationUser` is required: use the actual Flyway database login (confirmed production value: `massage_app`). See `20260922-member-backup-permissions-v4.md` for the current deployment procedure and cross-account permissions.

4. Restore the full dump into a separate test database first (`createdb` followed by `pg_restore --exit-on-error -d TEST_DATABASE DUMP_PATH`). Run the backup script against that restored database, then start this JAR against it and verify the new codes, balances, order history and reports.
5. Deploy the JAR and frontend together, keeping traffic closed. Flyway applies V101 in one transaction. Existing member data without a matching backup snapshot causes startup to stop; investigate or take a fresh backup rather than bypassing the check. Empty installations require no historical backup.
6. Verify `/api/health` reports `20260922-member-codes-technician-ui-v1`, Flyway latest successful version is 101, and the queries below return no mismatches. Verify a member can be found by its new code and inspect its prior orders and recharge/consumption history. Reopen traffic only after these checks.

```sql
SELECT s.name,s.member_code_prefix,s.member_code_next_number,count(m.id)
FROM store s LEFT JOIN member m ON m.registered_store_id=s.id
GROUP BY s.id ORDER BY s.created_at,s.id;

SELECT m.id,m.code,b.old_code,b.migrated_code
FROM member m JOIN member_code_backup b ON b.member_id=m.id
WHERE m.code IS DISTINCT FROM b.migrated_code;

SELECT m.id,m.code FROM member m JOIN store s ON s.id=m.registered_store_id
WHERE m.code !~ '^[A-Z][0-9]{5}$' OR left(m.code,1)<>s.member_code_prefix;

SELECT tenant_id,code,count(*) FROM member GROUP BY tenant_id,code HAVING count(*)>1;
```

## Rollback

Stop every writer first. Do not start either application version during rollback.

For rollback immediately after migration, open an interactive `psql -X -v ON_ERROR_STOP=1` session with the same connection parameters, then:

```sql
\i C:/PATH/TO/tools/maintenance/rollback-member-codes.sql
-- Inspect restored_members and any business checks, then explicitly choose:
COMMIT;
-- Or discard the rollback with ROLLBACK;
```

The script leaves COMMIT commented. A failed statement aborts the transaction; issue `ROLLBACK;` (or disconnect) to release locks. Running with `psql -f` and then disconnecting without COMMIT rolls it back automatically. The script checks V101 is latest, checks membership and versions against the backup, restores old codes and metadata, removes the allocator/format changes, and removes only V101's Flyway history entry so a later redeploy can apply it normally. Restore the previous JAR and frontend **before** restarting service.

If members were created, deleted or edited after migration, the narrow rollback stops for review. Restore the full dump to a **new** database, verify it, reconcile any later transactions, and switch the old application to that database. A full restore represents the backup time, so switching blindly would lose later business writes. Preserve the current database as well. Never restore over a running database.

## Verification Commands

```powershell
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
npm test
npm run build:api
node --test tools/regression/member-code-migration.test.js
node --test tools/regression/quality-review.test.js
# Requires Playwright and an installed Edge browser (NODE_PATH may point to bundled dependencies).
node --test tools/regression/technician-code-ui.test.js
powershell -NoProfile -ExecutionPolicy RemoteSigned -File tools/release/package-quality-release.ps1
```

All database regressions create separate localhost PostgreSQL clusters and stop them at completion. No production database is part of these tests. Release artifacts live under `.artifacts/releases/` and are excluded from Git.

## Verified Results (2026-09-22)

- Frontend suite: 198 passed. Backend suite and JAR build: 181 passed.
- HTTP integration suite: 61 passed, including concurrent member/card creation, store isolation, identifier search, exhaustion, financial workflows and Flyway V101 startup/health.
- Historical migration suite: 3 passed. Full backup restored successfully; old-code swaps, archived members, unchanged business rows, stale-backup rejection, rollback/reapply, concurrent store letters and the A/Z limits were verified.
- Browser rendering/selection suite: 3 passed. Desktop card screenshots were reviewed at 1440 and 1200 pixels; the dispatch dialog and card geometry were also exercised with a 390-pixel viewport. The existing desktop navigation minimum width is unchanged.
- Maintenance suite: 18 passed. Its migration setup now uses transactions like Flyway; cleanup scripts continue to preserve protected orders and roll back on invalid dependencies.
- Production migration is pending deployment and the required stopped-writer backup procedure above.
