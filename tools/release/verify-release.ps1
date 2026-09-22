param(
  [string]$ReleaseDirectory = (Join-Path $PSScriptRoot '../..'),
  [string]$InstalledJar,
  [string]$Java = 'java',
  [string]$HealthUrl
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$release = Get-Content -LiteralPath (Join-Path $root 'release.json') -Raw | ConvertFrom-Json
$jarRelativePath = 'services/massage-api/target/massage-api-0.1.0.jar'
$jarHash = $null
$count = 0
foreach ($line in Get-Content -LiteralPath (Join-Path $root 'SHA256SUMS.txt')) {
  if ($line -notmatch '^([A-Fa-f0-9]{64})  (.+)$') { throw 'Invalid checksum manifest.' }
  $expected = $Matches[1]
  $relative = $Matches[2]
  $path = [IO.Path]::GetFullPath((Join-Path $root $relative))
  if (-not $path.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path outside release directory: $relative"
  }
  if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $expected) { throw "Checksum mismatch: $relative" }
  if ($relative -eq $jarRelativePath) { $jarHash = $expected }
  $count++
}
if (-not $jarHash) { throw 'Executable JAR is missing from the manifest.' }
$jar = Join-Path $root $jarRelativePath
if ($InstalledJar) {
  $jar = (Resolve-Path -LiteralPath $InstalledJar).Path
  if ((Get-FileHash -LiteralPath $jar -Algorithm SHA256).Hash -ne $jarHash) { throw 'Installed JAR differs from the release.' }
}
& $Java --class-path $jar (Join-Path $PSScriptRoot 'VerifyReleaseJar.java') $jar $release.release
if ($LASTEXITCODE -ne 0) { throw 'Executable JAR verification failed.' }
if ($HealthUrl) {
  $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 15
  if ($health.status -ne 'UP' -or $health.database -ne 'UP' -or $health.release -ne $release.release) {
    throw 'HTTP health or release version mismatch.'
  }
  Write-Output "HTTP_HEALTH_OK $($health.release)"
}
Write-Output "RELEASE_FILES_OK count=$count JAR_SHA256=$jarHash"
