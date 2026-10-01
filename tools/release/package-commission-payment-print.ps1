$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$release = '20261001-commission-payment-print-v1'
$releaseDir = Join-Path $root ".artifacts/releases/$release"
$zipPath = "$releaseDir.zip"
$jarSource = Join-Path $root 'services/massage-api/target/massage-api-0.1.0.jar'
$readmeSource = Join-Path $root 'docs/releases/20261001-commission-payment-print-v1-update-readme.md'
$frontendFiles = @(
  'app.js', 'index.html', 'manager-mobile.html', 'manager-mobile.js',
  'manager-rewards.js', 'manager-rewards.css',
  'manager-rewards-admin.js', 'manager-rewards-admin.css', 'expense-ui.js'
)

if ((Test-Path -LiteralPath $releaseDir) -or (Test-Path -LiteralPath $zipPath)) {
  throw "Release output already exists: $releaseDir"
}
if (-not (Test-Path -LiteralPath $jarSource -PathType Leaf)) { throw "Missing JAR: $jarSource" }
if (-not (Test-Path -LiteralPath $readmeSource -PathType Leaf)) { throw "Missing README: $readmeSource" }
$frontendSources = @($frontendFiles | ForEach-Object { Join-Path $root "apps/massage-console/$_" })
foreach ($file in $frontendSources) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing frontend file: $file" }
}
$homeSource = Get-Content -LiteralPath (Join-Path $root 'services/massage-api/src/main/java/com/chengxin/massage/HomeController.java') -Raw
$indexSource = Get-Content -LiteralPath (Join-Path $root 'apps/massage-console/index.html') -Raw
if (-not $homeSource.Contains("RELEASE = `"$release`"")) { throw 'Health release does not match package version' }
if (-not $indexSource.Contains("app.js?v=$release")) { throw 'Console app cache version does not match package version' }
$jarEntries = & jar tf $jarSource
if ($LASTEXITCODE -ne 0) { throw 'JAR inspection failed' }
foreach ($entry in @(
  'BOOT-INF/classes/com/chengxin/massage/HomeController.class',
  'BOOT-INF/classes/db/migration/V103__manager_rewards.sql',
  'BOOT-INF/classes/db/migration/V104__member_payment_accounts.sql',
  'BOOT-INF/classes/db/migration/V105__expense_claim_title.sql'
)) {
  if ($jarEntries -notcontains $entry) { throw "JAR is missing required entry: $entry" }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($jarSource)
try {
  $classStream = $archive.GetEntry('BOOT-INF/classes/com/chengxin/massage/HomeController.class').Open()
  try {
    $buffer = [IO.MemoryStream]::new()
    $classStream.CopyTo($buffer)
    $classText = [Text.Encoding]::GetEncoding('ISO-8859-1').GetString($buffer.ToArray())
  } finally {
    $classStream.Dispose()
    if ($buffer) { $buffer.Dispose() }
  }
  if (-not $classText.Contains($release)) { throw 'Packaged JAR health release does not match package version' }
} finally {
  $archive.Dispose()
}

New-Item -ItemType Directory -Path $releaseDir | Out-Null
foreach ($file in $frontendSources) {
  Copy-Item -LiteralPath $file -Destination (Join-Path $releaseDir ([IO.Path]::GetFileName($file)))
}
Copy-Item -LiteralPath $jarSource -Destination (Join-Path $releaseDir 'massage-api-0.1.0.jar')
Copy-Item -LiteralPath $readmeSource -Destination (Join-Path $releaseDir 'UPDATE-README')
Get-ChildItem -LiteralPath $releaseDir -File | Sort-Object Name | ForEach-Object {
  '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name
} | Set-Content -LiteralPath (Join-Path $releaseDir 'SHA256SUMS.txt') -Encoding ascii
Compress-Archive -Path (Join-Path $releaseDir '*') -DestinationPath $zipPath
Write-Output "ZIP=$zipPath"
Write-Output "SHA256=$((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant())"
