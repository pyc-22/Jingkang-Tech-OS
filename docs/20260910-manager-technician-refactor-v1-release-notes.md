# 20260910-manager-technician-refactor-v1 发布说明

## 发布目标

本版本是一个完整累积发布，统一交付已提交的技师端/店长端整改，以及构建前仍位于当前工作树中的日报 Bug1、Bug2、Bug3、Bug6 修复。发布 JAR 直接由该完整工作树执行 `clean package -DskipTests` 生成，没有从历史 ZIP、历史 JAR或独立干净基线取文件。

## 变更清单

### 日报与营业日

| 文件 | 改动 |
| --- | --- |
| `services/massage-api/src/main/java/com/chengxin/massage/operations/DailyReportService.java` | Bug1：`salesAmountCents` 返回订单原始销售额，`netSalesAmountCents` 单独返回扣减退款后的净额。Bug2：删除订单汇总、会员消费和渠道汇总中的三处 `VOIDED` 服务单过滤，已支付订单不再因关联服务作废而从日报消失。退款按原订单营业日汇总。 |
| `services/massage-api/src/main/java/com/chengxin/massage/operations/OperationsReportController.java` | 日报顶层 `salesAmountCents` 与统一指标保持一致，返回原始销售额。 |
| `services/massage-api/src/main/java/com/chengxin/massage/sales/RefundController.java` | Bug3：即时完成和异步完成退款都继承原订单 `business_date`；相关会员退款流水及提成冲销沿用同一营业日。 |
| `services/massage-api/src/main/java/com/chengxin/massage/sales/SalesOrderController.java` | Bug6：订单 `business_date` 始终以 `settledAt` 和门店营业日规则计算；订单列表改按 `o.business_date` 筛选。 |
| `services/massage-api/src/main/resources/db/migration/V89__fix_order_and_refund_business_date.sql` | 按每个门店的 `timezone` 和 `business_day_cutoff` 重算有结算时间的历史订单；已完成退款继承原订单日期；同步 `ORDER`、`ORDER_CORRECTION`、`ORDER_REFUND` 会员流水及订单关联提成记录；迁移末尾执行五类一致性检查。 |
| `apps/massage-console/daily-report.js` | 退款归集文案调整为“按原订单营业日归集”。 |
| `apps/massage-console/index.html` | 更新日报脚本缓存版本为本次发布号。 |

### 权限与移动端

| 文件 | 改动 |
| --- | --- |
| `apps/massage-console/mobile.html`、`mobile.js` | 技师端移除自主上钟按钮、弹窗及请求，保留派单接收、接单、拒绝、休息、下钟、日报、服务记录、请假和提成；空闲状态显示等待前台或店长安排。 |
| `services/massage-api/src/main/java/com/chengxin/massage/mobile/TechnicianMobileController.java` | `POST /api/v1/mobile/technician/clock-in` 先校验当前技师移动会话与有效绑定，再固定返回 `403 Forbidden`；该方法没有服务、房间或审计写入。 |
| `services/massage-api/src/main/java/com/chengxin/massage/audit/AuditOutcomeFilter.java` | 仅对已完成技师身份校验的自主上钟固定拒绝跳过通用失败审计，确保该端点零业务写入；缺失或失效会话的 `401` 仍按原规则审计。 |
| `apps/massage-console/manager-mobile.html`、`manager-mobile.js`、`manager-mobile.css` | 店长端新增房间和技师两种安排入口，复用前台即时上钟、预约和加钟接口；支持排钟、点钟、选钟、预定排钟、预定点钟、项目、房间、轮钟推荐、手选技师及多技师业绩分配。 |
| `apps/massage-console/offline-sync.js` | 技师自主上钟不进入离线或幂等写入队列。 |
| `services/massage-api/src/main/java/com/chengxin/massage/HomeController.java` | 健康检查发布号更新为 `20260910-manager-technician-refactor-v1`。 |

### 迁移与回归保护

- V87 `idempotency_duplicate_prevention`：保留防重复提交序列和活动技师参与记录唯一约束。
- V88 `daily_report_unification_indexes`：保留日报统一所需支付、退款和会员流水索引。
- 新增并更新日报字段、订单营业日、退款营业日、V87/V88/V89 和技师 `403` 行为测试。

## API 影响

- `POST /api/v1/mobile/technician/clock-in`：有效技师会话固定返回 HTTP 403；缺失或失效会话仍先返回 HTTP 401。
- `/api/v1/daily-reports` 与 `/api/v1/operations/daily-report`：`salesAmountCents` 恢复为原始销售额；`netSalesAmountCents` 保持净销售额语义。
- 订单列表的日期范围改为营业日范围；请求参数名不变。
- 店长安排上钟没有新增后端接口，继续使用前台的 `/api/v1/service-sessions/clock-in`、`/api/v1/service-reservations` 和 `/api/v1/service-sessions/{id}/extensions`。

## 发布包边界

ZIP 包含完整 `apps/massage-console/`、单一后端 JAR、静态服务入口、四份本版本文档和根目录 `SHA256SUMS.txt`。下载页中的两个 APK 是仓库原有制品，本次没有重建；它们随完整前端目录一并交付并纳入 SHA-256 清单。

包内不包含数据库备份、附件数据、日志、环境文件、密钥、签名材料、`node_modules`、历史 ZIP/JAR 或日报排查脚本。
