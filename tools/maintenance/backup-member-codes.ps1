param(
  [string]$DatabaseHost = '127.0.0.1',
  [int]$Port = 5432,
  [string]$Database = 'massage_platform',
  [string]$User = 'postgres',
  [Parameter(Mandatory=$true)][string]$BackupDirectory,
  [string]$PgBin = 'C:\Program Files\PostgreSQL\16\bin',
  [switch]$ApplicationStopped
)
$ErrorActionPreference = 'Stop'
if (-not $ApplicationStopped) { throw 'Stop all application instances and scheduled writers, then pass -ApplicationStopped.' }
New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
$output = Join-Path (Resolve-Path -LiteralPath $BackupDirectory).Path (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
New-Item -ItemType Directory -Path $output | Out-Null
$dump = Join-Path $output 'before-member-codes.dump'
$connection = @('-h', $DatabaseHost, '-p', "$Port", '-U', $User, '-d', $Database, '-w')
# Credentials come from PGPASSFILE/pgpass.conf or PGPASSWORD, never script arguments.
& "$PgBin\pg_dump.exe" @connection --format=custom --file=$dump
if ($LASTEXITCODE -ne 0 -or (Get-Item -LiteralPath $dump).Length -eq 0) { throw 'Full database backup failed.' }
& "$PgBin\pg_restore.exe" --list $dump | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Backup archive validation failed.' }
$hash = (Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash
& "$PgBin\psql.exe" @connection -X -v ON_ERROR_STOP=1 -v "dump_file=$dump" -v "dump_sha256=$hash" -f "$PSScriptRoot\backup-member-codes.sql"
if ($LASTEXITCODE -ne 0) { throw 'Member code snapshot failed. Keep the application stopped.' }
& "$PgBin\psql.exe" @connection -X -v ON_ERROR_STOP=1 -f "$PSScriptRoot\check-member-codes.sql"
if ($LASTEXITCODE -ne 0) { throw 'Member code backup preflight failed. Keep the application stopped.' }
# The full dump predates the snapshot tables; preserve those separately as well.
& "$PgBin\pg_dump.exe" @connection --format=custom --table=member_code_backup --table=member_code_backup_run --file="$output\member-code-map.dump"
if ($LASTEXITCODE -ne 0) { throw 'Member code map export failed.' }
[pscustomobject]@{ databaseHost=$DatabaseHost; port=$Port; database=$Database; user=$User;
  backup=$dump; sha256=$hash; createdAt=(Get-Date).ToUniversalTime().ToString('o') } |
  ConvertTo-Json | Set-Content -LiteralPath "$output\manifest.json" -Encoding utf8
Write-Output "Backup ready: $dump"
Write-Output "SHA256: $hash"
