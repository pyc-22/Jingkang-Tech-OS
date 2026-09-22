# 20260922-release-integrity-v3

## Scope and Evidence

This complete release includes the member-code feature, V101, backup/rollback tools,
and the compact horizontal technician queue and dispatch cards from v2.
Business logic, V101 contents and existing Flyway checksums are unchanged.

The retained v2 JAR has SHA256
`F498F8370B740BB09D2A046160587C0A27E0E863A7384DA0A8C1C74050CDEE61`.
It contains Logback Classic/Core 1.5.11, SLF4J 2.0.16 and
`ch/qos/logback/classic/spi/ThrowableProxy.class`. Its Boot classloader can load that
class and log an exception with a nested cause. The reported production failure
has not been reproduced with that local artifact. The short exception alone does
not establish whether the deployed file was damaged, a different JAR was launched,
a running process retained an overwritten JAR, or a shutdown error obscured the
original startup failure. Preserve the full first startup log for diagnosis.

The supplied production log contains a request-thread (`http-nio-...-exec-55`)
logging error and a separate V101 missing-backup-table error. The latter means the
snapshot tables were absent from the migration connection's search path **at that
time**. A dump file alone does not satisfy V101. Confirm the same host, port,
database, schema and database login, and distinguish pre-backup logs from the next
startup. The new read-only `check-member-codes.sql` reports that connection identity
and checks the snapshot. The backup tool runs it before reporting completion.

This release adds an enforced packaging check: archive CRCs, every nested library,
uncompressed Boot libraries, V101 presence, compiled release identifier, actual
Boot class loading and exception logging. Thin/stale/corrupt artifacts stop the
packaging process. The same check is shipped for Windows PowerShell 5.1/Java 21.
`EXPECTED_RELEASE_LOGGING_PROBE` is a deliberate test exception; successful checks
end with `RELEASE_JAR_OK` and `RELEASE_FILES_OK` and exit code zero.

## Deployment on Windows Server

1. Extract the ZIP to a **new directory**, not over the running installation.
   Set `$package` below to that directory. Use the service's actual Java 21 path.

   ```powershell
   $package = 'C:\wwwroot\updates\20260922-release-integrity-v3'
   $java = 'C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot\bin\java.exe'
   & "$package\tools\release\verify-release.ps1" -ReleaseDirectory $package -Java $java
   ```

2. Keep traffic closed, stop `JingkangMassageApi` and all other API instances and scheduled database writers.
   Confirm that the service's **child Java process has exited** and its port is no
   longer listening. A stopped wrapper is not proof that Java exited. Never
   overwrite a JAR while any process still uses it. Do not terminate unrelated
   Java services.
3. Retain the current JAR/frontend/configuration. Back up the **current database**
   again: the earlier backup predates subsequent business on the rolled-back app.
   Follow `20260922-member-codes-technician-ui-v1.md` and run
   `backup-member-codes.ps1 -ApplicationStopped` against the database actually used
   by the service. Rehearse on a separately restored database first. Preserve all
   backup files off-server. If V101 is already applied, inspect its successful
   Flyway entry and mapping; do not rerun or edit migration history.

   Read the database connection from the NSSM service environment/external config,
   not an unrelated interactive shell. Do not share passwords. For the standard
   `127.0.0.1:5432/massage_platform` connection, after the backup and with writers
   still stopped, run this using the API's actual database role and schema:

   ```powershell
   & 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -X -h 127.0.0.1 -p 5432 -U postgres -d massage_platform -v ON_ERROR_STOP=1 -f "$package\tools\maintenance\check-member-codes.sql"
   ```

   Expected: `V101_BACKUP_READY` (historical members), `V101_READY_EMPTY`, or
   `V101_ALREADY_APPLIED`. An error stops deployment. Set `PGPASSFILE`/`PGPASSWORD`
   locally as needed; preserve the service search path if it is customized.
4. With Java stopped, replace the complete frontend and executable
   `services/massage-api/target/massage-api-0.1.0.jar`. Use the **actual JAR path from
   the Windows service configuration**, which may differ from the bundle layout.
   Retain deployment credentials, external configuration, uploads and logs.
   Do not deploy a `.jar.original`, unpack/recompress the executable JAR, or copy
   individual logging libraries into it.
5. Compare the installed JAR to the bundle **before startup**:

   ```powershell
   $installedJar = 'C:\wwwroot\jingkang-platform\massage-api-0.1.0.jar'
   & "$package\tools\release\verify-release.ps1" -ReleaseDirectory $package -InstalledJar $installedJar -Java $java
   ```

6. Start the service with Java 21 and `-jar "ACTUAL_JAR_PATH"`. Keep its existing
   database and other production settings. Wait for Flyway and application startup.
   Run the same command with `-HealthUrl http://127.0.0.1:8080/api/health`.
   Required: `HTTP_HEALTH_OK 20260922-release-integrity-v3`, database `UP`, successful
   Flyway version 101, valid member codes and unchanged wallet/order data. Use the
   SQL checks in the member-code release notes. Service status `Running` alone is
   not acceptance. Verify queue layout, dispatch selection and a member lookup in
   the browser before reopening traffic.

## Failure and Rollback

On failure keep traffic closed. Preserve the first complete startup log, Java
version, package/installed JAR hashes and service executable/arguments (redact
credentials). Do not add arbitrary logging JARs or disable Flyway. Use a foreground
`java -jar` run only after stopping the service, with the same working directory
and environment, so the first error is visible.

If V101 was not committed, restore the previous application files. If V101 was
committed, follow the guarded database rollback in the member-code release notes
before restoring the old app. Do not restore an old full dump over newer business
data; restore separately and reconcile later writes as documented there.

## Verification

Build from source with `npm run build:api` (Maven `clean package`, including tests).
Run `npm run test:console` and the release integrity, member-code migration,
release-startup, quality-review and technician-code-ui suites under
`tools/regression/`. Set `REVIEW_RELEASE_DIR` to a fresh extraction of the ZIP for
the final runtime, HTTP and browser tests. All database tests use disposable
localhost PostgreSQL clusters; no production database is accessed.

Source verification on 2026-09-22: frontend 200 passed; backend 181 passed;
release integrity 7 passed; historical migration/backup/rollback 3 passed;
real Boot startup/upgrade/restart 1 passed; HTTP 61 passed; browser layout and
selection at 1920/1440/1200/390px 4 passed. The clean Maven build succeeded.
