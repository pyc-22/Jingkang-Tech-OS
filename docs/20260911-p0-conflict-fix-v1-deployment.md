# 20260911-p0-conflict-fix-v1 部署说明

## 发布物

- ZIP：`20260911-p0-conflict-fix-v1.zip`
- JAR：`services/massage-api/target/massage-api-0.1.0.jar`
- JAR SHA-256：`0BF8937960B2B76E15C77B77AEDD217565DA5297A9131EC918B565BB0B67AB4C`
- 健康检查发布号：`20260911-p0-conflict-fix-v1`

ZIP 根目录的 `SHA256SUMS.txt` 是逐文件清单。外层 ZIP 的 SHA-256 在交付报告中给出。

## 部署前检查

1. 先把 ZIP 上传到服务器的独立临时目录，例如 `C:\deploy-tmp\20260911-p0-conflict-fix-v1`，不要直接解压到在线目录。
2. 备份当前静态目录、运行 JAR、外部配置、附件目录和 PostgreSQL；确认备份可读取。
3. 安排短维护窗口，暂停派单、结算、退款、充值和房态写操作。
4. 确认运行时为 JDK 21，并保留现有生产环境变量。
5. 解压到临时目录并校验 `SHA256SUMS.txt`；缺失、不一致和清单外文件都应为 0。
6. 确认当前 Flyway 至少已成功执行 V87、V88、V89。本版本没有新增迁移。

PowerShell 逐文件校验：

```powershell
$errors = 0
Get-Content .\SHA256SUMS.txt | ForEach-Object {
  $expected, $relative = $_ -split '  ', 2
  $path = Join-Path (Get-Location) ($relative -replace '/', '\')
  if (!(Test-Path -LiteralPath $path -PathType Leaf) -or
      (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $expected) {
    $errors++
  }
}
if ($errors -ne 0) { throw "SHA-256 check failed: $errors file(s)" }
```

## 切换步骤

1. 停止现有 Web 和 API 服务，确认旧 Java 进程已退出。
2. 不覆盖生产数据库目录、日志、附件和环境配置。
3. 用包内 `apps/massage-console/` 整体替换静态目录，保持原层级和两个 APK。
4. 用包内 `services/massage-api/target/massage-api-0.1.0.jar` 替换运行 JAR。
5. 使用 JDK 21 和原生产环境变量启动 API。
6. `GET /api/health` 正常后启动 Web 服务，再恢复入口流量。

本地结构启动示例：

```powershell
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
& "$env:JAVA_HOME\bin\java.exe" -jar .\services\massage-api\target\massage-api-0.1.0.jar

# 另一个终端
$env:MASSAGE_ADDRESS='127.0.0.1'
$env:MASSAGE_PORT='5174'
$env:MASSAGE_API_HOST='127.0.0.1'
$env:MASSAGE_API_PORT='8080'
node .\server.massage.js
```

## 上线检查

1. `/api/health` 返回 HTTP 200，`status=UP`、`database=UP`、`release=20260911-p0-conflict-fix-v1`。
2. `/index.html`、`/mobile.html`、`/manager-mobile.html` 及带新版本参数的 JS 均返回 200。
3. 清理浏览器旧缓存；技师 PWA 需确认新 service worker 已激活。
4. 在一条 `IN_SERVICE` 且有加钟记录的测试服务上，分别换首钟和加钟项目，`reason` 可输入 `2`，响应应为 200。
5. 分别验证排钟、点钟、选钟、预定排钟、预定点钟和新增加钟。
6. 对同一房间快速提交相同房态，响应均成功且事件只新增一次。
7. 对清洁中房间重复完成清洁，响应成功且只新增一条完成事件。
8. 同一技师或同一床位并发派两单时，应恰好一单成功、另一单返回可读业务冲突，不得产生双占用。
9. 技师端没有自主上钟入口；有效技师会话调用 `/api/v1/mobile/technician/clock-in` 返回 403 且业务零写入。
10. 抽查日报原始营业额、退款、净营业额及营业日，确认历史 Bug1/2/3/6 未回退。

Flyway 检查：

```sql
select version, success, description
from flyway_schema_history
where version in ('87','88','89')
order by installed_rank;
```

## 监控

上线后重点检索 WARN 关键字：

- `Extension item change rejected`
- `Service item change rejected`
- `Clock-in rejected`
- `Clock-in database conflict`
- `Room status change rejected`
- `Complete cleaning rejected`
- `Offline operation id reused`
- `Offline operation is still processing`
- `HTTP write rejected`

如果出现同 operation ID 长期 `PROCESSING`，先核对业务表和审计结果，再处理回执；不要直接删除后重放财务操作。
