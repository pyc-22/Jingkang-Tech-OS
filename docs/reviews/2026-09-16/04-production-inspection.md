# 第四阶段：生产数据巡检脚本与修复建议

## 交付与执行状态

脚本：`tools/maintenance/inspect_data_quality.sql`。

本次未连接远程生产库，生产异常数量保持“待执行”，没有伪造现场巡检结论。已在新建 PostgreSQL 16.14、全部 93 个迁移（V1 至 V94，仓库没有 V86）上验证脚本；脚本不修改业务数据、不自动修复、不清理订单。

保护措施：新会话内 `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`，同一快照；每条语句 60 秒超时、锁等待 3 秒、事务空闲超时 60 秒；正常结束固定 ROLLBACK。`ON_ERROR_STOP` 在批处理报错后退出，新连接关闭即回滚。交互方式若中途失败，执行 ROLLBACK 或退出会话；不要在已有事务中 `\i` 此脚本。

## Windows 运行方式

把仓库版本的脚本部署到服务器维护目录，以只读账号优先。使用 `-W` 交互输入凭据，不在命令、脚本或报告写入密码。以下路径按实际部署位置调整。

```powershell
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' `
  -X -h localhost -U postgres -d massage_platform -W `
  -v ON_ERROR_STOP=1 -v from_date=2026-09-01 -v to_date=2026-09-16 `
  -f 'C:\wwwroot\jingkang-platform\tools\maintenance\inspect_data_quality.sql' `
  -L 'C:\wwwroot\jingkang-platform\update\data-quality-inspection.log'
if ($LASTEXITCODE -ne 0) { throw 'Inspection stopped; inspect the error output.' }
```

只检查某店时加 `-v store_id=目标门店UUID`。未传门店表示全部；未传日期默认最近 30 个数据库自然日（含今天）。指定的是已存储营业日，不使用 created_at 代替业务日。确认日志末尾出现 `INSPECTION_COMPLETE_READ_ONLY`，否则该次扫描不是完整报告。

本脚本不是旧任务的 9 月 5-7 日订单删除脚本；没有备份检查或删除 COMMIT，因为没有写入操作。修复前仍需单独备份、验证恢复和审批。

## 范围与结果口径

- 外键：从 public 的系统目录读取所有 FK，包括复合外键、NOT VALID、触发器禁用标志，生成只读反连接查孤儿；**全库表范围，不受门店/日期参数限制**。单条外键输出数量和一个样本 ctid，ctid 只供当前快照定位，不能当长期修复主键。
- 订单/退款/关联提成：按订单营业日过滤；退款金额与已完成状态、原支付关联一起检查，待处理退款计入预约额度。
- 服务/房态：选定门店的现存服务及当前活动占用，不按订单日期截断，避免漏掉跨日服务。
- 钱包：选择开户于该店或曾在该店交易的钱包后，使用其**所有门店、全部历史**核算。交易门店与钱包开户店不同是正常共享钱包，不作为异常。
- 幂等回执无可靠门店字段，扫描全局 PROCESSING 超过 15 分钟的行，仅提醒排查，不据此删除重放。
- 输出只包含内部 ID、计数、金额、日期、状态；不输出姓名、手机号、审计 JSON、密码、令牌。
- 每个业务检查输出 anomaly_count；每项最多 20 个样本，样本数量不代表总数量。26 项业务检查外，还有逐个 FK 的全量结果及约束清单。

## 检查清单与修复建议

| 检查 | 默认级别 | 核对与修复方向 |
|---|---|---|
| FK_ORPHAN / 约束未验证或停用 | P1 / 人工确认 | 查导入、删除、禁用约束历史；恢复真实父子关系后验证约束，避免简单删除子行 |
| ORDER_PAYMENT_TOTAL | P1 | 已结算订单 paid 与支付总额对账，按原收款凭证判断哪方错误 |
| ORDER_LINE_PRICE_REVIEW | REVIEW | 明细保留项目原价，折扣/免单会与头金额不同；先检查结算折让与审计，不自动改成相等 |
| PAYMENT_SCOPE / SERVICE_ORDER_SCOPE | P1 | 核对 tenant/store/order/line/service 归属后定向纠正 |
| ORDER_OVER_REFUND / REFUND_TOTAL | P1 | 核对待处理及完成退款累计、明细/已完成退款支付总额；先冻结进一步退款，再复核渠道实退金额 |
| REFUND_PAYMENT_SCOPE / REFUND_LINE_SCOPE | P1 | 退款必须引用同订单原支付/原明细，核查原业务凭证 |
| COMMISSION_SCOPE / COMMISSION_REVERSAL_SCOPE | P1 | 核对订单、明细、原提成、技师与门店；财务确认后用更正/抵销流程，不直接批量删记录 |
| COMMISSION_DATE_REVIEW | REVIEW | 展示提成营业日与订单营业日差异，补记、冲销或旧数据可能有原因；日期差异不是删除依据 |
| SESSION_BED_SCOPE / ACTIVE_BED_DUPLICATE | P1 | 暂停冲突床位派单，锁定相关房间后修正服务所占床，再补复合约束 |
| ROOM_IN_SERVICE_STATE / PARTICIPANT_SCOPE | P1 | 由所有有效服务重算房态；核对参与者所属技师/门店，避免结束其他服务 |
| WALLET_ROW_EQUATION | P1 | 逐条验证 before+amount=after；R04 只可能是中间快照错误，不据此再扣钱包 |
| WALLET_MEMBER_SCOPE | P1 | 确认流水和钱包的会员/租户一致；不按交易门店强行归属开户店 |
| WALLET_HISTORY_REVIEW | REVIEW | 核对可信期初、导入、历史归档、调整流水；缺期初时余额不等于历史净额不必然是资金损坏 |
| RECHARGE_OVER_REFUND / RECHARGE_REFUND_SCOPE | P1 | 检查同一原充值额度、会员/门店和类型；取消未实际执行的错误申请需走审批，不倒推取消已实退资金 |
| REFUND_NUMBER_DUPLICATE | P2 | 区分编号碰撞与真正重复付款；保留请求键和渠道证据，不按编号直接合并 |
| BACKFILL_METADATA / BACKFILL_AUDIT_REVIEW | P2 / REVIEW | 核对原日期和操作人；账号删除、审计归档可能解释缺项，禁止编造操作人或操作时刻 |
| DAILY_SNAPSHOT_REVIEW | REVIEW | 保存快照与按当前明细重算净销售对比；先核对发布时点及后续退款/补单，不覆盖人工指标 |
| SHIFT_CASH_EQUATION | P1 | 检查 actual-expected=difference 及缺失金额，核对交班现金记录和渠道范围 |
| STALE_OFFLINE_RECEIPT_REVIEW | REVIEW | 按业务结果确认是否已落账，再修回执；不要删除后盲目重放资金请求 |

检查级别表示潜在影响，不等同于已确诊。基础业务允许空房间手工服务，脚本不把这种服务认作孤儿；合法冲销为负数，脚本不把所有负提成判成异常。

## 本地验证报告

| 场景 | 结果 |
|---|---|
| 全迁移种子基线 | 26 项业务检查均为 0，脚本正常结束 |
| 注入未验证 FK 的孤儿子行 | FK_ORPHAN 数量 1，约束名和样本输出正确 |
| 注入余额快照算式错误 | 精确识别注入的 wallet_transaction ID |
| 注入原充值累计超额退款 | 精确识别对应原充值 ID |
| 单店巡检，共享钱包另店交易 | 完整历史核算无错误跨店告警，余额保留 |
| 起始日晚于结束日 | 提前报错退出，业务计数不变，不输出完成标志 |
| 只读与数据保留 | 返回 read_only=on、repeatable read；扫描前后订单/服务/提成/支付/流水计数不变，注入值未被修改 |

额外已复现的 R03/R04/R16 业务异常也可被此脚本识别，但巡检回归使用独立注入夹具，不把“缺陷继续存在”作为测试通过条件。

## 生产报告填写模板

| 字段 | 待填写内容 |
|---|---|
| 运行环境/数据库迁移版本 | 待生产确认 |
| 巡检操作者、时间、脚本 commit | 待生产确认 |
| 参数：门店、开始/结束营业日 | 待生产确认 |
| 是否完整结束、错误/超时 | 待生产执行 |
| P1 / P2 / REVIEW 分项计数 | 待生产输出 |
| 样本核实与业务解释 | 待门店/财务复核 |
| 修复审批/备份恢复证据 | 仅在计划写修复时填写 |
| 修复后同口径复查与差异 | 待修复后执行 |

数据库规模未知：FK 全表扫描和完整钱包历史聚合可能触发超时；建议在低峰或一致的只读副本执行，先检查计划和资源。不在繁忙主库盲目提升超时。长快照会延迟旧版本回收，失败后确认会话已结束。

该脚本没有检查外部支付渠道真实到账、真实现金、历史审计归档库、被删除且无任何残留证据的数据；这些需要额外凭证。SQL 也不能替代 R07/R17 等交错条件的并发测试。
