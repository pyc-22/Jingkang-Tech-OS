# 20260915-next-optimization-v5 验证报告

验证日期：2026-09-15
环境：Windows、Node.js、Microsoft OpenJDK 21.0.12.1、PostgreSQL 16.14

## 自动化结果

- 前端全量回归：`npm run test:console`，151 tests，151 passed，0 failed。
- 前端语法：`node --check` 检查 `app.js`、`daily-report.js`、`mobile.js`，三个命令退出码均为 0。
- 后端全量回归：JDK 21 下执行 `mvnw.cmd test`，142 tests，0 failures，0 errors，0 skipped，`BUILD SUCCESS`。
- 构建：JDK 21 下执行 `mvnw.cmd clean package -DskipTests`，编译 72 个主源码文件和 33 个测试源码文件，`BUILD SUCCESS`。

## PostgreSQL 事务烟测

使用 `@SpringBootTest` 连接本地 PostgreSQL 16.14，在回滚事务中调用真实历史补单、订单详情、日报和退款控制器：

- Flyway 成功校验 93 个既有迁移并执行 V94，schema version 更新为 94。
- 创建 1 笔会员余额历史补单，包含 2 个项目：`BOOKED_CALL` 有房项目和 `EXTENSION` 无房项目。
- 每个项目分配 2 位技师，比例为 6000/4000；订单详情两行均返回 `serviceSessionId`、两位技师、钟类，且有房行返回正确房间号。
- 数据库断言得到 2 个完成态服务单、2 条订单服务关联、4 个完成态参与者和 4 条结算提成记录；每个服务单分配合计 10000，提成基数合计等于订单金额。
- 会员余额按订单金额扣减，`MEMBER_BALANCE` 支付记录和 `CONSUMPTION` 钱包流水写入补单营业日。
- 日报的销售额、自动客次、会员消费及会员余额渠道金额均按订单金额增加。
- 整单会员余额退款自动完成；钱包余额恢复，退款 `business_date` 等于原补单日期，4 条提成记录完整冲回，日报净销售恢复到烟测前数值。
- 定向烟测：1 test，0 failures，0 errors，`BUILD SUCCESS`；事务结束后临时用户、会员和登录会话计数均为 0。

## 构建产物

- JAR：`services/massage-api/target/massage-api-0.1.0.jar`
- 大小：44,403,373 字节
- JAR SHA-256：`259E1CC4128ED8B623894848FB6E7D362C31A6A6B56F460B68F0DBFF767A1F72`
- JAR 内容检查：包含 `HomeController`、`SalesOrderController` 及 Flyway V90-V94。

## 覆盖说明

本轮没有新增独立浏览器人工点击结果。补单字段和提交契约由 151 项前端回归覆盖，完整数据链路由上述真实 PostgreSQL 事务烟测覆盖。
