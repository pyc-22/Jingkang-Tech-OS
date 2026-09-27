# 20260927-perf-polling-v1：P0 轮询优化

## 改动范围

- 前台（5174）：运营状态每 30 秒刷新，上一轮未完成不叠加；隐藏页暂停、恢复可见立即刷新。前台不再轮询无参 `service-sessions` 全量列表；当日已完成次数通过原接口的可选 `businessDate` 参数读取，不阻塞房间首屏。
- 技师端（5175）：派单通知每 12 秒检查，防叠加且隐藏页暂停。`/mobile/technician/me` 登录后缓存在内存中；该接口还承载服务与打卡状态，因此仅在可见页每 30 秒、回到页面、派单变化或本人操作后刷新，不再随 12 秒派单轮询重复拉取。当日明细、业绩、请假记录进入对应页面时再加载。
- 共用 `offline-sync.js`：隐藏页暂停定时同步，离开页面清理定时器。
- 后端（8080）：原 `GET /api/v1/service-sessions` 增加可选 `businessDate` 参数；接口路径和返回结构不变，数据库表结构不变。
- 店长端（5176）：无改动。

## 发布文件与步骤

先备份所有目标文件，包括两个 HTML 入口及其资源版本号。发布包内文件对应位置如下：

| 包内路径 | 覆盖位置 |
| --- | --- |
| `apps/massage-console/index.html`、`app.js`、`styles.css`、`offline-sync.js` | 前台 5174 站点根目录 |
| `apps/massage-console/mobile.html`、`mobile.js`、`offline-sync.js`、`technician-service-worker.js` | 技师端 5175 站点根目录 |
| `services/massage-api/target/massage-api-0.1.0.jar` | `JingkangMassageApi` 服务使用的后端 JAR 位置 |

覆盖前按 Nginx/Node 配置核实前台真实站点根目录：此前记录同时出现 `jingkang-platform` 和 `jkingkang-platform` 两种拼写。后端 JAR 与两套前端应作为同一版本协调发布。覆盖 JAR 后重启 `JingkangMassageApi`（8080）；Node 静态服务 5174、5175 按当前逐请求读取文件的配置无需重启。店长端 5176 无需覆盖或重启。生产营业期间不执行本次覆盖。

## 版本号变更

| HTML / 资源 | 旧 `?v=` | 新 `?v=` |
| --- | --- | --- |
| `index.html` / `app.js` | `20260926-auth-hardening-v1` | `20260927-perf-polling-v1` |
| `index.html` / `offline-sync.js` | `20260915-next-optimization-v5` | `20260927-perf-polling-v1` |
| `mobile.html` / `mobile.js` | `20260916-quality-batch2-v9` | `20260927-perf-polling-v1` |
| `mobile.html` / `offline-sync.js` | `20260915-next-optimization-v5` | `20260927-perf-polling-v1` |
| `mobile.js` / `technician-service-worker.js` | `20260916-quality-batch2-v9` | `20260927-perf-polling-v1` |

`styles.css` 等未修改的 CSS 保持原版本号。技师端 Service Worker 的缓存名已更新，未修改的 CSS 继续使用旧资源版本。

## 部署后验证

1. 无痕窗口打开 `https://console.jkyygl.xyz/index.html`。F12 → Network 确认 `app.js` 与 `offline-sync.js` 均加载新版本、没有红色请求；登录后房间和技师卡片正常渲染。前台轮询期间不应出现无参 `GET /api/v1/service-sessions`。
2. 清空 Network 后静置前台 1 分钟，按同样口径与基线 88 请求 / 5.3 MB 对比；目标不超过 60 请求、2 MB。慢响应期间确认前一轮未完成不启动下一轮；后台标签页新增周期请求为 0，恢复可见后刷新一次。
3. 无痕窗口打开 `https://tech.jkyygl.xyz/mobile.html`。确认 `mobile.js` 与 `offline-sync.js` 为新版本；工作台 `/mobile/technician/me` 约每 30 秒刷新一次，派单通知约每 12 秒一次，业绩接口不周期调用。验证确认接单、开始服务、下钟。
4. 验证房间状态、技师队列、派单、结算、会员查询。记录请求数、传输量、DOMContentLoaded 和首屏数据渲染时间。生产接口耗时目标仍需现场实测；本包没有数据库索引改动。

## 回退

同时恢复两套前端的全部备份文件，特别是 HTML 内旧 `?v=` 引用，以及后端旧 JAR；重启 `JingkangMassageApi`。用无痕窗口确认 Network 已加载旧版本。不要只回退 JS 而保留新 HTML，或只回退 HTML 而保留新 JS。
