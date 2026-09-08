$release='20260907-frontdesk-service-start-fix-v1'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$src=Join-Path $projectRoot 'deploy\releases\20260906-technician-replacement-fix-v1'
$dest=Join-Path $projectRoot "deploy\releases\$release"
if(Test-Path $dest){Remove-Item $dest -Recurse -Force}
New-Item -ItemType Directory -Path "$dest\massage-console-files","$dest\config" -Force | Out-Null
Copy-Item (Join-Path $projectRoot 'services\massage-api\target\massage-api-0.1.0.jar') "$dest\massage-api-0.1.0.jar"
Copy-Item (Join-Path $projectRoot 'apps\massage-console\app.js') "$dest\massage-console-files\app.js"
Copy-Item (Join-Path $projectRoot 'apps\massage-console\styles.css') "$dest\massage-console-files\styles.css"
Copy-Item (Join-Path $projectRoot 'apps\massage-console\manager-mobile.css') "$dest\massage-console-files\manager-mobile.css"
Copy-Item "$src\DEPLOY.ps1","$src\SERVER-COMMAND.txt","$src\RELEASE_NOTES.md","$src\server.massage.js" $dest -Force
Copy-Item "$src\config\logback-spring.xml" "$dest\config\logback-spring.xml" -Force
(Get-Content "$dest\DEPLOY.ps1" -Raw).Replace('20260906-technician-replacement-fix-v1',$release) | Set-Content "$dest\DEPLOY.ps1" -Encoding utf8
(Get-Content "$dest\SERVER-COMMAND.txt" -Raw).Replace('20260906-technician-replacement-fix-v1',$release) | Set-Content "$dest\SERVER-COMMAND.txt" -Encoding utf8
(Get-Content "$dest\RELEASE_NOTES.md" -Raw).Replace('20260906-technician-replacement-fix-v1',$release).Replace('# 20260906 更换技师在线状态修复 v1','# 20260907 前台安排技师上钟修复 v1') | Set-Content "$dest\RELEASE_NOTES.md" -Encoding utf8
$root=(Resolve-Path $dest).Path
$lines=Get-ChildItem $dest -Recurse -File | Where-Object Name -ne 'SHA256SUMS.txt' | ForEach-Object { $h=(Get-FileHash $_.FullName -Algorithm SHA256).Hash; $rel=$_.FullName.Substring($root.Length+1).Replace('\','/'); "$h  $rel" }
$lines | Set-Content "$dest\SHA256SUMS.txt" -Encoding ascii
$archivePath = Join-Path $projectRoot "deploy\$release.zip"
Compress-Archive -Path "$dest\*" -DestinationPath $archivePath -Force
Get-FileHash $archivePath -Algorithm SHA256 | Format-List
Get-ChildItem $dest -Recurse -File | Select-Object FullName,Length
