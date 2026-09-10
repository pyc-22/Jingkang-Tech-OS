# 20260910-manager-technician-refactor-v1 验证报告

## 结论

本版本的前端全量回归、店长/技师定向回归、后端全量测试、JavaScript 语法检查、当前工作树构建、JAR 内容核验和 PostgreSQL 迁移夹具均通过。最终 JAR 由包含全部日报修复与既有移动端整改的当前工作树构建。

## 实际执行证据

| 检查 | 环境/命令 | 结果 |
| --- | --- | --- |
| 前端全量回归 | Node.js 24.15.0；`npm.cmd run test:console` | `130/130` 通过 |
| 店长/技师定向回归 | `node --test` 运行 `manager-dispatch-clock`、`manager-live-room`、`technician-clock-duration` 三个测试文件 | `19/19` 通过 |
| JavaScript 语法 | `node --check` 检查 `manager-mobile.js`、`mobile.js`、`daily-report.js` | 3 个文件通过 |
| 后端全量测试 | JDK 21.0.12.1；`mvnw.cmd ... test` | `95/95` 通过，0 失败、0 错误、0 跳过 |
| 当前工作树构建 | JDK 21.0.12.1；`mvnw.cmd ... clean package -DskipTests` | `BUILD SUCCESS`；重新编译 71 个主源码文件和 24 个测试源码文件 |
| 格式检查 | `git diff --check` | 通过 |

最终构建时间为 2026-09-10 14:11:09（Asia/Shanghai）。JAR 大小为 `44,348,883` 字节，SHA-256 为：

```text
35169295F0D629C47FE20A0E5840D613682E68DD588E59CE0FDB0070EDD22C94
```

## JAR 内容核验

- JAR 中 `HomeController`、`DailyReportService`、`OperationsReportController`、`RefundController`、`SalesOrderController`、`TechnicianMobileController` 六个 class 与同次构建的 `target/classes` SHA-256 全部一致。
- `javap -c -p` 确认 `DailyReportService` 构造日报指标时调用 `OrderTotals.salesAmountCents()`；查询常量中没有 `sales_order_service_session` 或 `VOIDED` 过滤。
- `javap -c -p` 确认即时退款读取 `Order.businessDate()`，异步退款读取 `RefundCompletion.businessDate()`。
- `javap -c -p` 确认新订单调用 `BusinessClockService.businessDate(storeId, settledAt)`；订单列表查询常量使用 `o.business_date`。
- `javap -c -p` 确认技师 `clockIn` 先调用 `currentTechnician(authorization)`，随后构造 `HttpStatus.FORBIDDEN` 异常，方法内没有 JDBC 或审计写入。
- `javap -v -p` 确认健康检查发布号为 `20260910-manager-technician-refactor-v1`。
- JAR 内存在 V87、V88、V89。V89 使用门店 `timezone` 和 `business_day_cutoff`，包含会员流水及提成同步，且不含固定 `Asia/Shanghai`、永久计算函数或备份表。

## PostgreSQL 迁移验证

使用工作区内一次性 PostgreSQL 16.14 实例，不连接现有 5432 数据库：

1. 从空库执行包内迁移到 V88，V87 和 V88 成功。
2. 注入一笔日期错位订单、一笔已完成退款、三笔对应会员流水和一笔提成记录。
3. 启动最终 JAR 让 Flyway 执行 V89，日志确认成功升级到 V89，末尾一致性检查通过。
4. 六条夹具记录全部统一到门店规则计算出的 `2026-09-10`。
5. 再次执行同一 V89 成功，验证 `IS DISTINCT FROM` 更新具有幂等性。
6. Flyway 历史记录显示 V87、V88、V89 均成功。

## 验收项

- 日报 Bug1：原始营业额与净营业额分离，已通过源码回归和 JAR 反编译核验。
- 日报 Bug2：三处 `VOIDED` 过滤已移除，已通过源码回归和 JAR 查询常量核验。
- 日报 Bug3：退款继承原订单营业日，已通过控制器回归、JAR 反编译和数据库迁移夹具核验。
- 日报 Bug6：订单按结算时间和门店规则确定营业日，列表按 `business_date` 查询，已通过控制器回归、JAR 反编译和数据库夹具核验。
- V87 防重复提交与 V88 日报统一均在 JAR 中，相关前端/后端回归通过。
- 技师端自主上钟入口和写请求不存在；有效会话调用后端端点返回 403 的行为测试通过，并验证业务依赖没有交互。
- 店长端安排上钟、预约和加钟流程的 `19/19` 定向测试通过。

## 环境边界

自动化前端测试是源码级回归；最终人工验收仍需在目标测试数据库中使用有效店长和技师账号执行完整写入闭环。本机现有数据库没有在本轮验证中被修改。
