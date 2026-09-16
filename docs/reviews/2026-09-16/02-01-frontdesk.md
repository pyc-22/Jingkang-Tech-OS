# 第二阶段 / 前台收银

范围：SalesOrderController、RefundController、服务派钟/参与者/加钟/换房 Controller、前台结算与退款 JavaScript。
后端路径前缀：`services/massage-api/src/main/java/com/chengxin/massage/`。

## 主流程与已核实保护

结算读取并锁服务 -> 验证未被有效订单结算 -> 写订单/明细/服务关联 -> 写提成 -> 写支付/扣钱包 -> 房态和审计，主入口在 `sales/SalesOrderController.java:373`，整体事务覆盖。
普通订单退款在 `sales/RefundController.java:64` 锁订单，再聚合重复明细和原支付的申请额；混合退款等待外部退款完成再返钱包。这与充值退款不是同一条实现，不能用普通退款的锁推定充值退款安全。
前台加钟在 `catalog/ServiceSessionExtensionController.java:57` 锁服务、校验在服参与者和项目、按 version 更新时长，保留价格/佣金规则版本。

## 问题

### R16 / P1：审批换房留下旧床位

- 位置：`catalog/ServiceRoomTransferController.java:96`；`services/massage-api/src/main/resources/db/migration/V75__room_bed_occupancy.sql:1`。
- 触发：已有非空 bed_id 的在服服务，经 `/service-room-transfers/{id}/approve` 换房。
- 结果：service_session.room_id 为新房，bed_id 仍在旧房；唯一索引还占着旧床，目标房床位没有对应占用。房间、床位、服务三者分离，单列外键不会阻止。
- 建议：审批事务内确定并锁定目标床，同时迁移两个字段；旧房状态按剩余服务聚合，不直接写 CLEANING。引入 `(bed_id, room_id, store_id)` 一致性约束前先巡检存量。
- 回归：带床服务换房后，`session.room_id=bed.room_id`；旧床可派、新床不可重复派；双床旧房仍有服务时保持在服状态。

### R06 / P1：幂等回执不等于业务原子性

- 位置：`admin/OfflineOperationIdempotencyFilter.java:49`、`:65`、`:80`。
- 场景：业务已提交而回执更新失败；同操作 ID、同路径但不同门店/金额再次请求。
- 影响：永久 PROCESSING 或把不同业务误当完成；历史补单和结算缺少业务表级请求键时尤其敏感。
- 建议：幂等记录和业务结果同事务保存，绑定身份、门店、规范化请求摘要，重放返回原业务结果。前端禁用按钮不能替代服务端合同。

### R07 / P1：结算提成阶梯竞争

- 位置：`sales/SalesOrderController.java:742`、`sales/MonthlyCommissionTierService.java:29`。
- 场景：不同收银会话同时结算同技师不同服务，且钟数即将达到下一档。
- 服务单锁不同、钱包也可以不同，不能串行化同技师月钟数。建议按技师/月锁定计数，验证边界两单只按定义进入相应档位。

### R01 / P1：前台基础资料渲染也有未转义字段

- 位置：`apps/massage-console/app.js:1287`、`:1609`、`:1951`。
- 员工姓名、收款方式名称/备注、房间名称直接进入 innerHTML。现有 dispatchEscape、memberBusinessEscape 使用不一致。
- 建议：复用已存在的转义函数覆盖所有文本/属性位置；测试数据用 HTML 标记验证输出为文本，不仅测试工号。

## 待补场景

同一服务并发结算、混合支付全额红冲、订单金额与支付金额一致、加钟与下钟竞争、换房与下钟竞争、旧订单改单后的提成抵销。现行订单退款仅支持整单红冲，历史部分退款仅作为存量兼容场景。
既有源码断言不能代替这些数据库/HTTP 行为测试。第三阶段报告给出本次实际覆盖与剩余缺口。

第三阶段已验证派钟至现金整单退款的串联流程、顺序重复结算/退款、提成抵销；R16 通过真实换房申请/审批接口复现，R06 同幂等键不同金额返回 204 的行为也已确认。
