# 技师端与店长端权限整改部署说明

## 版本范围

本版本只调整移动端前端权限和安排上钟入口：

- 技师端移除自主上钟入口和对应前端写请求，保留接单、拒绝、休息、下钟、日报、服务记录、请假和提成等功能。`POST /api/v1/mobile/technician/clock-in` 完成当前技师移动会话校验后固定返回 `403 Forbidden`；该路径不创建或更新服务记录、不更新房间状态，也不写入自主上钟审计记录。
- 店长端增加安排技师上钟流程，复用前台的即时上钟和预约接口，支持排钟、点钟、选钟、预定排钟、预定点钟、房间、项目、技师和多技师业绩分配。
- 店长首页展示房间实时状态、技师实时状态、轮钟位置和房间/技师两个安排入口。
- 即使当前没有空闲技师，只要存在符合预约资格的技师，仍可打开安排上钟弹窗登记预定排钟或预定点钟；即时派钟继续要求空闲技师。
- 店长可从正在服务的房间明细进入加钟流程，复用前台加钟接口和服务时长上限规则；多技师服务按每位当前服务技师分别选择归属，打开弹窗时刷新进行中会话，避免使用过期缓存。
- 本版本仅收紧 `TechnicianMobileController` 的技师移动端自主上钟端点，未修改数据库迁移或生产配置。部署包中的 JAR 由干净基线源码叠加本次 `TechnicianMobileController.java` 补丁后，在 JDK 21 上独立构建；该 JAR 不等同于工作树中可能含其他任务改动的 `target` JAR。

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
- `technician-service-worker.js`
- `assets/jingkang-login-background.png`
- `assets/jingkang-login-city-grid.png`
- `assets/service-reminder-finished.mp3`
- `assets/service-reminder-five-minutes.mp3`
- `assets/service-reminder-ten-minutes.mp3`
- `assets/technician-dispatch-alert.mp3`

后端文件为 `services/massage-api/target/massage-api-0.1.0.jar`。它从干净基线源码仅叠加本次 `TechnicianMobileController.java` 补丁后，以 JDK 21 独立执行 `clean package -DskipTests` 生成；最终 SHA-256 以包内 `SHA256SUMS.txt` 为准。部署包不纳入工作树当前可能含其他任务改动的 JAR。当前工作树的 API 测试已单独执行并通过 `89/89`；隔离基线测试夹具与工作树历史日报改动不一致，因此不把隔离目录的测试结果计入本版本回归结论。

本次发布产物：JAR SHA-256 为 `82F014032427B660138F52B527B590A217B28CE395FA40755C71B67E79565F1B`；ZIP SHA-256 以交付时的 `Get-FileHash` 输出为准。

## 部署步骤

1. 备份当前静态目录和正在运行的 JAR，记录备份时间及文件哈希。
2. 停止应用服务或切换到维护窗口。
3. 将 ZIP 中 `apps/massage-console/` 下的文件覆盖到现有前端静态目录，保留目录结构。
4. 使用包内经 JDK 21 独立构建、并由 `SHA256SUMS.txt` 标注哈希的 JAR 替换线上对应 JAR；本版本不包含数据库迁移。不要使用工作树的 `target` JAR，也不要覆盖外部配置文件、环境变量或数据库目录。
5. 按现有服务方式启动应用，检查健康端点和静态页面 HTTP 状态均为 200。
6. 清理浏览器缓存或确认店长移动端 HTML 中的 `v=20260909-manager-dispatch-clock-v3` 资源版本已生效。
7. 使用店长账号验证安排上钟入口，使用技师账号确认只能接收派钟，完成下方冒烟检查。

## 冒烟检查

- 店长首页显示房间和技师实时状态。
- 从房间卡片和空闲技师卡片都能打开“安排上钟”。
- 即时排钟/点钟/选钟提交到 `/api/v1/service-sessions/clock-in`。
- 预定排钟/预定点钟提交到 `/api/v1/service-reservations`，预定单限制单技师。
- 多技师业绩比例总和必须为 100%，提交后看板刷新。
- 正在服务的房间明细可选择允许加钟的项目，按技师加钟上限和门店总时长上限过滤，并提交到 `/api/v1/service-sessions/{sessionId}/extensions`。
- 多技师服务为每位 `IN_SERVICE` 技师提供独立加钟入口；弹窗加载和提交失败会提示并清理旧会话状态，登录失效会回到登录页。
- 技师端看不到自主上钟按钮、菜单或弹窗，只能处理前台/店长派单。
- 使用有效技师移动会话请求 `POST /api/v1/mobile/technician/clock-in` 返回 `403`；请求前后均不新增或变更服务记录、房间状态和自主上钟审计记录。
- 技师端接单、拒绝、休息、下钟、日报、服务记录和请假入口可用。
- 技师端登录背景、提示音、倒计时音效和 Service Worker 请求均返回 200。

## 版本核验

构建机器使用 JDK 21。部署前可执行：

```powershell
Get-FileHash services/massage-api/target/massage-api-0.1.0.jar -Algorithm SHA256
Get-Content SHA256SUMS.txt
```

再与包内记录对比，确认静态文件、运行时资源和由干净基线加控制器补丁构建的 JAR 来自同一 ZIP。
