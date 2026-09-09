# 技师端与店长端权限整改部署说明

## 版本范围

本版本只调整移动端前端权限和安排上钟入口：

- 技师端移除自主上钟入口和对应前端写请求，保留接单、拒绝、休息、下钟、日报、服务记录、请假和提成等功能。
- 店长端增加安排技师上钟流程，复用前台的即时上钟和预约接口，支持排钟、点钟、选钟、预定排钟、预定点钟、房间、项目、技师和多技师业绩分配。
- 店长首页展示房间实时状态、技师实时状态、轮钟位置和房间/技师两个安排入口。
- 后端业务代码、数据库迁移和生产配置未因本版本变更；部署包中的 JAR 为当前源码构建产物，便于版本一致性校验。

## 文件清单

前端文件位于 `apps/massage-console/`，部署时保持同一目录层级：

- `manager-mobile.html`
- `manager-mobile.js`
- `manager-mobile.css`
- `mobile.html`
- `mobile.js`
- `mobile.css`
- `mobile-clock.css`
- `mobile-extension.css`
- `mobile-dispatch-alert.css`
- `mobile-auth.css`
- `mobile-app.css`
- `login-portal.css`
- `offline-sync.css`
- `offline-sync.js`
- `technician.webmanifest`

后端文件为 `services/massage-api/target/massage-api-0.1.0.jar`。

## 部署步骤

1. 备份当前静态目录和正在运行的 JAR，记录备份时间及文件哈希。
2. 停止应用服务或切换到维护窗口。
3. 将 ZIP 中 `apps/massage-console/` 下的文件覆盖到现有前端静态目录，保留目录结构。
4. 用 ZIP 中的 `services/massage-api/target/massage-api-0.1.0.jar` 替换对应服务 JAR；不要覆盖外部配置文件、环境变量或数据库目录。
5. 按现有服务方式启动应用，检查健康端点和静态页面 HTTP 状态均为 200。
6. 清理浏览器缓存或确认 HTML 中的 `v=20260909` 资源版本已生效。
7. 使用店长账号验证安排上钟入口，使用技师账号确认只能接收派钟，完成下方冒烟检查。

## 冒烟检查

- 店长首页显示房间和技师实时状态。
- 从房间卡片和空闲技师卡片都能打开“安排上钟”。
- 即时排钟/点钟/选钟提交到 `/api/v1/service-sessions/clock-in`。
- 预定排钟/预定点钟提交到 `/api/v1/service-reservations`，预定单限制单技师。
- 多技师业绩比例总和必须为 100%，提交后看板刷新。
- 技师端看不到自主上钟按钮、菜单或弹窗，只能处理前台/店长派单。
- 技师端接单、拒绝、休息、下钟、日报、服务记录和请假入口可用。

## 版本核验

构建机器使用 JDK 21。部署前可执行：

```powershell
Get-FileHash services/massage-api/target/massage-api-0.1.0.jar -Algorithm SHA256
```

再与发布记录中的 SHA-256 对比，确认静态文件来自同一 ZIP。
