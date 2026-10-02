# 20261001-manager-ownership-conversion-v2 更新说明

本包包含门店主店长归属、转化钟类，以及 V106/V107 的幂等加固。店长绩效不再要求管理岗打卡；转化计入排钟数，主服务提成按点钟规则，加钟保持原规则。生产部署由门店安排，本包不执行部署。

## 本次修复

1. V106 的主店长列使用 `ADD COLUMN IF NOT EXISTS`；外键和两个 attendance CHECK 约束均按 `pg_constraint` 判断后创建，且旧约束使用 `DROP CONSTRAINT IF EXISTS`。因此可恢复生产中已部分执行、尚未登记 Flyway 的状态，并允许重复执行。
2. V107 的 `service_session.converted` 列和钟类 CHECK 约束同样幂等加固，保留 `CONVERSION` 语义。
3. 健康接口和前端缓存版本统一为 `20261001-manager-ownership-conversion-v2`。

## 部署前

1. 核对生产 API 服务名及前台、店长、技师静态目录。备份现有 JAR、三端静态文件、PostgreSQL 数据库（含 `flyway_schema_history`）和附件目录；记录备份路径与 SHA-256，并抽查备份可读取。
2. 用 `SHA256SUMS.txt` 校验包内文件。先确认目标门店已配置有效 `STORE_MANAGER` 员工、登录账号与门店权限；多位店长时在管理端设置主店长，否则约客会提示配置归属。

## 停服与替换

1. 在维护窗口停 API，保留旧 JAR 和静态文件副本。先替换 `massage-api-0.1.0.jar`，启动 API。
2. Flyway 随 API 启动自动执行 V106（主店长与无需打卡归属）和 V107（转化标记及提成记录钟类约束）；无需手工运行 SQL。确认迁移日志无错误后再替换静态文件。
3. 前台目录替换 `app.js`、`index.html`、`manager-rewards-admin.js`、`manager-rewards-admin.css`、`expense-ui.js`；店长目录替换 `manager-mobile.html`、`manager-mobile.js`、`manager-rewards.js`、`manager-rewards.css`、`expense-ui.js`；技师目录替换 `mobile.html`、`mobile.js`、`technician-service-worker.js`。同目录部署时每个同名文件只替换一次。
4. 刷新静态服务缓存，前台强刷，移动端清理站点缓存并重新打开，让技师端 service worker 更新。

## 上线核对

1. `GET /api/health` 应返回 `status=UP`、`database=UP`、`release=20261001-manager-ownership-conversion-v2`。
2. 管理端确认有效店长列表可见，设置主店长；店长端在未打卡条件下核对今日/月度归属和约客上传。抽查月结锁定仍拒绝归属及约客变更。
3. 前台对未结算服务依次验证排钟、点钟、转化互改及当前值回显；转化服务结算后，技师排钟数增加、点钟数不增加，主服务提成按点钟规则，加钟不变。抽查订单详情、小票、日报/月结、技师端，以及业务更正和退款冲回。
4. 在生产流程中禁止手工执行 DDL，所有结构变更一律通过 Flyway 迁移文件并由应用启动执行。

## 回退

停止 API，保存启动和迁移日志，恢复部署前 JAR 与三端静态文件，重新启动并检查健康、登录、约客、结算和退款，随后强刷客户端缓存。V106/V107 成功执行后不要手工删除 Flyway 记录或迁移列；需要数据库级回退时使用部署前备份与已验证的恢复流程，核对业务写入后再开放流量。
