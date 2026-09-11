# 20260911-p0-conflict-fix-v1 发布说明

## 发布结论

本版本是 `20260910-manager-technician-refactor-v1` 的完整后继包。发布包由当前完整工作树构建，同时保留日报 Bug1/2/3/6、V87/V88/V89、技师自主上钟 403 和店长/技师端整改，并加入本次 400/409 P0 修复。没有新增数据库迁移，也没有改动生产配置。

## 根因与修复

### 换项目与加钟

- 同时长加钟项目换项时，旧逻辑仍写入 `added_duration_minutes=0`，触发数据库非零检查约束。现在只有时长差不为 0 时才写时长变更日志，项目、价格版本、提成版本和换项审计仍完整更新。
- 服务仍为 `IN_SERVICE` 但已经超过预计结束时间时，旧逻辑按时间拒绝换项。现在以服务状态、结算状态和乐观锁为准，允许合法换项。
- 有加钟记录时，前端旧逻辑默认选择首钟，容易把“换加钟项目”提交到首钟接口。现在必须显式选择首钟或加钟，未选择时不发送请求。

### 安排上钟

- 对参与技师按 UUID 固定顺序加行锁，检查在职、排班资格和活动服务后再创建派单，降低同技师并发竞态和死锁风险。
- 指定床位不再使用 `SKIP LOCKED`；并发占用由行锁和数据库唯一索引共同裁决。
- 技师活动服务索引或床位活动占用索引发生竞态时，转换为可读的业务 409，不再暴露数据库异常。
- 派单前检查房间启用状态及最新房态；`PENDING_PAYMENT`、`CLEANING`、`MAINTENANCE` 仍是应拒绝派单的真实业务冲突。
- `CALL` 与 `QUEUE` 走同一校验链；`SELECTED`、`BOOKED_QUEUE`、`BOOKED_CALL` 已纳入真实 API 回归。

### 房态与清洁

- 房态更新、完成清洁和确认付款先锁定房间行，避免同房间命令并发交错。
- 最新房态按 `occurred_at desc, id desc` 稳定排序。
- 相同房态和相同原因的重复更新直接成功，不重复写事件。
- 已完成清洁的重复或并发请求按幂等成功处理，仅保留一条 `Cleaning completed` 事件。
- 房间占用判断补齐 `REASSIGNMENT_REQUIRED` 和 `DISPATCH_CANCELLED`。

### 幂等与前端提交

- 前端全局写入锁改为请求指纹级共享 Promise；不同写操作可并行，相同写操作只发送一次并共享结果。
- 离线失败的重复调用复用同一 operation ID，只进入 IndexedDB 队列一次。
- UUID 降级生成符合 RFC 4122 v4。
- 后端回执同时校验 method/path；同 ID 跨请求复用返回 409 且不执行写入。
- 同 method/path 的同 ID 在途重放最多等待 5 秒。首请求成功时返回 204 重放成功；首请求失败并删除回执时，等待请求重新抢占。
- 等待 5 秒仍为 `PROCESSING` 时返回 `503` 和 `Retry-After: 1`，离线队列保持待同步，不再误标为业务冲突。

### 诊断日志与实时状态

- 所有写接口的 400/409 由 `AuditOutcomeFilter` 记录 WARN，包含 method、path、query、storeId、operationId 和状态码。
- 换加钟项目、派钟、房态、完成清洁和幂等拒绝增加目标 WARN，记录请求参数、触发原因及可用的当前状态。
- 店长实时房间/技师状态补齐占床状态和过期待处理派单，避免界面显示为空闲后继续误操作。

## 兼容性

- 数据库最新版本仍为 V89；本版本不执行新的 DDL/DML 迁移。
- API 路径和成功响应结构保持不变。
- 真正的资源竞争仍保留业务 409，例如同一技师或同一床位同时安排两次，只允许一个请求成功。
- 静态资源缓存键和健康检查发布号更新为 `20260911-p0-conflict-fix-v1`。

## 历史修复完整性

最终 JAR 已反编译核验包含：

- 日报 Bug1：`salesAmountCents` 使用 `orders.salesAmountCents()`，净销售额独立计算。
- 日报 Bug2：`DailyReportService` 不含三处 VOIDED 服务单过滤。
- 日报 Bug3：退款 `business_date` 继承原订单营业日。
- 日报 Bug6：订单使用 `businessClock.businessDate(storeId, settledAt)`，列表按 `o.business_date` 查询。
- V87 防重复提交、V88 日报统一索引、V89 订单和退款营业日修正。
- 技师移动端 `/clock-in` 先校验会话，再固定返回 403，方法内没有业务写入。

## 主要文件

- `apps/massage-console/app.js`：换项对象显式选择。
- `apps/massage-console/offline-sync.js`：请求级去重、UUID 和离线 operation ID 修复。
- `apps/massage-console/manager-mobile.js`：店长派钟提交防重复。
- `services/massage-api/src/main/java/com/chengxin/massage/catalog/ServiceSessionExtensionItemChangeController.java`：同时长及超时服务换项修复、WARN。
- `services/massage-api/src/main/java/com/chengxin/massage/catalog/ServiceSessionItemChangeController.java`：超时服务首钟换项修复、WARN。
- `services/massage-api/src/main/java/com/chengxin/massage/catalog/ServiceSessionController.java`：派钟锁、房态检查、唯一约束竞态映射、WARN。
- `services/massage-api/src/main/java/com/chengxin/massage/catalog/RoomController.java`：房间锁、幂等清洁和稳定排序。
- `services/massage-api/src/main/java/com/chengxin/massage/admin/OfflineOperationIdempotencyFilter.java`：回执归属校验、在途等待和可重试超时。
- `services/massage-api/src/main/java/com/chengxin/massage/audit/AuditOutcomeFilter.java`：全局 400/409 WARN。
- `services/massage-api/src/main/java/com/chengxin/massage/operations/OperationsReportController.java`：实时占用状态补齐。
- `tools/regression/p0-conflict-fixture.sql`、`tools/regression/p0-conflict-api-regression.ps1`：可重复的 PostgreSQL/HTTP 回归。

## 已知边界

`offline_operation_receipt` 的业务提交和回执更新仍不是同一事务。如果进程恰好在业务提交后、回执改为 `APPLIED` 前退出，回执可能长期停留在 `PROCESSING`。本版本选择返回可重试 503，不按超时自动重放，避免财务写入重复。遇到长期未决回执时，应先核对对应业务记录和审计，再人工修正回执状态；后续应将业务写入与幂等回执纳入同一事务边界。
