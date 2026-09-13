param(
  [string]$Version = '20260912-full-optimization-v1',
  [string]$JarPath = '',
  [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'

function Resolve-FullPath([string]$Path, [string]$BasePath) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
  if ([System.IO.Path]::IsPathRooted($Path)) { return [System.IO.Path]::GetFullPath($Path) }
  return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$releaseDirectory = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  Join-Path $projectRoot 'deploy'
} else {
  Resolve-FullPath $OutputDirectory $projectRoot
}
$stagingRoot = Join-Path $projectRoot ('.release-staging\' + $Version)
$zipPath = Join-Path $releaseDirectory ($Version + '.zip')
$sourceJar = if ([string]::IsNullOrWhiteSpace($JarPath)) {
  Join-Path $projectRoot 'services\massage-api\target\massage-api-0.1.0.jar'
} else {
  Resolve-FullPath $JarPath $projectRoot
}
$frontendSource = Join-Path $projectRoot 'apps\massage-console'
$serverSource = Join-Path $projectRoot 'server.massage.js'
$logbackSource = Join-Path $projectRoot 'services\massage-api\src\main\resources\logback-spring.xml'
$docsSource = Join-Path $projectRoot 'docs'

foreach ($required in @(
  @{ Path = $frontendSource; Kind = 'directory' },
  @{ Path = $sourceJar; Kind = 'file' },
  @{ Path = $serverSource; Kind = 'file' },
  @{ Path = $logbackSource; Kind = 'file' }
)) {
  if ($required.Kind -eq 'directory' -and -not (Test-Path -LiteralPath $required.Path -PathType Container)) {
    throw "Required source directory not found: $($required.Path)"
  }
  if ($required.Kind -eq 'file' -and -not (Test-Path -LiteralPath $required.Path -PathType Leaf)) {
    throw "Required source file not found: $($required.Path)"
  }
}

$docNames = @(
  "$Version-deployment.md",
  "$Version-release-notes.md",
  "$Version-rollback.md",
  "$Version-verification.md"
)
foreach ($docName in $docNames) {
  $docPath = Join-Path $docsSource $docName
  if (-not (Test-Path -LiteralPath $docPath -PathType Leaf)) {
    throw "Required release document not found: $docPath"
  }
}

if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
New-Item -ItemType Directory -Path $stagingRoot, $releaseDirectory -Force | Out-Null

# Copy the complete current-worktree frontend, including assets, APKs, and
# regression fixtures. This intentionally does not read files from Git HEAD.
$frontendDestination = Join-Path $stagingRoot 'apps\massage-console'
New-Item -ItemType Directory -Path $frontendDestination -Force | Out-Null
# Enumerate the source directory first. `-LiteralPath` intentionally does not
# expand a trailing wildcard, so using it with `...\*` would omit the frontend
# or fail on Windows PowerShell.
Get-ChildItem -LiteralPath $frontendSource -Force |
  Copy-Item -Destination $frontendDestination -Recurse -Force

$jarDestination = Join-Path $stagingRoot 'services\massage-api\target\massage-api-0.1.0.jar'
New-Item -ItemType Directory -Path (Split-Path -Parent $jarDestination) -Force | Out-Null
Copy-Item -LiteralPath $sourceJar -Destination $jarDestination -Force

Copy-Item -LiteralPath $serverSource -Destination (Join-Path $stagingRoot 'server.massage.js') -Force
$configDestination = Join-Path $stagingRoot 'config\logback-spring.xml'
New-Item -ItemType Directory -Path (Split-Path -Parent $configDestination) -Force | Out-Null
Copy-Item -LiteralPath $logbackSource -Destination $configDestination -Force

$docsDestination = Join-Path $stagingRoot 'docs'
New-Item -ItemType Directory -Path $docsDestination -Force | Out-Null
foreach ($docName in $docNames) {
  Copy-Item -LiteralPath (Join-Path $docsSource $docName) -Destination $docsDestination -Force
}

$expectedRelease = $Version
$deployScript = @'
param(
  [string]$ProjectRoot = 'C:\wwwroot\jingkang-platform',
  [string]$ServiceName = 'JingkangMassageApi',
  [string]$HealthUrl = 'http://127.0.0.1:8080/api/health',
  [string]$TargetWebRoot = '',
  [string]$TargetJar = ''
)

$ErrorActionPreference = 'Stop'
$releaseRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$expectedRelease = '__VERSION__'
if ([string]::IsNullOrWhiteSpace($TargetWebRoot)) { $TargetWebRoot = Join-Path $ProjectRoot 'apps\massage-console' }
if ([string]::IsNullOrWhiteSpace($TargetJar)) { $TargetJar = Join-Path $ProjectRoot 'services\massage-api\target\massage-api-0.1.0.jar' }
$sourceWebRoot = Join-Path $releaseRoot 'apps\massage-console'
$sourceJar = Join-Path $releaseRoot 'services\massage-api\target\massage-api-0.1.0.jar'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $ProjectRoot ('backup\' + $expectedRelease + '-' + $timestamp)

function Assert-File([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required release file not found: $Path" }
}
function Copy-Tree([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "Source directory not found: $Source" }
  if (Test-Path -LiteralPath $Destination -PathType Container) {
    # Replace the destination as a whole so stale static resources cannot survive a release.
    Get-ChildItem -LiteralPath $Destination -Force | Remove-Item -Recurse -Force
  } else {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  }
  Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}
function Verify-Manifest {
  $sumFile = Join-Path $releaseRoot 'SHA256SUMS.txt'
  Assert-File $sumFile
  $errors = 0
  $expected = @{}
  foreach ($line in Get-Content -LiteralPath $sumFile) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line -split '  ', 2
    if ($parts.Count -ne 2) { $errors++; continue }
    $hash = $parts[0].Trim()
    $relative = $parts[1].Trim()
    if ($hash -notmatch '^[0-9A-Fa-f]{64}$' -or
        [System.IO.Path]::IsPathRooted($relative) -or
        $relative -match '(^|[\\/])\.\.([\\/]|$)' -or
        $relative -eq 'SHA256SUMS.txt') { $errors++; continue }
    $key = $relative.Replace('/', '\')
    if ($expected.ContainsKey($key)) { $errors++; continue }
    $expected[$key] = $true
    $path = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot $key))
    $releasePrefix = $releaseRoot.TrimEnd('\') + '\'
    if (-not $path.StartsWith($releasePrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $path -PathType Leaf) -or
        ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $hash)) { $errors++ }
  }
  $actual = @{}
  foreach ($file in Get-ChildItem -LiteralPath $releaseRoot -Recurse -File) {
    if ($file.FullName -eq $sumFile) { continue }
    $key = $file.FullName.Substring($releaseRoot.Length + 1)
    $actual[$key] = $true
  }
  foreach ($key in $expected.Keys) { if (-not $actual.ContainsKey($key)) { $errors++ } }
  foreach ($key in $actual.Keys) { if (-not $expected.ContainsKey($key)) { $errors++ } }
  if ($expected.Count -ne $actual.Count) {
    $errors++
  }
  if ($errors -gt 0) { throw "Release SHA-256 verification failed: $errors file(s)" }
}

Assert-File $sourceJar
if (-not (Test-Path -LiteralPath $sourceWebRoot -PathType Container)) { throw "Release frontend not found: $sourceWebRoot" }
Verify-Manifest

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$backupWebRoot = Join-Path $backupRoot 'apps\massage-console'
$backupJar = Join-Path $backupRoot 'services\massage-api\target\massage-api-0.1.0.jar'
New-Item -ItemType Directory -Path (Split-Path -Parent $backupWebRoot), (Split-Path -Parent $backupJar) -Force | Out-Null
if (Test-Path -LiteralPath $TargetWebRoot -PathType Container) { Copy-Tree $TargetWebRoot $backupWebRoot }
if (Test-Path -LiteralPath $TargetJar -PathType Leaf) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $backupJar) -Force | Out-Null
  Copy-Item -LiteralPath $TargetJar -Destination $backupJar -Force
}

$stopped = $false
try {
  if ($service -and $service.Status -ne 'Stopped') {
    Stop-Service -Name $ServiceName -Force
    (Get-Service -Name $ServiceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    $stopped = $true
  }
  Copy-Tree $sourceWebRoot $TargetWebRoot
  New-Item -ItemType Directory -Path (Split-Path -Parent $TargetJar) -Force | Out-Null
  Copy-Item -LiteralPath $sourceJar -Destination $TargetJar -Force
  if ((Get-FileHash -LiteralPath $TargetJar -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $sourceJar -Algorithm SHA256).Hash) {
    throw 'Deployed JAR hash mismatch'
  }
  if ($service) {
    Start-Service -Name $ServiceName
    (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
  }
  $healthy = $false
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    Start-Sleep -Seconds 2
    try {
      $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5
      $body = $response.Content | ConvertFrom-Json
      if ([int]$response.StatusCode -eq 200 -and $body.status -eq 'UP' -and $body.release -eq $expectedRelease) { $healthy = $true; break }
    } catch { }
  }
  if (-not $healthy) { throw "Health check did not confirm release $expectedRelease" }
  Write-Output "DEPLOYMENT_OK release=$expectedRelease backup=$backupRoot"
} catch {
  Write-Warning "Deployment failed; restoring backup from $backupRoot"
  if ($service) { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $backupWebRoot -PathType Container) { Copy-Tree $backupWebRoot $TargetWebRoot }
  if (Test-Path -LiteralPath $backupJar -PathType Leaf) { Copy-Item -LiteralPath $backupJar -Destination $TargetJar -Force }
  if ($service -and ($stopped -or $service.Status -eq 'Running')) { Start-Service -Name $ServiceName -ErrorAction SilentlyContinue }
  throw
}
'@
$deployScript = $deployScript.Replace('__VERSION__', $expectedRelease)
$deployScript | Set-Content -LiteralPath (Join-Path $stagingRoot 'DEPLOY.ps1') -Encoding utf8

$serverCommand = @"
# $Version temporary-directory deployment
# 1. Back up the database, current JAR, apps/massage-console and external config.
# 2. Extract this ZIP to an isolated temporary directory; do not overwrite the live directory.
# 3. Run from this directory:
powershell -ExecutionPolicy Bypass -File .\DEPLOY.ps1
# 4. After DEPLOYMENT_OK, restore traffic and refresh browser/PWA clients.
# 5. On failure follow docs/$Version-rollback.md.
"@
$serverCommand | Set-Content -LiteralPath (Join-Path $stagingRoot 'SERVER-COMMAND.txt') -Encoding utf8

$releaseNotes = @"
# $Version release notes

This package is built from the complete current worktree, including committed and uncommitted fixes; it does not read Git HEAD or a clean baseline.

## Contents

- Complete `apps/massage-console/` frontend (front desk, manager, technician, assets, APK and regression fixtures).
- `services/massage-api/target/massage-api-0.1.0.jar` built from the current worktree.
- `server.massage.js` and `config/logback-spring.xml` configuration reference.
- P0 conflict handling, daily-report fixes, V87/V88/V89, technician 403, attendance and historical-backfill code/migrations.
- `DEPLOY.ps1`, deployment command, deployment/rollback/verification docs and `SHA256SUMS.txt`.

## Version

- Health-check release: `$Version`
- Frontend static-resource version: `$Version`
- Database migrations run in Flyway order; back up the database before deployment.
"@
$releaseNotes | Set-Content -LiteralPath (Join-Path $stagingRoot 'RELEASE_NOTES.md') -Encoding utf8

# Write the manifest last and exclude the manifest itself to avoid a self-hash.
$stagingFullPath = [System.IO.Path]::GetFullPath($stagingRoot)
$sumLines = Get-ChildItem -LiteralPath $stagingRoot -Recurse -File |
  Where-Object { $_.Name -ne 'SHA256SUMS.txt' } |
  Sort-Object FullName |
  ForEach-Object {
    $relative = $_.FullName.Substring($stagingFullPath.Length + 1).Replace('\', '/')
    "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)  $relative"
  }
$sumLines | Set-Content -LiteralPath (Join-Path $stagingRoot 'SHA256SUMS.txt') -Encoding ascii

Compress-Archive -Path (Join-Path $stagingRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal
$fileCount = (Get-ChildItem -LiteralPath $stagingRoot -Recurse -File).Count
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
$jarHash = (Get-FileHash -LiteralPath $jarDestination -Algorithm SHA256).Hash
Write-Output "Package=$zipPath"
Write-Output "Staging=$stagingRoot"
Write-Output "Files=$fileCount"
Write-Output "JAR_SHA256=$jarHash"
Write-Output "ZIP_SHA256=$zipHash"
