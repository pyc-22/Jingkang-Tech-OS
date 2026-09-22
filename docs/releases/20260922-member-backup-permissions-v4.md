# 20260922-member-backup-permissions-v4

## Confirmed Cause and Scope

The production backup ran as `postgres`, while Flyway ran as `massage_app`.
The backup tables belonged to `postgres` and lacked the privileges required by
V101. PostgreSQL reported SQLSTATE `42501`. A successful dump and a preflight
using only `postgres` did not prove that the application could run the migration.

The backup tool now requires `-MigrationUser` explicitly. In the same transaction
as the member snapshot, it grants that role only:

- `SELECT` on `member_code_backup_run` and `member_code_backup`.
- `UPDATE (migrated_code)` on `member_code_backup`.

It then runs the read-only preflight with `SET LOCAL ROLE` and records both roles
in the manifest. Missing read or column-update privileges stop preflight. This
does not grant superuser, ownership, role membership, or write access to the old
member codes. V101 and every released Flyway checksum remain unchanged.

This complete package retains the v3 JAR integrity checks, prior business
features, member-code allocation and compact horizontal technician cards. Only
backup permissions, their regression coverage, deployment instructions and the
health release identifier change. The historical `ThrowableProxy` error has no
confirmed cause; this fix addresses the independently confirmed V101 blocker.

## Windows Production Deployment

Use this document instead of the older deployment commands bundled for history.
Do not deploy while business writes continue. The currently working rollback can
stay online until a maintenance window has been arranged.

1. Extract the ZIP into a new directory. Set these paths and verify the package:

   ```powershell
   $package = 'C:\wwwroot\updates\20260922-member-backup-permissions-v4'
   $java = 'C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot\bin\java.exe'
   $psql = 'C:\Program Files\PostgreSQL\16\bin\psql.exe'
   $installedJar = 'C:\wwwroot\jingkang-platform\massage-api-0.1.0.jar'
   & "$package\tools\release\verify-release.ps1" -ReleaseDirectory $package -Java $java
   ```

2. Stop `JingkangMassageApi` and all other database writers. Confirm its actual
   child Java process exited and port 8080 is no longer listening. Preserve the
   working JAR, frontend and external configuration. Do not overwrite a running
   JAR. `Running` on the NSSM wrapper alone does not prove API health.

3. Confirm the service still uses `127.0.0.1:5432/massage_platform`, schema `public`
   and migration login `massage_app`. The commands below use those confirmed
   production values. If they differ, use the actual configuration. Inspect the
   migration history before refreshing any member snapshot:

   ```powershell
   & $psql -X -h 127.0.0.1 -p 5432 -U massage_app -d massage_platform -v ON_ERROR_STOP=1 -c "SELECT version, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 3;"
   if ($LASTEXITCODE -ne 0) { throw 'Migration history check failed.' }
   ```

   If V101 is already successful, preserve the original backup and mapping. Skip
   the member backup command below, take an ordinary full backup instead, and
   verify the already-migrated data. Do not alter Flyway history to force a rerun.

4. For the rolled-back, pre-V101 database, take a **fresh full backup** with all
   writers still stopped. Previous backups predate business on the rollback.
   PostgreSQL credentials come from a protected `pgpass.conf`/`PGPASSFILE` or a
   process-local `PGPASSWORD`; do not paste passwords into commands or logs.

   ```powershell
   & "$package\tools\maintenance\backup-member-codes.ps1" -DatabaseHost 127.0.0.1 -Port 5432 -Database massage_platform -User postgres -MigrationUser massage_app -BackupDirectory 'C:\wwwroot\jingkang-platform\backup' -ApplicationStopped
   ```

   Require `V101_BACKUP_READY` and `Backup ready`. Preserve the whole timestamped
   backup directory off-server. Rehearse restore and upgrade in a separate test
   database before production. An earlier manual grant is harmless: the GRANTs
   are repeatable, and the snapshot's TRUNCATE retains existing table privileges.
   If tables were restored or recreated, this script grants the privileges again.

5. Check with an **actual application-role connection** as well. The backup's
   `SET ROLE` verifies privileges but does not apply role-specific login settings
   or verify that role's password. Preserve the service's search path if custom:

   ```powershell
   & $psql -X -h 127.0.0.1 -p 5432 -U massage_app -d massage_platform -v ON_ERROR_STOP=1 -f "$package\tools\maintenance\check-member-codes.sql"
   if ($LASTEXITCODE -ne 0) { throw 'Application-role preflight failed. Keep writers stopped.' }
   ```

   Require `V101_BACKUP_READY`, `V101_READY_EMPTY` or `V101_ALREADY_APPLIED`.
   A failed check stops deployment; do not bypass it or elevate the application
   to superuser. If writes resume, stop writers and repeat the fresh backup.

6. With Java stopped, replace the frontend files from `apps/massage-console` and
   copy `services/massage-api/target/massage-api-0.1.0.jar` to `$installedJar`.
   Keep production credentials, external configuration, uploads and logs intact.
   Do not use `.jar.original` or modify libraries inside the JAR. Compare it:

   ```powershell
   & "$package\tools\release\verify-release.ps1" -ReleaseDirectory $package -InstalledJar $installedJar -Java $java
   ```

7. Start the service and wait for Flyway and Spring startup. Verify using IPv4:

   ```powershell
   & "$package\tools\release\verify-release.ps1" -ReleaseDirectory $package -InstalledJar $installedJar -Java $java -HealthUrl 'http://127.0.0.1:8080/api/health'
   ```

   Require `HTTP_HEALTH_OK 20260922-member-backup-permissions-v4`, `database=UP`,
   and successful Flyway 101. Run the association/code checks in
   `docs/releases/20260922-member-codes-technician-ui-v1.md`. Verify historical
   wallets, transactions and orders, search by the new code, technician cards and
   dispatch selection before reopening traffic. The verifier's intentional
   `EXPECTED_RELEASE_LOGGING_PROBE` exception is followed by `RELEASE_JAR_OK` on
   success; it is not an application startup failure.

## Failure and Rollback

Keep traffic closed and preserve the **new** startup log with timestamps and JAR
hashes. Old accumulated request-thread errors are not a replacement for the first
new startup exception. Do not change the working production database from a local
test or restore an old dump over later business data.

If V101 never committed, restore the previous application files. If it committed,
use the guarded `rollback-member-codes.sql` procedure in the original member-code
release notes before starting the old app. The SQL leaves COMMIT for manual
review. Later member changes can stop narrow rollback; restore separately and
reconcile subsequent writes as documented there.

## Verification

All automated database checks use disposable localhost PostgreSQL clusters.
Production restart and acceptance remain deployment steps, not local test results.
The restricted-role startup test creates schema objects as `massage_app`, backs
up as `postgres`, verifies minimal grants, deliberately removes SELECT and UPDATE
privileges, checks migration rollback, refreshes the backup, upgrades and restarts.

Source verification on 2026-09-22:

- Frontend: 200 passed. Backend: 181 passed, clean executable JAR build succeeded.
- Historical backup/migration/rollback: 3 passed, including a full dump restore.
- Restricted-role startup/permission rejection/upgrade/restart: 1 passed.
- JAR integrity and deployment checks: 7 passed.
- HTTP integration: 61 passed, including fresh-database Flyway startup and health.
- Technician card layout/selection at 1920/1440/1200/390px: 4 passed.

Before delivery, repeat the 73 integrity, startup, HTTP and browser cases against
a fresh extraction using `REVIEW_RELEASE_DIR`. Logs and packages remain under
`.artifacts`, outside Git. V101 SHA256 remains
`90BBFCFFFED9D950909B112758C89F18140F24B7147118EADA2037F6D1F923E5`.
