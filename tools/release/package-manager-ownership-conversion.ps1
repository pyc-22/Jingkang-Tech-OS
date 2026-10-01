$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$release = '20261001-manager-ownership-conversion-v1'
$releaseDir = Join-Path $root ".artifacts/releases/$release"
$zipPath = "$releaseDir.zip"
$jarSource = Join-Path $root 'services/massage-api/target/massage-api-0.1.0.jar'
$readmeSource = Join-Path $root "docs/releases/$release-update-readme.md"
$frontendFiles = @(
  'app.js', 'index.html', 'manager-rewards-admin.js', 'manager-rewards-admin.css', 'expense-ui.js',
  'manager-mobile.html', 'manager-mobile.js', 'manager-rewards.js', 'manager-rewards.css',
  'mobile.html', 'mobile.js', 'technician-service-worker.js'
)

if ((Test-Path -LiteralPath $releaseDir) -or (Test-Path -LiteralPath $zipPath)) {
  throw "Release output already exists: $releaseDir"
}
foreach ($file in @($jarSource, $readmeSource) + @($frontendFiles | ForEach-Object { Join-Path $root "apps/massage-console/$_" })) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing release input: $file" }
}
$homeSource = Get-Content -LiteralPath (Join-Path $root 'services/massage-api/src/main/java/com/chengxin/massage/HomeController.java') -Raw
$index = Get-Content -LiteralPath (Join-Path $root 'apps/massage-console/index.html') -Raw
$manager = Get-Content -LiteralPath (Join-Path $root 'apps/massage-console/manager-mobile.html') -Raw
$mobile = Get-Content -LiteralPath (Join-Path $root 'apps/massage-console/mobile.html') -Raw
if (-not $homeSource.Contains("RELEASE = `"$release`"")) { throw 'Health release version mismatch' }
if (-not $index.Contains("app.js?v=$release")) { throw 'Console cache version mismatch' }
if (-not $manager.Contains("manager-rewards.js?v=$release")) { throw 'Manager cache version mismatch' }
if (-not $mobile.Contains("mobile.js?v=$release")) { throw 'Technician cache version mismatch' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$jar = [IO.Compression.ZipFile]::OpenRead($jarSource)
try {
  foreach ($entry in @(
    'BOOT-INF/classes/db/migration/V106__store_primary_manager.sql',
    'BOOT-INF/classes/db/migration/V107__service_clock_conversion.sql',
    'BOOT-INF/classes/com/chengxin/massage/operations/ManagerRewardService.class',
    'BOOT-INF/classes/com/chengxin/massage/catalog/ServiceSessionController.class',
    'BOOT-INF/classes/com/chengxin/massage/sales/SalesOrderController.class'
  )) {
    if (-not $jar.GetEntry($entry)) { throw "JAR is missing $entry" }
  }
  $stream = $jar.GetEntry('BOOT-INF/classes/com/chengxin/massage/HomeController.class').Open()
  try {
    $buffer = [IO.MemoryStream]::new()
    $stream.CopyTo($buffer)
    if (-not [Text.Encoding]::GetEncoding('ISO-8859-1').GetString($buffer.ToArray()).Contains($release)) {
      throw 'Packaged JAR health release version mismatch'
    }
  } finally {
    $stream.Dispose()
    if ($buffer) { $buffer.Dispose() }
  }
} finally { $jar.Dispose() }

New-Item -ItemType Directory -Path $releaseDir | Out-Null
foreach ($file in $frontendFiles) {
  Copy-Item -LiteralPath (Join-Path $root "apps/massage-console/$file") -Destination (Join-Path $releaseDir $file)
}
Copy-Item -LiteralPath $jarSource -Destination (Join-Path $releaseDir 'massage-api-0.1.0.jar')
Copy-Item -LiteralPath $readmeSource -Destination (Join-Path $releaseDir 'UPDATE-README')
Get-ChildItem -LiteralPath $releaseDir -File | Sort-Object Name | ForEach-Object {
  '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name
} | Set-Content -LiteralPath (Join-Path $releaseDir 'SHA256SUMS.txt') -Encoding ascii
Compress-Archive -Path (Join-Path $releaseDir '*') -DestinationPath $zipPath
Write-Output "ZIP=$zipPath"
Write-Output "SHA256=$((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant())"
