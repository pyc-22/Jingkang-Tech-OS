# 技师端与店长端权限整改回归报告

## 结论

在 JDK 21.0.12.1、Node.js 22 环境下，前端回归、API 单元测试和 API 打包均通过。浏览器夹具烟测确认店长首页、房间入口、技师入口、安排上钟对话框和多技师分配控件可用。

## 已执行检查

| 检查 | 命令/证据 | 结果 |
| --- | --- | --- |
| 前端回归 | `npm run test:console` | 130/130 通过 |
| 店长/技师定向回归 | `node --test apps/massage-console/tests/manager-dispatch-clock-regression.test.js apps/massage-console/tests/manager-live-room-regression.test.js apps/massage-console/tests/technician-clock-duration-regression.test.js` | 19/19 通过 |
| API 回归 | `$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot'; npm.cmd run test:api` | 89/89 通过 |
| API 构建 | `$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot'; npm.cmd run build:api` | BUILD SUCCESS |
| JavaScript 语法 | `node --check apps/massage-console/manager-mobile.js`、`node --check apps/massage-console/mobile.js` | 通过 |
| 补丁格式 | `git diff --check` | 通过 |
| 静态资源 | 本地 `python -m http.server` 请求两份 HTML、CSS/JS、Service Worker、`offline-sync.js` 和 `assets/` 6 个资源 | 14/14 HTTP `200`；两份 HTML 的 14 项本地引用全部存在 |
| 店长页面烟测 | 本地合成 API 夹具 + 浏览器 AX 快照 | 首页、房间/技师入口、对话框、5 种钟类和技师列表可见 |
| 部署包 | `deploy/manager-technician-refactor-20260909.zip` | 包含完整前端运行时资源、3 份整改文档和 `SHA256SUMS.txt`；ZIP SHA-256 以交付时的 `Get-FileHash` 输出为准，清单校验 0 个不一致 |
| JAR 核验 | 干净基线源码 + `TechnicianMobileController.java` 补丁，JDK 21 独立 `clean package -DskipTests` | 编译和 Spring Boot 重打包成功；包内 JAR SHA-256 `82F014032427B660138F52B527B590A217B28CE395FA40755C71B67E79565F1B`，仅包含本次控制器补丁，工作树当前 JAR 未纳入。隔离基线测试夹具与工作树历史日报改动不一致，未将隔离测试失败计入本轮 API 回归 |

## 技师端验收

- `mobile.js` 不再包含自主上钟弹窗、入口或 `/mobile/technician/clock-in` 调用。
- 页面显示“等待前台或店长安排上钟”提示，待接单、接单确认、拒绝、休息、下钟、日报、服务记录、请假和提成区域仍保留。
- `POST /api/v1/mobile/technician/clock-in` 先校验当前技师移动会话，再固定返回 `403 Forbidden`；代码路径不创建服务记录、不更新房间状态、不写入自主上钟审计记录。
- 前台/店长派钟后，服务时长仍由服务项目默认值或派钟提交的 `plannedDurationMinutes` 决定，既有被动接单状态机保持不变。

## 店长端验收

- 店长首页显示实时房间、床位、项目、技师、钟类、计时和轮钟位置。
- 房间卡片和空闲技师卡片均提供安排上钟入口。
- 当所有技师都在服务中但仍具备预约资格时，安排上钟弹窗仍可打开；切换预定排钟或预定点钟后可选择忙碌技师，实时派钟仍只展示空闲技师。
- 正在服务的房间服务明细为每位 `IN_SERVICE` 技师提供加钟入口，按前台相同的剩余时长规则过滤项目并提交；打开弹窗前重新读取进行中会话。
- 即时流程使用 `/api/v1/service-sessions/clock-in`，请求包含 `technicianId`、`participants`、`roomId`、`serviceItemId`、`plannedDurationMinutes`、`clockType`。
- 预约流程使用 `/api/v1/service-reservations`，请求包含 `technicianId`、`roomId`、`serviceItemId`、`plannedDurationMinutes`、`reservationType`，并限制单技师。
- 多技师业绩分配以基点提交，前端阻止小于等于 0 或合计不等于 10000 的请求。
- 加钟弹窗提交、关闭、切店和登录失效路径均清理旧会话/技师状态，网络或权限异常显示可操作提示。
- 既有营业、提成、费用、跨门店、日报和订单管理页面未重写，仅复用现有加载和权限机制。

## 环境说明

本轮使用 Node.js 22 和 JDK 21.0.12.101 执行前端测试、店长/技师定向测试、当前工作树 API 测试及 API 构建；前端 130 项、定向 19 项、API 89 项通过，工作树构建输出 `BUILD SUCCESS`。发布 JAR 另从 `HEAD` 干净基线仅叠加控制器补丁，在隔离目录执行 `clean package -DskipTests`，编译和重打包成功；该隔离基线的测试夹具缺少工作树历史日报改动，故未把其测试阶段作为发布依据。默认 JDK 17 仅作为本机未切换环境时的运行时差异，不作为本轮验证命令。

## 未覆盖项

本次未连接生产数据库执行真实账号登录和真实业务写入。生产发布前应在维护窗口按部署说明完成一笔店长即时派钟和一笔预约派钟，并由技师账号确认接单、拒绝和下钟闭环。
