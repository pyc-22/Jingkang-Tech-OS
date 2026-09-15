# 20260914-next-optimization-v4 验证报告

验证日期：2026-09-15
环境：Windows、Node.js、Microsoft OpenJDK 21.0.12.1、PostgreSQL 16

## 自动化结果

- 前端全量回归：`npm run test:console`，151 tests，151 passed，0 failed。
- 前端语法：`node --check` 检查 `app.js`、`mobile.js`、`manager-mobile.js`，三个命令退出码均为 0。
- 后端全量回归：JDK 21 下执行 Maven test，140 tests，0 failures，0 errors，0 skipped，BUILD SUCCESS。
- 构建：JDK 21 下执行 `clean package -DskipTests`，编译 72 个主源码文件和 33 个测试源码文件，BUILD SUCCESS。

## 手工项目数据库烟测

使用 Spring MockMvc 和本地 PostgreSQL 16 在回滚事务中调用真实登录、结算和订单详情接口：

- 登录、结算、订单详情均返回 HTTP 200。
- 同一订单创建 2 条手工服务：一条无房 `BOOKED_CALL` 45 分钟，一条有房 `SELECTED` 60 分钟。
- 每条服务分配 2 位技师，比例为 6000/4000。
- 数据库断言得到 2 个服务单、4 个参与者、4 条提成记录，提成基数合计等于订单金额。
- 定向烟测：1 test，0 failures，0 errors，BUILD SUCCESS；测试事务结束后订单和测试用户计数均为 0。
- Flyway schema version 为 93，`service_session.room_id` 已确认为可空。

## 浏览器检查

- 使用真实 `index.html`、`app.js` 和 `styles.css`，配合只读基础资料夹具完成浏览器登录。
- 页面成功显示当前门店、1 个空闲房间、2 位已打卡可派技师和“已同步”状态，页面未显示初始化错误提示。
- 手工项目配置弹窗的后续自动点击因浏览器标签线程绑定中断而未计入通过项；其字段、校验和提交契约由 151 项前端回归覆盖，结算后的数据链路由上述 PostgreSQL 事务烟测覆盖。

## 构建产物

- JAR：`services/massage-api/target/massage-api-0.1.0.jar`
- JAR SHA-256：`E231C0A73A7D0E170BA13E972786CF54E3F0B148F043A092EEDB6EB0EB373516`
- JAR 内容检查：包含 V90、V91、V92、V93 和新增手工结算契约类型。

## 环境限制

本机直接启动 JAR 时，Spring、Hikari、Flyway 和 V93 校验均已成功，但嵌入式 Tomcat 创建 Selector 回环连接时报 `java.net.SocketException: Invalid argument: connect`。该 Windows/JDK 网络问题也在 IPv4 和两种 Selector Provider 配置下复现，因此本轮后端业务 HTTP 烟测由 MockMvc 连接真实 PostgreSQL 完成，未将失败的独立端口启动记为通过。
