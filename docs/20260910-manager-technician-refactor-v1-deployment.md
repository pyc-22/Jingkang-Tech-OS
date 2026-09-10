# 20260910-manager-technician-refactor-v1 部署说明

## 部署前

1. 安排维护窗口，停止新增派单、结算、退款和会员资金操作。
2. 完整备份 PostgreSQL，并在独立位置确认备份可读取；同时备份当前静态目录、运行 JAR、外部配置和附件目录。
3. 使用 JDK 21。不要使用本机默认的旧 JDK。
4. 解压发布包到新目录，根据根目录 `SHA256SUMS.txt` 校验全部文件；缺失、不一致和清单外文件都必须为 0。
5. 确认待部署 JAR 的 SHA-256 为 `9F1BB279BB996AF78E663F806BDA259926EDDCCAED0A3963D3CAA3CC371BA517`。

PowerShell 校验示例，在解压目录执行：

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

## 部署步骤

1. 停止现有 Web 和 API 服务。
2. 保留生产环境变量、数据库目录、日志目录和附件目录，不从 ZIP 覆盖这些位置。
3. 用包内 `apps/massage-console/` 整体替换静态目录，保持原目录层级。
4. 用包内 `services/massage-api/target/massage-api-0.1.0.jar` 替换运行 JAR。
5. 使用 JDK 21 和现有生产环境变量启动 API。Flyway 将按现有数据库版本依次执行缺失迁移，最终应到 V89。
6. API 健康后启动 Web 静态服务，再恢复入口流量。

本地启动结构：

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

## 上线验证

1. `GET /api/health` 返回 HTTP 200，`status` 和 `database` 为 `UP`，`release` 为 `20260910-manager-technician-refactor-v1`。
2. 查询 Flyway 历史，确认 V87、V88、V89 均为成功状态。
3. 验证已完成退款的 `business_date` 与原订单一致；核对 V89 涉及的会员流水及提成记录日期。
4. 前台 `/index.html`、技师 `/mobile.html`、店长 `/manager-mobile.html` 及引用资源均返回 200。
5. 店长从房间和技师入口各打开一次安排流程，核对五种钟类、项目、房间、轮钟推荐、手选和分配比例；分别完成一笔即时派钟和预约派钟。
6. 技师端确认没有自主上钟入口，并走通接单、拒绝、休息、下钟、日报和服务记录。
7. 使用有效技师 Token 请求 `POST /api/v1/mobile/technician/clock-in`，确认 HTTP 403；比较请求前后的服务记录、房间状态和审计记录，确认无新增或变更。
8. 选择有退款和无退款的营业日，核对 `salesAmountCents - refundAmountCents = netSalesAmountCents`，并确认前台与店长日报口径一致。

数据库核验示例：

```sql
select version, success, description
from flyway_schema_history
where version in ('87','88','89')
order by installed_rank;

select count(*) as completed_refund_date_mismatch
from sales_refund refund
join sales_order sales on sales.id = refund.order_id
where refund.status = 'COMPLETED'
  and refund.business_date is distinct from sales.business_date;
```

第二条查询预期为 `0`。V89 会重分配历史营业日，部署前数据库备份是强制前置条件。
