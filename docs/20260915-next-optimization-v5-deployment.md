# 20260915-next-optimization-v5 部署说明

## 发布包

使用 `deploy/20260915-next-optimization-v5.zip`。发布包由完整当前工作树构建，包含前端、JAR、部署脚本、版本文档和包内 `SHA256SUMS.txt`。

## 部署步骤

1. 备份 PostgreSQL 数据库、当前生产 JAR、`apps/massage-console` 和外部配置。
2. 在独立临时目录解压 ZIP，并逐项校验 `SHA256SUMS.txt`。
3. 停止 `JingkangMassageApi` 服务。
4. 整体替换前端目录和 `services/massage-api/target/massage-api-0.1.0.jar`，避免旧静态资源残留。
5. 启动服务，确认 Flyway 成功执行 V94，且 `/api/health` 返回 `status=UP`、`release=20260915-next-optimization-v5`。
6. 强制刷新前台页面，确认 `app.js` 查询参数为 `20260915-next-optimization-v5`。

也可在解压目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\DEPLOY.ps1
```

脚本会先校验包内清单并备份现有文件，部署失败时恢复文件备份。

## 部署后抽查

- 新建历史补单，分别选择技师、钟类、可选房间和时长，技师比例合计为 100%。
- 结算后打开订单详情，确认每行显示技师、钟类、房间和时长。
- 在补单营业日查看日报、技师业绩和提成，确认订单及支付渠道金额正确。
- 对测试补单执行整单退款，确认会员余额恢复，退款与提成冲回仍计入原补单营业日。
- 抽查普通手工添加项目和正常服务单结算，确认原流程不受影响。

详细证据见 `docs/20260915-next-optimization-v5-verification.md`。
