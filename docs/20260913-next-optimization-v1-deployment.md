# 20260913-next-optimization-v1 部署说明

## 发布物

本版本从完整当前工作树构建，保留既有后端修复和本轮前端功能。发布包为 `deploy/20260913-next-optimization-v1.zip`，包含完整 `apps/massage-console/`、`services/massage-api/target/massage-api-0.1.0.jar`、运行配置、部署脚本、版本文档和 `SHA256SUMS.txt`。打包脚本为 `tools/release/package-full-optimization-20260912.ps1`，参数使用 `-Version 20260913-next-optimization-v1`。

## 部署前

1. 将 ZIP 解压到独立临时目录，不要直接覆盖线上目录。
2. 备份 PostgreSQL 数据库、当前 JAR、完整静态目录、外部配置、附件和日志，并验证备份可读。
3. 在维护窗口暂停派单、上钟、结算、退款、充值和房态写操作。
4. 确认 JDK 21、PostgreSQL 16、生产环境变量和服务账户与当前版本一致。
5. 逐文件校验包内 `SHA256SUMS.txt`；缺失、哈希不一致或清单外文件都应停止部署。

## 切换步骤

在包根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\DEPLOY.ps1 `
  -ProjectRoot 'C:\wwwroot\jingkang-platform' `
  -ServiceName 'JingkangMassageApi' `
  -HealthUrl 'http://127.0.0.1:8080/api/health'
```

脚本会校验清单、备份目标 JAR/前端目录、停止服务、整体替换静态资源和 JAR、启动服务并确认健康检查中的 `release=20260913-next-optimization-v1`。若生产由其他进程管理器托管，保持相同顺序并在健康检查成功后恢复流量。

## 数据库

启动时 Flyway 按顺序确认 V87-V91。V90 提供技师营业日打卡结构，V91 提供历史补单权限、授权和订单补单字段。迁移前必须完成数据库备份；不要手工删除表、列或修改 Flyway 历史。

## 上线检查

- `GET /api/health` 返回 HTTP 200、`status=UP`、`database=UP` 和本版本 release。
- 前台可见历史补单入口时，补单日期默认昨天且禁止未来日期；店长端只保留补单记录查看。
- 多技师派钟可为每位技师分别选择项目、钟类、时长和床位。
- 前台下钟弹出技师、工号、房间、项目和已服务时长二次确认。
- 待付款房间卡片显示技师/工号和项目，多技师显示“等 X 人”。
- 未打卡技师不能上钟；历史补单、支付、退款和日报营业日抽查通过。

详细证据见 `20260913-next-optimization-v1-verification.md`。
