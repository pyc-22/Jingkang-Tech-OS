# 第二阶段 / 历史补单

范围：SalesOrderController.historicalBackfill、AccessControlController 授权、BusinessPermissionFilter、V91/V94、前台与店长补单表单。
后端路径前缀：`services/massage-api/src/main/java/com/chengxin/massage/`。

## 已核实权限与数据链

- `sales/SalesOrderController.java:225` 校验门店范围；`:227` 校验角色；`:242` 校验店长对该门店的显式授权；`:251` 再检查 HISTORICAL_ORDER_CREATE，不单依赖过滤器。
- 补单必须 confirmed=true，日期不晚于当前营业日；正金额、收款合计、技师去重及分配合计都有校验。资料 UUID 必须属于目标门店。
- 订单保留 backfill_date/by/at；业务日写为补单日，settled_at 保留实际操作时刻；明细、服务、参与者、提成、支付、会员扣款与审计在同事务。
- 非房间手工服务由 V93 支持；V94 放开历史服务归属，不能用“服务室为空”一概判孤儿。

## 问题

### R06 / P1：重放保护只在可选 HTTP 头

位置：`admin/OfflineOperationIdempotencyFilter.java:33`、`:49`；`sales/SalesOrderController.java:220`。
没有 operation 头时不进入幂等过滤器；补单表没有独立请求键。网络重试、客户端重新生成操作 ID，或者回执与业务提交之间的失败，都可能失去预期幂等语义。
建议补单 DTO/订单增加业务请求键，唯一范围含门店和主体，并校验请求摘要；同键不同内容应 409，同键同内容返回原订单，不能再次扣钱包。

### R13 / P2：历史资料有效性与版本缺失策略不清

位置：`catalog/ServiceItemVersionService.java:20`、`:32`、`:42`；`sales/SalesOrderController.java:266`、`:358`。
历史项目价格没有匹配版本时回退当前基础价，佣金规则却 .single()；当前 inactive 技师/项目即使历史有效也被排除。新增项目创建之前的日期会给调用者数据库异常而非清晰的历史规则缺失反馈。
建议记录可用日期区间，区分“历史有效但目前停用”和“历史从未存在”；缺价缺规则时拒绝并说明，避免默认回退今日价格。

### R07 / P1 共享风险：补单与实时结算竞争月钟数

位置：`sales/SalesOrderController.java:320`、`sales/MonthlyCommissionTierService.java:29`。
应与实时结算共用技师/月锁和提成策略。是否重算之前同月提成需要产品/财务确认，不能在维护 SQL 中直接覆盖已结薪记录。

## 回归矩阵

无权限/仅收银权限、门店授权 A 访问 B、撤权后旧令牌、未来日、confirmed=false、重复技师、分配不足/超过 100%、支付合计错误、余额不足、并发重复提交、失败后订单/服务/提成/钱包/审计全部回滚。
已有测试主要为源文本合同；第三阶段新增 HTTP 和数据库联合断言，并明确未覆盖的复杂历史分配场景。
