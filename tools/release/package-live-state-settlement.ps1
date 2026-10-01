$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$sourceRelease = '20261001-live-state-settlement-v1'
$packageVersion = '20261001-live-state-settlement-v2'
$jarSource = Join-Path $root 'services/massage-api/target/massage-api-0.1.0.jar'
$releaseDir = Join-Path $root ".artifacts/releases/$packageVersion"
$zipPath = "$releaseDir.zip"

if (Test-Path -LiteralPath $releaseDir) { throw "Output already exists: $releaseDir" }
if (Test-Path -LiteralPath $zipPath) { throw "Output already exists: $zipPath" }
if (-not (Test-Path -LiteralPath $jarSource -PathType Leaf)) { throw "Missing packaged JAR: $jarSource" }

$frontendFiles = @(
  'app.js',
  'index.html',
  'manager-mobile.html',
  'manager-mobile.js',
  'manager-rewards.js',
  'manager-rewards.css',
  'manager-rewards-admin.js',
  'manager-rewards-admin.css',
  'expense-ui.js'
)
$sourceFiles = @($frontendFiles | ForEach-Object { Join-Path $root "apps/massage-console/$_" })
foreach ($file in $sourceFiles) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing frontend file: $file" }
}

$jarEntries = & jar tf $jarSource
foreach ($entry in @(
  'BOOT-INF/classes/db/migration/V103__manager_rewards.sql',
  'BOOT-INF/classes/db/migration/V104__member_payment_accounts.sql',
  'BOOT-INF/classes/db/migration/V105__expense_claim_title.sql',
  'BOOT-INF/classes/com/chengxin/massage/operations/ManagerRewardController.class',
  'BOOT-INF/classes/com/chengxin/massage/operations/ManagerRewardService.class',
  'BOOT-INF/classes/com/chengxin/massage/operations/RewardTierService.class'
)) {
  if ($jarEntries -notcontains $entry) { throw "JAR is missing required entry: $entry" }
}

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
foreach ($file in $sourceFiles) {
  Copy-Item -LiteralPath $file -Destination (Join-Path $releaseDir ([IO.Path]::GetFileName($file)))
}
Copy-Item -LiteralPath $jarSource -Destination (Join-Path $releaseDir 'massage-api-0.1.0.jar')

$readme = Get-Content -LiteralPath (Join-Path $root 'docs/releases/20261001-live-state-settlement-v2-update-readme.md') -Raw -Encoding UTF8
$readme | Set-Content -LiteralPath (Join-Path $releaseDir 'UPDATE-README') -Encoding utf8

$revision = (& git -C $root rev-parse HEAD).Trim()
$manifestFiles = Get-ChildItem -LiteralPath $releaseDir -File | Sort-Object Name
$manifestFiles | ForEach-Object {
  '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash, $_.Name
} | Set-Content -LiteralPath (Join-Path $releaseDir 'SHA256SUMS.txt') -Encoding ascii
[ordered]@{
  packageVersion = $packageVersion
  codeRelease = $sourceRelease
  sourceCommit = $revision
  frontendFiles = $frontendFiles
  jar = 'massage-api-0.1.0.jar'
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $releaseDir 'release.json') -Encoding utf8

Compress-Archive -Path (Join-Path $releaseDir '*') -DestinationPath $zipPath
Write-Output "RELEASE_DIR=$releaseDir"
Write-Output "ZIP=$zipPath"
Get-FileHash -LiteralPath $zipPath -Algorithm SHA256
