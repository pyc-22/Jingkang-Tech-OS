# V104 `member_wallet` 引用审计清单

审计基线：V104 多会员卡迁移将 `member_wallet` 从“会员一张卡”扩展为“会员多张卡”，`member_wallet.id` 是支付账户的唯一标识；没有明确卡号的旧调用只能解析当前会员的 active default 卡。历史支付和退款必须沿 `payment_record.wallet_id` / `refund_payment_record.wallet_id` 追溯实际付款卡。

## 代码点与处理口径

| 代码点 | 读写内容 | V104 处理 |
| --- | --- | --- |
| `member/MemberController.java` 会员搜索、档案、余额展示 | 读取 default 卡余额；会员统计按 `member_id` 汇总 `wallet_transaction` | 档案余额继续展示 default 卡；统计保持会员维度，但所有钱包流水均按 `member_id` 聚合；开户/充值显式锁定 default 卡或新建钱包后再写入 `wallet_id` |
| `member/MemberWalletController.java` | 钱包列表、创建、切换 default、启停 | 新卡使用 `wallet_id`；创建/启停/切换均校验当前租户和会员；默认卡唯一索引保证单会员单 default |
| `member/WalletTransactionController.java` | 钱包流水明细 | 按 `member_id` 查询会员全部卡流水，返回 `wallet_id`、卡号和卡名；不得从会员 default 卡反推历史流水 |
| `member/MemberRechargeCorrectionController.java` | 充值更正与补偿流水 | 原充值行的 `wallet_id` 作为更正目标；余额锁定使用原卡，不切换到当前 default 卡 |
| `member/MemberRechargeRefundController.java` | 充值退款、余额恢复 | 从原充值流水 `wallet_id` 恢复原卡；退款流水的 `wallet_id` 与 `member_id` 同时写入 |
| `member/MemberCleanupReportService.java` | 会员清理前检查流水/余额 | 检查范围仍按 `member_id` 覆盖该会员全部卡；执行清理前必须确认所有钱包余额为零且无业务历史 |
| `sales/SalesOrderController.java` 结算、财务更正、历史补单 | 会员余额支付、钱包扣款、订单详情/列表余额 | `PaymentInput.walletId` 指定实际卡；缺省时仅解析订单会员 active default；每条会员余额支付写一条 `wallet_transaction`，订单支付行保存 `wallet_id`；订单列表的会员余额为 default 卡展示值，不参与历史卡追溯 |
| `sales/RefundController.java` | 订单退款支付明细、会员卡退款 | 按原 `payment_record.wallet_id` 生成退款行并恢复同一钱包；禁止把订单主会员的 default 卡作为退款目标 |
| `operations/DailyReportService.java` | 日报充值、消费、渠道汇总 | 会员卡消费仍按订单支付明细从外部现金流排除；充值/退款按 `wallet_transaction` 的实际支付渠道汇总，卡维度不改变门店日报口径 |
| `operations/DailyOperatingReportController.java` | 日报查询/导出中的钱包流水 | 使用 `wallet_transaction` 的 `member_id`、`wallet_id` 和支付渠道；不再假设一个会员只有一行钱包 |
| `operations/OperationsReportController.java` | 经营流水、跨店交易、现金流 | 消费记录按实际 `wallet_transaction` 行输出；订单主会员与付款会员分开：订单查询保留 `sales_order.member_id`，钱包消费归实际付款会员 |
| `operations/ManagerRewardService.java` | 约客/会员消费统计 | 约客归属仍取订单主会员；钱包消费存在时按实际付款会员的流水计数，不能用 default 卡余额替代流水 |
| `sales/SalesOrderController.java` / `operations/*` 的 `wallet_transaction` 查询 | 直接按 `member_id` 的历史兼容查询 | 继续按会员聚合；涉及余额变更、退款或更正的写路径必须携带 `wallet_id` |

## SQL / 迁移检查

- V104 给 `member_wallet` 增加 `account_code`、`account_name`、`active`、`is_default`，移除会员单钱包唯一约束，增加租户卡号唯一和每会员一个 default 的部分唯一索引。
- V104 回填既有 `MEMBER_BALANCE` 支付和退款的 `wallet_id`，再添加“会员余额必须有卡、外部方式不得有卡”的约束。
- 迁移只追加字段、索引和回填，不删除钱包或流水；多卡环境不支持回退到旧的一会员一钱包结构。回退只能恢复应用版本，保留 V104 schema 和数据，待人工制定合并卡方案。
- `member_wallet.opened_store_id` 只记录开户门店来源，不是当前访问范围；跨店钱包查询按 `tenant_id`、会员和 active 卡约束，钱包流水仍按 `wallet_transaction.store_id` 做门店报表隔离。钱包搜索接口只返回 active 会员和 active 卡。

## 验证结果

- `MemberPaymentAccountsMigrationTest` 覆盖字段、唯一索引、支付/退款回填和支付方式约束。
- 结算、退款、充值更正和会员流水相关测试确认实际钱包由 `wallet_id` 追踪；跨会员支付的订单主会员、付款会员和原卡退款口径保持分离。
