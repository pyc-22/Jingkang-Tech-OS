# 20261001-commission-payment-print-v1 更新说明

本包修复电脑端提成总汇截断、单房及合并结算的组合支付行操作，并增加可配置的本机打印组件地址和打印反馈。生产环境当前基线为 `20261001-live-state-settlement-v1`；本包不新增数据库迁移，不合并重复技师主数据。

## 部署前

1. 核对生产 JAR、前台静态目录、店长静态目录及服务名，备份现有 JAR、两套静态文件、数据库和报销附件。记录备份路径与 SHA-256，并验证备份可读取。
2. 核对 `SHA256SUMS.txt` 与包内文件一致，在维护窗口内停服。生产迁移状态由 Flyway 随 API 启动自动核对；V103–V105 已属于现有版本，无需手工执行 SQL。

## 替换与验证

1. 停止 API，替换 `massage-api-0.1.0.jar`，启动 API；确认 Flyway 无错误，`GET /api/health` 返回 `status=UP`、`database=UP`、`release=20261001-commission-payment-print-v1`。
2. 替换前台 `app.js`、`index.html`、`manager-rewards-admin.js`、`manager-rewards-admin.css`、`expense-ui.js`；替换店长端 `manager-mobile.html`、`manager-mobile.js`、`manager-rewards.js`、`manager-rewards.css`、`expense-ui.js`。按实际目录映射核对，保留原文件备份。
3. 刷新静态服务缓存；电脑端 Ctrl+F5，移动端清理站点缓存后重新打开。确认前台引用 `app.js?v=20261001-commission-payment-print-v1`。
4. 核对技师提成总汇与完整后端汇总，测试单房及合并结算添加/删除支付行、两卡或卡加现金结算及原路退款。测试本机打印组件与浏览器打印降级；组件地址由每台前台电脑在打印设置中单独配置。

## 回退

停止 API，恢复部署前备份的 JAR 和两套静态文件，启动后核对 `/api/health`、登录、结算、退款与打印，最后强刷客户端缓存。本包没有新迁移；保留数据库及附件备份供核查，勿手工删改 Flyway 记录。

本包仅为交付物，不执行生产部署。
