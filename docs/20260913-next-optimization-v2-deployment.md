# 20260913-next-optimization-v2 部署说明

## 发布物

本版本从完整当前工作树构建，保留既有 P0 冲突处理、日报修复、V87-V91、技师打卡门禁、店长派钟和历史补单后端改动，并包含前台历史补单弹窗排版优化及充值渠道统计修复。发布包为 `deploy/20260913-next-optimization-v2.zip`，内含完整 `apps/massage-console/`、`services/massage-api/target/massage-api-0.1.0.jar`、运行配置、部署脚本、版本文档和 `SHA256SUMS.txt`。

打包命令：

```powershell
powershell -ExecutionPolicy Bypass -File tools/release/package-full-optimization-20260912.ps1 `
  -Version 20260913-next-optimization-v2
```

## 部署前

1. 将 ZIP 解压到独立临时目录，先完成 PostgreSQL、当前 JAR、完整静态目录、外部配置、附件和日志备份，并验证备份可读。
2. 确认 JDK 21、PostgreSQL 16、生产环境变量和服务账户与当前版本一致。
3. 暂停派钟、上钟、结算、退款、充值和房态写操作，逐项校验包内 `SHA256SUMS.txt`。
4. 清单缺失、哈希不一致或出现清单外文件时，暂停切换并保留现场。

## 切换步骤

在包根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\DEPLOY.ps1 `
  -ProjectRoot 'C:\wwwroot\jingkang-platform' `
  -ServiceName 'JingkangMassageApi' `
  -HealthUrl 'http://127.0.0.1:8080/api/health'
```

脚本会校验清单、备份目标 JAR 和前端目录、停止服务、整体替换静态资源与 JAR、启动服务，并确认健康响应中的 `release=20260913-next-optimization-v2`。使用其他进程管理器时保持相同顺序，在健康检查通过后恢复流量。

## 数据库

启动时按 Flyway 顺序确认 V87-V91 已执行。充值渠道修复使用现有 `wallet_transaction.payment_method` 与 `payment_method_name_snapshot`，本版本不要求补充迁移。迁移历史保持完整，部署前完成数据库备份。

## 上线检查

- `/api/health` 返回 HTTP 200、`status=UP`、`database=UP` 和本版本 release。
- 前台历史补单弹窗中日期、会员、项目卡片、技师分配、金额和支付方式分组清楚；日期默认昨天且未来日期被限制。
- 多技师派钟可为每位技师分别选择项目、钟类、时长和床位；单技师流程保持可用。
- 前台下钟显示二次确认中的技师、工号、房间、项目和已服务时长。
- 待付款房间卡片显示技师/工号和项目，多技师显示人数摘要。
- 会员开卡、充值、续卡选择微信、支付宝、现金等渠道后，日报渠道金额和现金流同步增加；充值退款按原渠道冲减。
- 未打卡技师仍受门禁限制；历史补单、支付、退款和日报营业日抽查通过。

详细证据见 `20260913-next-optimization-v2-verification.md`。
