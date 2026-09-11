# 20260911-p0-conflict-fix-v1 验证报告

## 结论

当前完整工作树已通过前端全量、后端全量、定向测试、真实 PostgreSQL/HTTP 并发回归、最终 JAR 字节码核验和本地健康检查。真实 API 回归直接使用最终发布 JAR，并从本机 `massage_v89` 克隆临时数据库；未连接生产数据库。

## 构建证据

| 项目 | 实际命令/环境 | 结果 |
| --- | --- | --- |
| 前端全量 | `npm.cmd run test:console`；Node.js 24.15.0 | `136/136` 通过 |
| 后端全量 | JDK 21.0.12.1；`mvnw.cmd -f services/massage-api/pom.xml test` | `107/107` 通过，0 失败、0 错误、0 跳过 |
| 前端/后端定向 | 店长、技师、换项、幂等和 P0 测试 | 前端定向包含在 `136/136` 全量中；后端定向 `11/11` 通过（`P0ConflictRegressionTest` 7、`ConflictLoggingRegressionTest` 1、`RoomControllerTest` 1、`TechnicianMobileControllerTest` 2） |
| JavaScript 语法 | `node --check` 检查 `app.js`、`manager-mobile.js`、`offline-sync.js`、`mobile.js`、`technician-service-worker.js` | `5/5` 通过 |
| PowerShell 语法 | `[scriptblock]::Create()` 解析 P0 回归脚本 | 通过 |
| 格式检查 | `git diff --check` | 通过（仅换行格式提示，无错误） |
| 构建 | JDK 21；`mvnw.cmd -f services/massage-api/pom.xml clean package -DskipTests` | `BUILD SUCCESS` |

最终 JAR（基于当前完整工作树重新 clean package）：

```text
services/massage-api/target/massage-api-0.1.0.jar
Size: 44,354,471 bytes
Build: 2026-09-11 21:45:01 +08:00
SHA-256: A71C6F470AF05FFF348C33C200051B1E3B82631DD66EBE77DB30EE59C40BDF59
```

## 真实 API/PostgreSQL 回归

实际命令（2026-09-11 21:46；JAR SHA-256 为 `A71C6F470AF05FFF348C33C200051B1E3B82631DD66EBE77DB30EE59C40BDF59`）：

```powershell
& .\tools\regression\p0-conflict-api-regression.ps1 -Database massage_p0_regression_final7 -ApiPort 58087
```

脚本从本机 `massage_v89` 克隆临时数据库 `massage_p0_regression_final7`，在 `127.0.0.1:58087` 启动最终发布 JAR，测试完成后停止进程并删除临时数据库。运行退出码为 `0`，关键结果如下：

- 精确生产路由 `PUT /api/v1/service-sessions/{id}/service-item`，`reason: "2"`：HTTP 200。
- 已超过预计结束时间的 `IN_SERVICE` 首钟换项：HTTP 200，服务总时长和审计正确。
- 同时长加钟项目换项：HTTP 200，`added_duration_minutes=0` 记录数为 0。
- 新增加钟：HTTP 200，扩展记录正确。
- `QUEUE`、`CALL`、`SELECTED`：均 HTTP 200。
- `BOOKED_QUEUE`、`BOOKED_CALL`：均 HTTP 200。
- 同 operation ID 并发：HTTP `200/204`，业务事件只写一次。
- 同技师并发派钟：HTTP `200/409`，有效参与记录仅一条。
- 同床位并发派钟：HTTP `200/409`，有效占用仅一条。
- 同房间重复房态：HTTP `200/200`，事件只写一次。
- 完成清洁重复和并发：均成功，完成事件只写一次。
- 非法 operation ID：HTTP 400，业务零写入。
- operation ID 跨路径复用：HTTP 409，业务零写入。
- 日志包含 `Clock-in rejected`、`Offline operation rejected`、`HTTP write rejected` 三类 WARN 证据。

## 最终 JAR 内容核验

对上述 SHA-256 对应的 JAR 解包并用 JDK 21 `javap` 核验：

- `DailyReportService` 调用 `OrderTotals.salesAmountCents()`；净销售额独立使用订单额减退款额；类内 `VOIDED` 和 `sales_order_service_session` 常量计数均为 0。
- `RefundController` 即时和异步退款均使用原订单 `business_date`。
- `SalesOrderController` 以 `businessClock.businessDate(storeId, settledAt)` 写入订单营业日，列表按 `o.business_date` 查询，不含旧的 `cast(o.settled_at as date)`。
- `TechnicianMobileController.clockIn()` 先调用 `currentTechnician(authorization)`，再固定抛出 403；方法内没有服务、房间或审计业务写入。
- `OfflineOperationIdempotencyFilter` 含 method/path 归属校验、同请求在途等待、最终 APPLIED 轮询和 `503 + Retry-After: 1` 超时路径。
- `HomeController` 健康检查发布号为 `20260911-p0-conflict-fix-v1`。
- JAR 内各存在一份 V87、V88、V89，内容包含防重复提交、日报索引和订单/退款营业日校正。

## 本地运行证据

用最终 JAR 连接本机临时 PostgreSQL `massage_v89_final` 在 `127.0.0.1:8080` 启动（JDK 21，`-Djdk.net.unixdomain.tmpdir=C:\tmp\jdsock`）：

```json
{"expenseClaimSequence":true,"release":"20260911-p0-conflict-fix-v1","service":"massage-api","database":"UP","status":"UP"}
```

前端代理 `http://127.0.0.1:5174` 实际返回 HTTP 200：

- `/index.html`
- `/mobile.html`
- `/manager-mobile.html`
- `/app.js?v=20260911-p0-conflict-fix-v1`
- `/offline-sync.js?v=20260911-p0-conflict-fix-v1`
- `/manager-mobile.js?v=20260911-p0-conflict-fix-v1`

本地页面实际响应：`index.html`、`mobile.html`、`manager-mobile.html` 和 `/api/health` 均 HTTP 200；API 健康检查 HTTP 200。

## 验收结论

- 技师端没有自主上钟入口或写请求；有效技师端点固定 403。
- 店长端保留安排上钟入口，复用前台上钟、预约和加钟 API；定向前端回归通过。
- 日报 Bug1/2/3/6、V87/V88/V89 已进入最终 JAR。
- P0 所列换项、上钟、房态、清洁和幂等冲突场景均已用真实 HTTP/数据库验证。

## 残余风险

业务提交与 `offline_operation_receipt=APPLIED` 更新仍存在进程中断窗口，可能留下长期 `PROCESSING`。本版本不自动超时重放，改为等待后 `503`，以避免财务重复写入。后续应将业务事务与幂等回执纳入同一事务边界。
