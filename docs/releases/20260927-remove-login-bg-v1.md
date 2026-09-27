# 20260927-remove-login-bg-v1：移除登录背景图

## 范围与依赖

`login-portal.css` 是前台、技师端和店长端共用的登录样式。本版将背景改为纯色，删除原 1,449,506 字节的 `assets/jingkang-login-background.png`；三个 HTML 入口同步更新该 CSS 版本。技师端同时更新 Service Worker 缓存版本，避免离线缓存保留旧样式。业务 API、数据库和店长端 JS 均未改。

本版前端包包含上一版 P0 前端代码。如果 `20260927-perf-polling-v1` 尚未部署，应同时部署该版后端 JAR：`ServiceSessionController` 新增可选 `businessDate` 查询参数，前台据此仅读取当日已完成服务。旧 JAR 会忽略该参数并返回全部已完成服务，削弱 P0 降载效果。本次背景图提交本身没有 Java 改动，也没有 P2 索引改动。

## 文件与部署根目录

本版包是现有完整静态目录的覆盖包，不用于初始化空目录。仓库 `server.massage.js` 将静态根目录固定为该脚本所在目录下的 `apps/massage-console`，端口号不改变该根目录。按当前提供的前台位置，如果 5174、5175、5176 都运行 `C:\wwwroot\jkingkang-platform\server.massage.js`，以下文件全部覆盖到 `C:\wwwroot\jkingkang-platform\apps\massage-console\`：

| 文件 | 页面 |
| --- | --- |
| `index.html`、`app.js`、`styles.css`、`offline-sync.js`、`login-portal.css` | 前台 |
| `mobile.html`、`mobile.js`、`technician-service-worker.js` | 技师端；共用 `login-portal.css`、`offline-sync.js` |
| `manager-mobile.html` | 店长端；共用 `login-portal.css`；`manager-mobile.js` 未修改 |

`C:\wwwroot\tech.jkyygl.xyz` 只有 `.well-known` 时，不要将覆盖包复制到那里并期待页面变化。部署前在服务器只读检查：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5174,5175,5176 | ForEach-Object {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
  [pscustomobject]@{ Port = $_.LocalPort; ProcessId = $_.OwningProcess; CommandLine = $process.CommandLine }
}
```

确认 5175、5176 对应 Node 进程运行的脚本位置；若脚本位于其他项目根目录，按其 `apps\massage-console` 静态根目录另行覆盖。还应核对实际脚本是否采用仓库中的固定根目录实现。Node 静态服务逐请求读取文件，本版无需因静态文件改动重启 Node；若同时部署 P0 后端 JAR，需要重启 `JingkangMassageApi`（8080）。生产营业时段不直接覆盖。

覆盖前备份上述文件及静态根目录中的 `assets\jingkang-login-background.png`；覆盖并验证新 CSS 后，删除静态根目录中的这张旧图片。覆盖包没有图片文件，单纯解压不会自动删除服务器上的旧副本。

## 版本号变更

| 引用位置 / 资源 | 旧 `?v=` | 新 `?v=` |
| --- | --- | --- |
| `index.html` / `login-portal.css` | `20260915-next-optimization-v5` | `20260927-remove-login-bg-v1` |
| `mobile.html` / `login-portal.css` | `20260915-next-optimization-v5` | `20260927-remove-login-bg-v1` |
| `manager-mobile.html` / `login-portal.css` | `20260915-next-optimization-v5` | `20260927-remove-login-bg-v1` |
| `mobile.html` / `mobile.js` | `20260927-perf-polling-v1` | `20260927-remove-login-bg-v1` |
| `mobile.js` / `technician-service-worker.js` | `20260927-perf-polling-v1` | `20260927-remove-login-bg-v1` |

技师 Service Worker 缓存名及其预缓存的 `mobile.html`、`mobile.js`、`login-portal.css` 同步更新。`app.js`、`offline-sync.js`、`styles.css`、`manager-mobile.js` 等未修改资源的引用版本保持原值。

## 验证与回退

1. 无痕打开三个入口。Network 确认 `login-portal.css?v=20260927-remove-login-bg-v1` 均为 200，技师端 `mobile.js` 和 Service Worker 也为新版本；不再出现 `jingkang-login-background.png` 请求。确认登录页可见、登录和房间/派单流程正常。
2. 技师端 DevTools → Application → Service Workers，确认新 Service Worker 已激活；若旧标签页仍受控，关闭旧标签后在无痕窗口重验。
3. 恢复部署前备份的三个 HTML、`login-portal.css`、`mobile.js`、`technician-service-worker.js` 和被删除的图片；如果一同回退 P0，则连同 `app.js`、`offline-sync.js`、`styles.css`、后端 JAR 及 HTML 内版本号一起回退，并重启 `JingkangMassageApi`。

源码里另一张大图 `assets/jingkang-login-city-grid.png` 为 1,109,378 字节，当前页面没有引用，本次保持不变。
