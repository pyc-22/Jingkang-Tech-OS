# 技师端与店长端权限整改回归报告

## 结论

在 JDK 21.0.12.1、Node.js 22 环境下，前端回归、API 单元测试和 API 打包均通过。浏览器夹具烟测确认店长首页、房间入口、技师入口、安排上钟对话框和多技师分配控件可用。

## 已执行检查

| 检查 | 命令/证据 | 结果 |
| --- | --- | --- |
| 前端回归 | `npm run test:console` | 124/124 通过 |
| API 回归 | `JAVA_HOME=JDK21 npm run test:api` | 89/89 通过 |
| API 构建 | `JAVA_HOME=JDK21 npm run build:api` | BUILD SUCCESS |
| JavaScript 语法 | `node --check apps/massage-console/manager-mobile.js`、`node --check apps/massage-console/mobile.js` | 通过 |
| 补丁格式 | `git diff --check` | 通过 |
| 静态资源 | 本地静态服务请求 `manager-mobile.html`、`mobile.html` | 均返回 200 |
| 店长页面烟测 | 本地合成 API 夹具 + 浏览器 AX 快照 | 首页、房间/技师入口、对话框、5 种钟类和技师列表可见 |
| 部署包 | `deploy/manager-technician-refactor-20260909.zip` | 以发布前 `Get-FileHash` 输出为准 |
| JAR 核验 | `services/massage-api/target/massage-api-0.1.0.jar` | SHA-256 `46E77EF00DE903B748B93EBA2A3A92F129C53FE62EBD05E90D6D27BC6C02C2D5` |

## 技师端验收

- `mobile.js` 不再包含自主上钟弹窗、入口或 `/mobile/technician/clock-in` 调用。
- 页面显示“等待前台或店长安排上钟”提示，待接单、接单确认、拒绝、休息、下钟、日报、服务记录、请假和提成区域仍保留。
- 原有 TechnicianMobileController 的服务时长仍由服务项目默认值决定，未改变服务端状态机。

## 店长端验收

- 店长首页显示实时房间、床位、项目、技师、钟类、计时和轮钟位置。
- 房间卡片和空闲技师卡片均提供安排上钟入口。
- 即时流程使用 `/api/v1/service-sessions/clock-in`，请求包含 `technicianId`、`participants`、`roomId`、`serviceItemId`、`plannedDurationMinutes`、`clockType`。
- 预约流程使用 `/api/v1/service-reservations`，请求包含 `technicianId`、`roomId`、`serviceItemId`、`plannedDurationMinutes`、`reservationType`，并限制单技师。
- 多技师业绩分配以基点提交，前端阻止小于等于 0 或合计不等于 10000 的请求。
- 既有营业、提成、费用、跨门店、日报和订单管理页面未重写，仅复用现有加载和权限机制。

## 环境说明

直接执行 `npm test` 时，前端 124 项通过；API 阶段因默认 JDK 17 读取 Java 21 测试类而停止。切换到本机已安装的 JDK 21 后，API 89 项和完整 `clean package` 均成功。该差异属于运行环境版本，不是源码测试失败。

## 未覆盖项

本次未连接生产数据库执行真实账号登录和真实业务写入。生产发布前应在维护窗口按部署说明完成一笔店长即时派钟和一笔预约派钟，并由技师账号确认接单、拒绝和下钟闭环。
