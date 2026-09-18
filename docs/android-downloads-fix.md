# Android 下载修复：20260918-android-downloads-v1

## 排查结论

2026-09-18 对线上地址执行 HEAD 和 GET：下载页为 200，技师 APK 和店长 APK 均为 404，响应正文为 `Not found`。页面的两个相对链接和文件名正确。本地两个 APK 存在；Node 静态服务已有 APK MIME 类型与 `Content-Disposition: attachment`。

最近的全量发布脚本仅收集 Git 跟踪文件，而 APK 是忽略的构建产物。旧包没有 APK，原部署说明要求保留服务器上的安装包。本次修复让新打包流程显式包含两个 APK，缺失或为空时立即终止。线上可确定的是下载 URL 未找到文件；实际服务器磁盘内容及当前生效的 Nginx 配置尚待服务器核对。

## 修复范围

- 下载页保留原生同源链接，显式指定下载文件名，并更新查询版本避免旧缓存。
- 静态服务返回文件长度，保留 APK MIME 类型、附件响应头和 `no-store`。
- Nginx 模板新增 `location ^~ /downloads/`，保留原 URI 转发到 Node，避免通用静态扩展名规则抢占，并关闭该路径代理缓存与过期缓存。
- 两个 APK 不重新构建或改签；技师端版本仍为 1.0.2，店长端仍为 1.0.0。
- 不改 Java API、数据库或业务逻辑。APK 仅进入发布制品，不提交到 Git。

普通同源 `<a>` 下载不需要 CORS；不新增通配跨域策略。代理保留 Node 返回的 `application/vnd.android.package-archive` 和 `Content-Disposition`，不重复叠加附件头。若现网直接使用 Nginx `root/alias` 提供 APK，应选择下述代理方案，或另行配置静态目录的 APK MIME 和附件头，不混用两个方案。

## 打包

先用 Android SDK 的 `apksigner verify --verbose` 验证两个待发布 APK，并用 `aapt dump badging` 核对包名和版本，然后运行：

```powershell
.\tools\release\package-android-downloads.ps1
```

输出 `.artifacts/releases/20260918-android-downloads-v1.zip`，包含下载页、CSS、两个 APK、静态服务脚本、Nginx 模板、本说明与 `SHA256SUMS.txt`。同名输出已存在时终止，避免覆盖已验收制品。

## Windows 服务器部署

1. 解压到独立暂存目录，核对 `SHA256SUMS.txt`，备份现有下载目录、静态服务脚本和生效的 Nginx 配置。
2. 将包内 `apps/massage-console/downloads/` 的四个文件复制到实际 Node 项目目录下同一路径，例如 `C:\wwwroot\jingkang-platform\apps\massage-console\downloads\`。不要删除其他静态文件或覆盖数据库、环境配置。
3. 将 `server.massage.js` 复制到该项目根目录，通过现有服务管理方式重启 Node 静态服务。Java API 和数据库无需重启。
4. 在 `console.jkyygl.xyz` 的实际 HTTPS `server` 块中合并模板里的 `/downloads/` location；保留现有域名、证书及安全配置，不用占位模板整体替换线上配置。确认上游端口与现网 Node 端口一致。
5. 在实际 Nginx 工作目录运行 `nginx.exe -t`，成功后才运行 `nginx.exe -s reload`。若使用自定义 `-p/-c`，两条命令都带上相同参数。清理 CDN 中 `/downloads/` 的旧缓存（若有）。

## 验收

先在服务器请求本机上游，再请求公网。两个文件都检查，不以页面 200 代替 APK 验证：

```powershell
curl.exe -I http://127.0.0.1:5174/downloads/jingkang-technician.apk
curl.exe -I http://127.0.0.1:5174/downloads/jingkang-manager.apk
curl.exe -I https://console.jkyygl.xyz/downloads/jingkang-technician.apk
curl.exe -I https://console.jkyygl.xyz/downloads/jingkang-manager.apk
```

预期均为 `200`，`Content-Type: application/vnd.android.package-archive`，`Content-Disposition: attachment; filename="对应文件名.apk"`，`Content-Length` 等于文件大小。上游 404 先检查实际项目目录和两个文件；仅公网 404 则检查生效的 Nginx 路由及 CDN 缓存。

在 Android Chrome/系统浏览器打开 `https://console.jkyygl.xyz/downloads/index.html`，分别点击两个下载按钮，核对完成后的文件大小和 SHA256。安装时核对应用名，验证启动及登录。微信等内置浏览器若拦截 APK，请在系统浏览器完成此验收。现有安装的覆盖升级还需确认签名一致。

回滚时恢复备份的下载文件、静态服务和 Nginx 配置，检查配置后重启/重载对应服务；不涉及数据回滚。

## 本次本地验证结果

- Java 21 下 `npm.cmd test`：前端 176 项、后端 167 项通过，无失败或跳过。新增 9 项下载及打包回归，打包测试使用临时目录，不依赖未提交的真实 APK。
- Nginx 1.28.0：使用模板替换本机端口和临时证书后 `nginx -t` 通过；加入竞争的 APK 正则路由后，`/downloads/` 仍正确走代理，GET/HEAD 响应头与缺失文件 404 均正常。
- Playwright + Chrome：Pixel 7 移动端模拟和 1280×800 桌面视口，两个按钮均触发下载，文件名及 SHA256 正确；已检查截图，无横向溢出。
- Android SDK 35 `apksigner verify --verbose`：两个 APK 的 v1/v2 签名均通过；`aapt dump badging` 核对应用 ID、1.0.2/1.0.0 版本，最低 Android API 23。
- 技师端：4,410,370 字节，SHA256 `e355a0976d5e166f6fec7ab5421e3da9837ed1ac3402bac0a53f50e4fa99e8e5`。
- 店长端：3,150,497 字节，SHA256 `18b59868d27b2213de3365f85df855089c89ec4afb2486dd2f1c3762cf8131e3`。

本次未连接服务器执行部署；未连接 Android 真机，浏览器模拟与签名校验不等于实机安装、覆盖升级验收。上述服务器步骤完成后仍需实机验证。
