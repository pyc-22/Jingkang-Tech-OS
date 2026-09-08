# 生产部署

## 拓扑

正式环境只开放 HTTPS。Nginx 的 80 端口跳转 443；443 将页面转发到 `127.0.0.1:5174`，将 `/api/` 转发到 `127.0.0.1:8080`。PostgreSQL、Node 和 Java 端口不得直接暴露公网。

## 依赖与构建

服务器需要 Node.js 22、JDK 21、PostgreSQL 16、Nginx 和有效证书。

```powershell
npm.cmd ci
services\massage-api\mvnw.cmd -f services\massage-api\pom.xml clean package
```

Maven Wrapper 首次运行会从 Maven Central 下载 Maven 3.9.16。生产构建应保存依赖缓存或在受控构建机完成。

## 配置

以 `deploy/.env.production.example` 为模板配置服务环境。必须替换数据库密码、域名和证书路径，并把 `MASSAGE_EXPENSE_STORAGE_DIR` 指向构建目录之外的绝对持久化路径。真实秘密不得写入源码或日志。

`deploy/start-production.ps1` 是首次验证入口：

```powershell
.\deploy\start-production.ps1 `
  -DatabasePassword '从秘密管理器读取' `
  -ExpenseStorageDir 'D:\JingkangData\expense-attachments'
```

长期运行应将 Java API 和 Node 静态服务注册为 Windows 服务，设置工作目录、环境变量、失败重启和日志轮转。

## Nginx

复制 `deploy/nginx/massage-platform.conf`，替换 `STORE_SYSTEM_DOMAIN` 和证书路径，然后执行 `nginx -t` 再重载。模板限制上传请求为 12 MB，并保留真实来源和 HTTPS 协议信息。

## 上线验证

1. `/api/health` 返回 HTTP 200，应用与数据库状态正常。
2. 三端入口和静态资源通过 HTTPS 加载，无混合内容。
3. 管理账号仅能访问授权门店，技师账号仅能访问本人数据。
4. 完成一次派单、接单、服务、结算和会员扣款闭环。
5. 上传报销凭证，重启 API 后仍可读取。
6. 执行 PostgreSQL 备份，并在独立数据库恢复验证。

## 回滚与备份

发布前保存当前 JAR、静态文件、数据库备份和迁移版本。数据库迁移只能向前追加，不要编辑已执行脚本。应用回滚若跨越数据库迁移，必须先确认旧版本与新结构兼容；不兼容时使用经过演练的数据库恢复方案。附件目录和数据库必须在同一恢复点成对备份。