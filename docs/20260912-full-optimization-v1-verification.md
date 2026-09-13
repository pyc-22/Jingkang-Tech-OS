# 20260912-full-optimization-v1 验证报告

## 验证原则

发布包必须以当前完整工作树为输入。下表只记录实际运行后可填写的结果；没有在本机执行的真实 API、数据库或 JAR 检查不得标记为通过。

## 可重复命令

```text
node --check apps/massage-console/app.js
node --check apps/massage-console/mobile.js
node --check apps/massage-console/manager-mobile.js
node --check apps/massage-console/technician-service-worker.js
node --test apps/massage-console/tests/*.test.js
git diff --check
mvnw.cmd -f services/massage-api/pom.xml test
mvnw.cmd -f services/massage-api/pom.xml clean package -DskipTests
powershell -ExecutionPolicy Bypass -File tools/release/package-full-optimization-20260912.ps1
```

## 验收矩阵

| 范围 | 检查内容 | 证据要求 |
| --- | --- | --- |
| 前端语法/回归 | 全量 Node 测试、店长安排上钟、技师 403、日报和 P0 布局测试 | 命令退出码 0，记录通过/失败数 |
| 后端 | Maven 全量测试 | `BUILD SUCCESS`，失败/错误/跳过数明确 |
| 数据库 | V90/V91 在临时 PostgreSQL 执行，旧数据行数和关键约束保持 | Flyway success 行、迁移前后计数和无 DROP 检查 |
| 日报历史修复 | Bug1/2/3/6、V87/V88/V89 | JAR 解包/`javap` 或源码比对证据 |
| 技师权限 | 有效技师会话调用移动端 clock-in 返回 403，服务/房间/审计零写入 | HTTP 响应与事务前后计数 |
| 店长流程 | 房间/技师两入口；QUEUE、CALL、SELECTED、BOOKED_QUEUE、BOOKED_CALL、加钟 | 实际 API 响应和业务记录 |
| P0 冲突 | 换项目、房态、完成清洁、幂等及并发派钟 | 临时数据库 HTTP 回归日志；预期业务竞争才返回 409 |
| 发布完整性 | ZIP、JAR、前端、配置、文档和清单 | 包内路径清单、JAR/ZIP SHA-256 |
| 健康检查 | `/api/health` 版本 | `release=20260912-full-optimization-v1` |

## JAR 静态核验要点

解包后确认：

1. `DailyReportService` 调用 `salesAmountCents()`，无旧的错误 VOIDED 过滤。
2. `RefundController` 使用原订单 `businessDate()`；`SalesOrderController` 使用 `businessClock.businessDate(storeId, settledAt)` 并按 `o.business_date` 查询。
3. `TechnicianMobileController.clockIn()` 先校验当前会话，再返回 403，方法内没有服务、房间或审计写入。
4. JAR 资源包含 V87、V88、V89、V90、V91 迁移。
5. `HomeController` 的 release 为 `20260912-full-optimization-v1`。

## 结果记录

以下结果均为本机实际执行记录（2026-09-13，Asia/Shanghai）：

| 检查 | 实际命令/环境 | 结果 |
| --- | --- | --- |
| 前端全量回归 | `node --test apps/massage-console/tests/*.test.js` | 退出码 0，143/143 通过 |
| JS 语法 | 4 个核心脚本逐一执行 `node --check` | 退出码 0 |
| 后端全量测试 | JDK 21 + `services/massage-api/mvnw.cmd test` | `BUILD SUCCESS`，130/130 通过，失败 0、错误 0、跳过 0 |
| 完整构建 | JDK 21 + `services/massage-api/mvnw.cmd clean package -DskipTests` | `BUILD SUCCESS`，JAR 由当前工作树编译 |
| P0 API/数据库回归 | 临时 PostgreSQL 16（端口 55439）+ 最终 JAR，`tools/regression/p0-conflict-api-regression.ps1` | 通过：换加钟、主项目替换、加钟、QUEUE/CALL/SELECTED、BOOKED_QUEUE/BOOKED_CALL、房态并发、清洁并发、幂等重放；业务竞争仅按预期返回 409 |
| P0 日志核验 | 同一回归日志 | `Clock-in rejected`、`Offline operation rejected`、`HTTP write rejected` 三类 WARN 均存在 |
| Flyway | 同一临时数据库启动日志 | V90、V91 成功执行，schema v91；V91 权限插入使用随机 UUID + 编码幂等条件 |
| JAR 字节码/资源 | 解包后 `javap`、资源清单 | 日报金额调用 `salesAmountCents()`；无日报 VOIDED 过滤；退款使用原订单 `businessDate()`；订单使用 `businessClock.businessDate(..., settledAt)` 且列表按 `o.business_date`；移动 clock-in 先校验会话后 403；V87/V88/V89/V90/V91 全部存在 |
| 历史补单/退款营业日 | 临时数据库真实 API 流程 | 订单 `SO26091300000003`（id `e70be78d-a7ac-4d19-a27e-43a383e8e247`）补单日为 2026-09-12，行项目合计与支付均为 29,800 分；退款 `34fee76f-5c5d-4321-8dc0-480a68dc8d91` 完成，`refund.businessDate=2026-09-12` 与原单一致；日报 HTTP 200，sales=29,800、refund=29,800、net=0，CASH 净额 0；佣金结算 +1/+90/+29,800 与退款冲回 -1/-90/-29,800 相抵 |
| 工作树检查 | `git diff --check` | 退出码 0 |
| 包内清单 | 发布 staging `SHA256SUMS.txt` 逐项重算 | 90 个清单项，错误 0 |

最终构建产物（本次重新构建后计算）：

- JAR：`DEBBE67DB56F02D2A458C1F022CECF8CDCC26AFF0E3E8C8189ABD6ACFBC0349A`
- 发布包：`deploy/20260912-full-optimization-v1.zip`

验证报告本身位于 ZIP 内，因此不把压缩包自身的哈希写回包内，避免形成自引用；包内 `SHA256SUMS.txt` 已覆盖全部 90 个成员文件。ZIP SHA-256 由发布命令输出，并在交付消息中记录；独立重算与命令输出一致。

P0 回归脚本同时修复了 Windows PowerShell 5.1 对 `Invoke-WebRequest -SkipHttpErrorCheck` 的兼容问题，改用 .NET HTTP 客户端捕获正常的 4xx 业务响应；该改动不改变生产 API 行为。

残余风险：真实资源竞争仍可能返回业务 409，这是防止重复占用的预期结果；部署前仍必须完成数据库、JAR、前端和配置备份。
