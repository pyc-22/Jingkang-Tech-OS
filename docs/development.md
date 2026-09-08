# 本地开发

## 前置条件

安装 Node.js 22、JDK 21 和 PostgreSQL 16。Maven 由 `services/massage-api/mvnw.cmd` 下载和固定，无需系统 Maven。

## 数据库与 API

创建本地数据库和专用账号，然后设置：

```powershell
$env:MASSAGE_DB_URL = 'jdbc:postgresql://127.0.0.1:5432/massage_platform'
$env:MASSAGE_DB_USER = 'massage_app'
$env:MASSAGE_DB_PASSWORD = '本地密码'
$env:MASSAGE_EXPENSE_STORAGE_DIR = 'D:\massage-data\expense-attachments'
services\massage-api\mvnw.cmd -f services\massage-api\pom.xml spring-boot:run
```

API 默认监听 `0.0.0.0:8080`，启动时由 Flyway 执行迁移。不要修改或重编号已发布迁移；当前序列为 V1–V88，V86 空号保留。

## Web

根包无第三方运行依赖。启动静态服务和 API 代理：

```powershell
npm.cmd install
npm.cmd start
```

默认端口为 5174。可通过 `MASSAGE_ADDRESS`、`MASSAGE_PORT`、`MASSAGE_API_HOST` 和 `MASSAGE_API_PORT` 覆盖。生产环境应把两个服务都绑定到 `127.0.0.1`。

## Android

两个工程分别维护锁文件，不使用 npm workspace。进入对应目录执行 `npm.cmd ci` 后再同步或构建；详见 [Android](android.md)。

## 配置原则

真实数据库密码、证书、签名密钥和附件不得提交。运行数据放在仓库外的持久化目录；示例变量见 `deploy/.env.production.example`。