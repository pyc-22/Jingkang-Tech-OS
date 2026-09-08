# 靖康按摩门店运营平台

按摩门店运营平台，包含前台工作台、技师端、店长端、Spring Boot API 与两个 Android 应用。仓库中的权威 Web 源码位于 `apps/massage-console/`；历史发布包和数据库备份不是源码。

## 模块

- `apps/massage-console/`：前台、技师 Web、店长 Web、PWA 资源和前端回归测试。
- `services/massage-api/`：Java 21 / Spring Boot API、Flyway 迁移和测试。
- `apps/technician-android/`：技师 Capacitor/Android 应用。
- `apps/manager-android/`：店长 Capacitor/Android 应用。
- `deploy/`：部署模板、启动脚本及历史制品边界说明。
- `tools/`：打印、发布、内容和维护工具。
- `docs/`：架构、开发、测试、部署、Android、数据保留和功能清单。

## 支持环境

- Node.js 22+
- JDK 21
- PostgreSQL 16
- Android SDK 35（构建 Android 应用时）
- Nginx（生产反向代理）

## 快速开始

```powershell
npm.cmd install
npm.cmd start
```

Web 默认监听 `http://localhost:5174`，并将 `/api/` 代理到 `127.0.0.1:8080`。API 需要可用的 PostgreSQL 和 `MASSAGE_DB_PASSWORD`：

```powershell
$env:MASSAGE_DB_PASSWORD = '本地数据库密码'
services\massage-api\mvnw.cmd -f services\massage-api\pom.xml spring-boot:run
```

入口：前台 `/index.html`、技师端 `/mobile.html`、店长端 `/manager-mobile.html`。

## 常用命令

```powershell
npm.cmd run test:console
npm.cmd run test:api
npm.cmd test
npm.cmd run build:api
npm.cmd run android:technician:sync
npm.cmd run android:technician:debug
npm.cmd run android:manager:sync
npm.cmd run android:manager:debug
```

详细说明见 [开发](docs/development.md)、[测试](docs/testing.md)、[部署](docs/deployment.md)、[Android](docs/android.md) 和 [数据与制品](docs/data-and-retention.md)。