# 系统架构

## 组件

- **按摩 Web 控制台**：`apps/massage-console/` 中的原生 HTML/CSS/JavaScript，包含前台、技师端和店长端。
- **静态服务与代理**：根目录 `server.massage.js` 提供静态文件，并把同源 `/api/` 请求代理到 Java API。
- **业务 API**：`services/massage-api/`，使用 Spring MVC、Validation、JDBC/JdbcClient、Flyway 和 PostgreSQL。
- **Android 应用**：两个 Capacitor 工程加载各自 HTTPS 移动页面；技师端另有原生派单监控与服务提醒。
- **生产入口**：Nginx 终止 HTTPS，向 `127.0.0.1:5174` 转发页面，向 `127.0.0.1:8080` 转发 `/api/`。

## 数据流

```text
浏览器 / Android WebView
        |
      HTTPS
        v
      Nginx
       |  \
       |   +--> Spring Boot :8080 --> PostgreSQL 16
       +------> Node :5174 ---------> 静态文件

Spring Boot --> 外部持久化附件目录
```

浏览器只访问同域 `/api/`，数据库和内部端口不应暴露到公网。管理端和技师端使用不同会话；后端按角色和门店范围执行权限校验。

## 持久化边界

PostgreSQL 保存业务数据和 Flyway 历史；`MASSAGE_EXPENSE_STORAGE_DIR` 保存报销附件。二者必须独立备份。`target/`、Android `build/`、APK、ZIP 和 `deploy/releases/` 均是可再生成或历史制品，不是权威源码。

## 业务边界

主要领域包括门店与权限、房间床位、技师队列和排班、服务会话与派单、会员钱包、订单结算与退款、提成、日报、报销、打印、审计和安全告警。完整入口见 [功能清单](feature-inventory.md)。