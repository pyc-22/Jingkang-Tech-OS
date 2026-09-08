# 测试与验证

## 自动化测试

从仓库根目录执行：

```powershell
npm.cmd run test:console
npm.cmd run test:api
npm.cmd test
services\massage-api\mvnw.cmd -f services\massage-api\pom.xml clean verify
```

前端测试位于 `apps/massage-console/tests/`，使用 Node.js 内置 `node:test`。API 测试位于 `services/massage-api/src/test/`。当前 API 测试主要是单元和回归测试，不能替代真实 PostgreSQL 上的 Flyway、约束和事务集成验证。

## Android

两个工程分别执行：

```powershell
npm.cmd ci
npm.cmd run android:sync
npm.cmd run android:build:debug
```

需要设备测试时，在 Android Studio 或连接的模拟器/设备上执行 instrumentation test，并验证实际应用 ID。

## 浏览器烟测

同时启动 API 与 `npm start`，至少检查：

1. `/index.html` 显示前台登录入口。
2. `/mobile.html` 显示技师登录入口。
3. `/manager-mobile.html` 显示店长登录入口。
4. 静态脚本、样式、图片、音频和 manifest 无 404。
5. 使用测试账号走通登录、派单、接单、开始服务、结算及报表关键路径。
6. 检查浏览器控制台和失败网络请求。

API 缺少数据库时应记录启动日志中的 PostgreSQL 连接失败，不应把它误判为前端启动失败。

## 发布前检查

- `git diff --check`
- Markdown 相对链接可解析。
- `git check-ignore` 确认源码和 Wrapper 未被忽略，构建目录和制品已忽略。
- Nginx 可用时运行 `nginx -t`。
- 在独立数据库恢复一次备份，并确认附件备份可读取。