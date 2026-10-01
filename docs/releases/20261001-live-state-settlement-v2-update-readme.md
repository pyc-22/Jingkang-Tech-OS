# 靖康科技运营平台正式发布包

包版本：`20261001-live-state-settlement-v2`
代码 release：`20261001-live-state-settlement-v1`

本 v2 修订仅补入遗漏的 `expense-ui.js`，代码版本标签与前端资源版本号保持 `20261001-live-state-settlement-v1`。

## 一、部署前备份

1. 核对生产 JAR、console 静态目录、manager 静态目录和 NSSM 服务名；记录现有文件 SHA-256。
2. 完整备份当前 JAR、console 与 manager 前端文件、PostgreSQL `massage_platform`（含 `flyway_schema_history`）和报销附件目录。
3. 保留旧包及备份作为回退副本。未完成备份和恢复抽查前不要停服。

## 二、停服与替换顺序

1. 停止 `JingkangMassageApi`，确认 8080 不再监听；保留静态服务和 nginx，除非维护窗口另有要求。
2. 先替换 `massage-api-0.1.0.jar`，再启动 API。
3. 确认 Flyway 成功后，再替换 console 的 `app.js`、`index.html`、`manager-rewards-admin.js`、`manager-rewards-admin.css`、`expense-ui.js`，以及 manager 的 `manager-mobile.html`、`manager-mobile.js`、`manager-rewards.js`、`manager-rewards.css`、`expense-ui.js`。
4. 静态文件替换完成后 reload nginx；健康检查未通过前不要开放真实流量。

## 三、数据库迁移

V104（多会员卡/组合支付）和 V105（报销标题）由 Flyway 随 API 启动自动迁移，无需手工执行 SQL。不要直接修改生产业务表或删除迁移记录。启动日志必须显示升级到 V105 且无 checksum、约束或回填错误。

## 四、健康检查与验证

1. `GET /api/health`，要求 `status=UP`、`database=UP`、`release=20261001-live-state-settlement-v1`、`expenseClaimSequence=true`。
2. 以真实门店权限检查 `/api/v1/operations/live-state`；确认前台和店长端房态、技师状态、待结算和床位计数一致。
3. 验证结算、退款、组合支付、报销标题及提交后刷新；记录请求和响应摘要。
4. Windows 使用 Ctrl+F5，移动端清理站点缓存后重新打开；确认静态资源带 `?v=20261001-live-state-settlement-v1`。

## 五、测试店清理

真实门店流量恢复并完成阶段四验证后，再通过正常作废 API/服务处理交接清单中的 zz-wanda 测试服务。不得物理删除；每条必须有操作人、原因、时间的审计记录，并回读 live-state 确认无残留占床。

## 六、回退步骤

1. 停止当前 API，保留部署日志和数据库备份；恢复阶段一备份的旧 JAR、两套静态文件和附件目录。
2. V104/V105 已成功迁移时，不删除迁移记录或手工删表；按已验证的数据库备份恢复方案回退数据，或先恢复旧应用并保留兼容 schema。
3. 启动旧版本，重新检查 `/api/health`、登录、live-state、结算和退款，静态端强刷清缓存；确认无误后再开放流量。

本包只提供发布文件，不执行生产部署动作。
