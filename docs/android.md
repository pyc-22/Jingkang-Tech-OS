# Android 应用

## 工程

| 应用 | 目录 | 应用 ID | 远程入口 |
|---|---|---|---|
| 技师端 | `apps/technician-android` | `com.jingkang.operations.technician` | `https://tech.jkyygl.xyz/mobile.html` |
| 店长端 | `apps/manager-android` | `com.jingkang.operations.manager` | `https://manager.jkyygl.xyz/manager-mobile.html` |

两个应用使用 Capacitor 7.6.8、JDK 21、Android SDK 35 和 Gradle Wrapper 8.11.1，只允许 HTTPS 且禁止混合内容。

## 构建

在对应应用目录执行：

```powershell
npm.cmd ci
npm.cmd run android:sync
npm.cmd run android:build:debug
```

Debug APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。根目录也提供 `android:technician:*` 与 `android:manager:*` 聚合命令。

## 原生能力

技师端包含派单监控前台服务、全屏通知、唤醒锁、精确闹钟及服务倒计时提醒接收器；需要在目标 Android 版本上实机验证通知和闹钟权限。店长端目前主要是远程 WebView 壳。

## 发布注意事项

下载页与 APK 的发布和排查步骤见 [Android 下载修复](android-downloads-fix.md)。APK 被 Git 忽略，仅部署 `git ls-files` 的清单会遗漏它们；发布包须显式携带两个下载文件并验证 HTTP 响应。

- 正式 APK/AAB 必须使用受保护的发布签名；keystore 不提交仓库。
- 远程域名和 `allowNavigation` 必须同步更新。
- 发布前验证登录、页面导航、后台/锁屏派单提醒、服务提醒、网络恢复及系统权限拒绝场景。
- APK/AAB 是构建产物，不作为权威源码提交。
