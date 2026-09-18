$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$version = '20260918-android-downloads-v1'
$output = Join-Path $root ".artifacts/releases/$version"
$files = @(
  'apps/massage-console/downloads/index.html',
  'apps/massage-console/downloads/downloads.css',
  'apps/massage-console/downloads/jingkang-technician.apk',
  'apps/massage-console/downloads/jingkang-manager.apk',
  'server.massage.js',
  'deploy/nginx/massage-platform.conf',
  'docs/android-downloads-fix.md'
)
foreach ($file in $files) {
  $source = Join-Path $root $file
  if (-not (Test-Path -LiteralPath $source -PathType Leaf) -or (Get-Item -LiteralPath $source).Length -eq 0) {
    throw "Required download release file is missing or empty: $file"
  }
}
if ((Test-Path -LiteralPath $output) -or (Test-Path -LiteralPath "$output.zip")) {
  throw "Output already exists: $output"
}
foreach ($file in $files) {
  $target = Join-Path $output $file
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination $target
}
Get-ChildItem -LiteralPath $output -Recurse -File | Sort-Object FullName | ForEach-Object {
  '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash,
    $_.FullName.Substring($output.Length+1).Replace('\','/')
} | Set-Content (Join-Path $output 'SHA256SUMS.txt') -Encoding utf8
Compress-Archive -Path (Join-Path $output '*') -DestinationPath "$output.zip"
Get-FileHash -LiteralPath "$output.zip" -Algorithm SHA256 | Format-List
