# 20260912-full-optimization-v1 部署说明

## 发布物与来源

本版本来源固定为当前完整工作树，JAR 由发布脚本直接读取工作树产物，不使用 Git HEAD、干净基线或旧 ZIP。发布脚本为 `tools/release/package-full-optimization-20260912.ps1`，默认读取：

```text
services/massage-api/target/massage-api-0.1.0.jar
```

脚本输出 `deploy/20260912-full-optimization-v1.zip`，包内包括完整 `apps/massage-console/`、JAR、`server.massage.js`、`config/logback-spring.xml`、部署脚本、四份版本文档和 `SHA256SUMS.txt`。

## 部署前置

1. 将 ZIP 上传到服务器独立临时目录，例如 `C:\deploy-tmp\20260912-full-optimization-v1`，不要直接解压覆盖在线目录。
2. 备份 PostgreSQL 数据库、当前 JAR、完整静态目录、外部配置、附件目录和日志；确认备份可读取。
3. 维护窗口内暂停派单、上钟、结算、退款、充值和房态写操作，并确认没有长时间运行的离线同步。
4. 确认 JDK 21、Node.js 运行时和生产环境变量与上一版本一致。
5. 解压后在包根目录执行 `SHA256SUMS.txt` 逐文件校验；任何缺失、哈希不一致或清单外文件都应停止部署。

## 切换步骤

推荐使用包内脚本，它会先备份目标 JAR/前端目录、校验清单、停止服务、复制文件、启动服务并检查健康版本；失败时自动恢复备份：

```powershell
powershell -ExecutionPolicy Bypass -File .\DEPLOY.ps1 `
  -ProjectRoot 'C:\wwwroot\jingkang-platform' `
  -ServiceName 'JingkangMassageApi' `
  -HealthUrl 'http://127.0.0.1:8080/api/health'
```

若服务器服务由其他进程管理器托管，保留同样的顺序：停止 API/Web、整体替换 `apps/massage-console`、替换 JAR、启动 API、确认健康后再恢复 Web 和入口流量。不要覆盖数据库、附件和外部配置目录。

## 数据库迁移

服务启动时由 Flyway 按序执行 V90 和 V91：

- V90 新增 `technician_clock_in` 及索引，使用 `CREATE TABLE IF NOT EXISTS` 和唯一营业日约束。
- V91 新增 `HISTORICAL_ORDER_CREATE` 权限、店长补单授权表，以及订单历史补单字段/索引；所有变更为追加式并带默认值。

迁移前数据库备份是强制前置条件。启动后查询 `flyway_schema_history`，确认 V87、V88、V89、V90、V91 均为 `success=true`；迁移失败时停止恢复流量并按回滚指南处理，不手工删除 Flyway 记录。

## 上线检查

1. `GET /api/health` 返回 HTTP 200、`status=UP`、`database=UP`，且 `release=20260912-full-optimization-v1`。
2. `/index.html`、`/mobile.html`、`/manager-mobile.html` 和带 `?v=20260912-full-optimization-v1` 的静态资源均返回 200。
3. 前台只显示技师队列和房间状态；房间卡片自动换行、内部滚动，房间/技师操作按钮高度至少 44px。
4. 店长可从房间和技师入口打开安排上钟流程，验证排钟、点钟、选钟、预定钟和加钟所需字段。
5. 技师端未打卡时显示打卡状态；自主上钟入口不存在，移动端 `/api/v1/mobile/technician/clock-in` 在有效会话下返回 403。
6. 抽查日报、订单营业日、退款营业日、历史补单权限和考勤记录；观察 WARN 日志与数据库锁等待。

详细验收项目见 `20260912-full-optimization-v1-verification.md`。
