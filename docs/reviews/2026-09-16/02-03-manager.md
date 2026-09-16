# 第二阶段 / 店长端

范围：日报保存/发布、经营报表、技师提成汇总、阶梯、会员跨店流水、manager-mobile.js；旁查报销权限和附件存储。
后端路径前缀：`services/massage-api/src/main/java/com/chengxin/massage/`。

## 已核实行为

DailyReportService 是收入、退款、储值渠道统计的共享入口；普通退款按原订单营业日归属，而充值退款按发生营业日归属，两者不能在巡检中混用。
已保存日报的部分财务字段读取时与实时明细合并，历史快照与当前明细有差异不等同于资金损坏。日报的人工目标、人员数和交接内容不应按交易流水强制重算。
报销 API 在 Controller 再次检查 EXPENSE_* 权限及全店视图权限；文件路径以存储根目录规范化校验，不把 MIME 类型校验当成文件内容安全扫描。

## 问题

### R17 / P1：保存/发布并发可解除发布锁定

位置：`operations/DailyOperatingReportController.java:276`、`:293`、`:312`。
会话 A 读到 SAVED；B 发布并提交；A 随后无条件 `status='SAVED'` 更新，结果已发布报表恢复可编辑。`version=version+1` 只是自增，不是乐观锁，WHERE 没有版本条件。
建议 `WHERE version=:expected AND status<>'PUBLISHED'`，零行返回 409；发布也锁定/检查相同版本。测试采用不同用户会话，避免会话 last_seen_at 更新偶然串行化掩盖竞争。

### R01 / P1：存储型 HTML 注入

位置：`apps/massage-console/manager-mobile.js:470`、`:473`、`:477`、`:568`。
门店/会员/项目数据直接进入 HTML，会员录入者可影响店长查看的内容。建议使用 managerEscape 或 DOM textContent，并加强 CSP；令牌存储方式不能替代消除注入点。

### R07 / P1：提成档位取决于竞争和补单顺序

位置：`sales/MonthlyCommissionTierService.java:29`、`:32`。
汇总整月已有 MAIN 钟数后再加当前钟数。并发会读同一旧值；补较早日期订单时也会看到该月更晚的已有钟数。并发缺陷应修；补单到底按写入顺序还是业务日期重算属于待确认规则，报告不擅自定义薪酬政策。

### R12 / P2：日报无统一快照且月报查询放大

位置：`operations/DailyReportService.java:27`、`:73`、`:96`；`operations/DailyOperatingReportController.java:448`、`:581`。
订单总额、退款总额、渠道与钱包由不同 SELECT 得到，在 READ COMMITTED 下可以跨多个提交；遍历月份还反复执行这一组查询。
建议批量按日期聚合、报表读使用一致快照，并对真实数据量做 EXPLAIN (ANALYZE, BUFFERS) 的副本验证。单纯添加 @Transactional(readOnly=true) 并不自动提供可重复读快照。

## 回归要点

日报销售=有效订单支付总额、退款=已完成退款、净额=前两者之差；现金流排除会员余额订单支付并加外部充值净额；赠送不算现金流。覆盖 0 元、部分退款、全额红冲、跨店会员、历史补单、保存后再退款和客户数人工覆盖。
