$ErrorActionPreference = 'Stop'

$release = '20260907-clock-type-change-v1'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$previousRelease = Join-Path $projectRoot 'deploy\releases\20260907-frontdesk-service-start-fix-v1'
$releaseRoot = Join-Path $projectRoot "deploy\releases\$release"
$zipPath = Join-Path $projectRoot "deploy\$release.zip"
$jarPath = Join-Path $projectRoot 'services\massage-api\target\massage-api-0.1.0.jar'

if (-not (Test-Path -LiteralPath $jarPath -PathType Leaf)) {
  throw "Compiled API JAR not found: $jarPath"
}
if (-not (Test-Path -LiteralPath $previousRelease -PathType Container)) {
  throw "Previous release template not found: $previousRelease"
}

if (Test-Path -LiteralPath $releaseRoot) {
  Remove-Item -LiteralPath $releaseRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseRoot, (Join-Path $releaseRoot 'massage-console-files'), (Join-Path $releaseRoot 'config') -Force | Out-Null

Copy-Item -LiteralPath $jarPath -Destination (Join-Path $releaseRoot 'massage-api-0.1.0.jar')
Copy-Item -LiteralPath (Join-Path $projectRoot 'apps\massage-console\app.js') -Destination (Join-Path $releaseRoot 'massage-console-files\app.js')
Copy-Item -LiteralPath (Join-Path $projectRoot 'apps\massage-console\index.html') -Destination (Join-Path $releaseRoot 'massage-console-files\index.html')
Copy-Item -LiteralPath (Join-Path $projectRoot 'apps\massage-console\styles.css') -Destination (Join-Path $releaseRoot 'massage-console-files\styles.css')
Copy-Item -LiteralPath (Join-Path $projectRoot 'apps\massage-console\manager-mobile.css') -Destination (Join-Path $releaseRoot 'massage-console-files\manager-mobile.css')
Copy-Item -LiteralPath (Join-Path $previousRelease 'server.massage.js') -Destination (Join-Path $releaseRoot 'server.massage.js')
Copy-Item -LiteralPath (Join-Path $previousRelease 'config\logback-spring.xml') -Destination (Join-Path $releaseRoot 'config\logback-spring.xml')

$deployScript = @'
param(
  [string]$ProjectRoot = 'C:\wwwroot\jingkang-platform',
  [string]$ServiceName = 'JingkangMassageApi',
  [string]$HealthUrl = 'http://127.0.0.1:8080/api/health'
)

$ErrorActionPreference = 'Stop'
$releaseRoot = $PSScriptRoot
$expectedRelease = '20260907-clock-type-change-v1'
$sourceJar = Join-Path $releaseRoot 'massage-api-0.1.0.jar'
$defaultJar = Join-Path $ProjectRoot 'services\massage-api\target\massage-api-0.1.0.jar'
$targetWebRoot = Join-Path $ProjectRoot 'apps\massage-console'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $ProjectRoot "backup\$expectedRelease-$timestamp"

$webFiles = @(
  @{ Source = 'massage-console-files\app.js'; Target = 'app.js' },
  @{ Source = 'massage-console-files\index.html'; Target = 'index.html' },
  @{ Source = 'massage-console-files\styles.css'; Target = 'styles.css' },
  @{ Source = 'massage-console-files\manager-mobile.css'; Target = 'manager-mobile.css' }
)

function Resolve-JarFromCommand([string]$commandLine) {
  if ([string]::IsNullOrWhiteSpace($commandLine)) { return $null }
  $match = [regex]::Match($commandLine, '(?i)"(?<quoted>[^"\r\n]+\.jar)"|(?<plain>[^\s"\r\n]+\.jar)')
  if (-not $match.Success) { return $null }
  $jar = if ($match.Groups['quoted'].Success) { $match.Groups['quoted'].Value } else { $match.Groups['plain'].Value }
  $jar = [Environment]::ExpandEnvironmentVariables($jar)
  if (-not [System.IO.Path]::IsPathRooted($jar)) { $jar = Join-Path $ProjectRoot $jar }
  return [System.IO.Path]::GetFullPath($jar)
}

function Resolve-NssmAppParameters([string]$servicePath, [string]$serviceName) {
  if ([string]::IsNullOrWhiteSpace($servicePath)) { return $null }
  $match = [regex]::Match($servicePath, '(?i)"(?<quoted>[^"\r\n]+nssm\.exe)"|(?<plain>[^\s"\r\n]+nssm\.exe)')
  if (-not $match.Success) { return $null }
  $nssm = if ($match.Groups['quoted'].Success) { $match.Groups['quoted'].Value } else { $match.Groups['plain'].Value }
  if (-not (Test-Path -LiteralPath $nssm -PathType Leaf)) { return $null }
  return ((& $nssm get $serviceName AppParameters 2>$null) | Out-String).Trim()
}

if (-not (Test-Path -LiteralPath $sourceJar -PathType Leaf)) { throw "Release JAR not found: $sourceJar" }
foreach ($file in $webFiles) {
  $source = Join-Path $releaseRoot $file.Source
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Release web file not found: $source" }
}

$service = Get-Service -Name $ServiceName -ErrorAction Stop
$serviceInfo = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
$targetJar = Resolve-JarFromCommand ([string]$serviceInfo.PathName)
$nssmParameters = Resolve-NssmAppParameters ([string]$serviceInfo.PathName) $ServiceName
if (-not $targetJar) { $targetJar = Resolve-JarFromCommand $nssmParameters }
if (-not $targetJar) {
  $process = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match '(?i)^java(w)?\.exe$' -and
    [string]$_.CommandLine -match '(?i)\.jar' -and
    ([string]$_.CommandLine -match [regex]::Escape($ProjectRoot) -or [string]$_.CommandLine -match '(?i)massage-api')
  } | Select-Object -First 1
  if ($process) { $targetJar = Resolve-JarFromCommand ([string]$process.CommandLine) }
}
if (-not $targetJar) { $targetJar = [System.IO.Path]::GetFullPath($defaultJar) }
if (-not (Test-Path -LiteralPath $targetJar -PathType Leaf)) { throw "Server JAR not found: $targetJar" }

$sourceJarHash = (Get-FileHash -LiteralPath $sourceJar -Algorithm SHA256).Hash
$releaseFiles = @(
  @{ Source = $sourceJar; Target = $targetJar; Backup = "jar\$(Split-Path -Leaf $targetJar)"; Hash = $sourceJarHash }
)
foreach ($file in $webFiles) {
  $source = Join-Path $releaseRoot $file.Source
  $target = Join-Path $targetWebRoot $file.Target
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Server web file not found: $target" }
  $releaseFiles += @{ Source = $source; Target = $target; Backup = "apps\massage-console\$($file.Target)"; Hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash }
}

Write-Host '[1/7] Preflight checks'
Write-Host "Release: $expectedRelease"
Write-Host "Service JAR: $targetJar"
Write-Host "Files to replace: $($releaseFiles.Count)"

Write-Host "[2/7] Backup current files to $backupRoot"
foreach ($file in $releaseFiles) {
  $backup = Join-Path $backupRoot $file.Backup
  New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
  Copy-Item -LiteralPath $file.Target -Destination $backup -Force
}

$deploymentStarted = $false
try {
  Write-Host '[3/7] Stop API service'
  if ($service.Status -ne 'Stopped') {
    Stop-Service -Name $ServiceName -Force
    (Get-Service -Name $ServiceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
  }
  $deploymentStarted = $true

  Write-Host '[4/7] Replace API JAR'
  Copy-Item -LiteralPath $sourceJar -Destination $targetJar -Force
  Unblock-File -LiteralPath $targetJar -ErrorAction SilentlyContinue
  $deployedJarHash = (Get-FileHash -LiteralPath $targetJar -Algorithm SHA256).Hash
  if ($deployedJarHash -ne $sourceJarHash) { throw "Deployed JAR hash mismatch: $deployedJarHash" }

  Write-Host '[5/7] Replace front desk and manager static files'
  foreach ($file in $releaseFiles | Select-Object -Skip 1) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $file.Target) -Force | Out-Null
    Copy-Item -LiteralPath $file.Source -Destination $file.Target -Force
    Unblock-File -LiteralPath $file.Target -ErrorAction SilentlyContinue
    $deployedHash = (Get-FileHash -LiteralPath $file.Target -Algorithm SHA256).Hash
    if ($deployedHash -ne $file.Hash) { throw "Deployed web hash mismatch: $($file.Target)" }
  }

  Write-Host '[6/7] Start API service'
  Start-Service -Name $ServiceName
  (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))

  Write-Host '[7/7] Health check'
  $healthy = $false
  $statusCode = 0
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    Start-Sleep -Seconds 2
    try {
      $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5
      $statusCode = [int]$response.StatusCode
      $body = $response.Content | ConvertFrom-Json
      if ($statusCode -eq 200 -and $body.status -eq 'UP' -and $body.release -eq $expectedRelease) {
        $healthy = $true
        break
      }
      Write-Host "Health check $attempt/30 returned release=$($body.release), status=$($body.status); waiting..."
    } catch {
      Write-Host "Health check $attempt/30 is waiting..."
    }
  }
  if (-not $healthy) { throw "API health check did not confirm release ${expectedRelease}: $HealthUrl" }

  Write-Host "DEPLOYMENT_OK HTTP $statusCode"
  Write-Host "JAR_SHA256 $deployedJarHash"
  Write-Host "BACKUP $backupRoot"
  Write-Host 'Refresh the front desk page once after deployment.'
} catch {
  if ($deploymentStarted) {
    Write-Host "Deployment failed. Restoring backup: $backupRoot"
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    foreach ($file in $releaseFiles) {
      $backup = Join-Path $backupRoot $file.Backup
      if (Test-Path -LiteralPath $backup -PathType Leaf) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $file.Target) -Force | Out-Null
        Copy-Item -LiteralPath $backup -Destination $file.Target -Force
      }
    }
    Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
  }
  throw
}
'@
$deployScript | Set-Content -LiteralPath (Join-Path $releaseRoot 'DEPLOY.ps1') -Encoding utf8

$serverCommand = @"
cd C:\wwwroot\jingkang-platform\update\$release
powershell -ExecutionPolicy Bypass -File .\DEPLOY.ps1

Success marker: DEPLOYMENT_OK HTTP 200
After completion, refresh the front desk page and verify the technician card menu can change an active service between 排钟 and 点钟 without changing its project, technician, room, duration, amount, or payment.
"@
$serverCommand | Set-Content -LiteralPath (Join-Path $releaseRoot 'SERVER-COMMAND.txt') -Encoding utf8

$releaseNotes = @'
# 20260907 前台更换钟类 v1

版本：$release

## 修复内容

- 前台技师卡片新增“更换钟类”，可在待接单、已接单或服务中状态将当前服务切换为排钟或点钟。
- 更换钟类只更新 `service_session.clock_type`，不改变项目、技师、房间、时长、金额、支付或加钟记录。
- 变更使用服务行锁与版本号校验，避免并发操作覆盖；修改原因写入现有审计历史，并可在服务变更记录中查看。
- 前台脚本更新缓存版本，确保浏览器加载本次功能。

## 影响范围

- 更新 API JAR、前台 `app.js` 与 `index.html`，并随包保留现有静态文件参考副本。
- 不新增数据库表、不修改现有表结构、不改写订单、支付、会员余额、房间或技师队列数据。
- 店长端、技师端和日报统计逻辑保持不变；现有结算页的订单业务更正仍可独立使用。
- 部署前自动备份 API JAR 及四个前台静态文件；健康检查未确认本版本时自动回滚。

## 验证结果

- 前端 Node 回归测试：112 项通过，0 项失败。
- 后端 Maven 测试：88 项通过，0 项失败、0 项错误、0 项跳过。
- API JAR 已重新编译，并包含本版本健康检查标识及钟类变更接口。

## 部署后验证

1. 上传并解压 ZIP 到服务器 `C:\wwwroot\jingkang-platform\update\$release`。
2. 在该目录以管理员 PowerShell 执行 `SERVER-COMMAND.txt` 中的命令。
3. 看到 `DEPLOYMENT_OK HTTP 200` 后刷新前台页面。
4. 选择一笔待接单、已接单或服务中服务，打开技师卡片菜单，切换排钟/点钟并确认服务项目、技师、房间、时长、金额和支付信息均不变。
5. 打开服务变更记录，确认显示钟类变更和修改原因。
'@
$releaseNotes = $releaseNotes.Replace('$release', $release)
$releaseNotes | Set-Content -LiteralPath (Join-Path $releaseRoot 'RELEASE_NOTES.md') -Encoding utf8

$root = (Resolve-Path $releaseRoot).Path
$sumLines = Get-ChildItem -LiteralPath $releaseRoot -Recurse -File | Where-Object Name -ne 'SHA256SUMS.txt' | ForEach-Object {
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
  $relative = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
  "$hash  $relative"
}
$sumLines | Set-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS.txt') -Encoding ascii

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $releaseRoot '*') -DestinationPath $zipPath -Force

Write-Host "RELEASE_ROOT $releaseRoot"
Write-Host "ZIP $zipPath"
Write-Host "ZIP_SHA256 $((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash)"
Get-ChildItem -LiteralPath $releaseRoot -Recurse -File | Select-Object FullName, Length
