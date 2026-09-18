$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $root
try {
  $source = Get-Content 'services/massage-api/src/main/java/com/chengxin/massage/HomeController.java' -Raw
  $version = [regex]::Match($source, 'RELEASE = "([a-zA-Z0-9-]+)"').Groups[1].Value
  if (-not $version) { throw 'Release identifier is missing.' }
  $output = Join-Path $root ".artifacts/releases/$version"
  if (Test-Path -LiteralPath $output) { throw "Output already exists: $output" }
  $jar = 'services/massage-api/target/massage-api-0.1.0.jar'
  if (-not (Test-Path -LiteralPath $jar)) { throw 'Build and test the release JAR first.' }
  $apks = @('apps/massage-console/downloads/jingkang-technician.apk',
    'apps/massage-console/downloads/jingkang-manager.apk')
  foreach ($apk in $apks) {
    if (-not (Test-Path -LiteralPath $apk -PathType Leaf) -or (Get-Item -LiteralPath $apk).Length -eq 0) {
      throw "Required download APK is missing or empty: $apk"
    }
  }
  # APKs are ignored build outputs, so include only the two published downloads explicitly.
  $files = @(git ls-files apps/massage-console services/massage-api/src/main/resources/db/migration |
    Where-Object { $_ -notlike '*/tests/*' })
  if ($LASTEXITCODE -ne 0) { throw 'Source file inventory failed.' }
  $files += $apks
  $files += @($jar, 'server.massage.js', 'services/massage-api/src/main/resources/logback-spring.xml',
    'tools/maintenance/inspect_data_quality.sql', 'docs/reviews/2026-09-16/fix-batch1.md',
    'docs/reviews/2026-09-16/fix-batch2.md', 'docs/reviews/2026-09-16/fix-batch3.md',
    'docs/reviews/2026-09-16/final-fix-review.md', 'docs/reviews/2026-09-16/release-quality-v10.md',
    'docs/releases/20260918-member-recharge-correction-v1.md',
    'docs/releases/20260918-expense-workspace-v1.md')
  foreach ($file in $files) {
    $target = Join-Path $output $file
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination $target
  }
  $revision = git rev-parse HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Source revision lookup failed.' }
  [pscustomobject]@{release=$version; sourceCommit=$revision; builtAt=(Get-Date).ToUniversalTime().ToString('o');
    files=$files.Count} | ConvertTo-Json | Set-Content (Join-Path $output 'release.json') -Encoding utf8
  Get-ChildItem -LiteralPath $output -Recurse -File | Sort-Object FullName | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash,
      $_.FullName.Substring($output.Length+1).Replace('\','/')
  } | Set-Content (Join-Path $output 'SHA256SUMS.txt') -Encoding utf8
  $zip = "$output.zip"
  Compress-Archive -Path (Join-Path $output '*') -DestinationPath $zip
  Get-FileHash -LiteralPath $zip -Algorithm SHA256 | Format-List
} finally { Pop-Location }
