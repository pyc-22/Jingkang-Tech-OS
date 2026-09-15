# 20260914-next-optimization-v4 部署说明

## 发布包

使用 `deploy/20260914-next-optimization-v4.zip`。发布包由完整当前工作树构建，包含前端、JAR、部署脚本、版本文档和包内 `SHA256SUMS.txt`。

## 部署步骤

1. 备份 PostgreSQL 数据库、当前生产 JAR、`apps/massage-console` 和外部配置。
2. 在独立临时目录解压 ZIP，并逐项校验 `SHA256SUMS.txt`。
3. 停止 `JingkangMassageApi` 服务。
4. 整体替换前端目录和 `services/massage-api/target/massage-api-0.1.0.jar`，避免旧静态资源残留。
5. 启动服务，确认 Flyway 成功执行 V93，且 `/api/health` 返回 `status=UP`、`release=20260914-next-optimization-v4`。
6. 强制刷新前台和技师端，确认静态资源查询参数为 `20260914-next-optimization-v4`。

也可在解压目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\DEPLOY.ps1
```

脚本会先校验包内清单并备份现有文件，部署失败时恢复文件备份。

## 部署后抽查

- 派单异常房卡可打开重新派单和取消派单弹窗。
- 技师接单后可开始服务，前台状态和计时同步。
- 手工添加项目可配置多技师、钟类、时长和房间；结算后订单详情、技师业绩和提成均有记录。
- 无房手工项目也能在订单详情和技师服务明细中查询。

详细验证证据见 `docs/20260914-next-optimization-v4-verification.md`。
