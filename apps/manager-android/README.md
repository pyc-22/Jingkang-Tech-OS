# 靖康店长端 Android

Capacitor Android 应用，加载正式店长端：

`https://manager.jkyygl.xyz/manager-mobile.html`

应用 ID：`com.jingkang.operations.manager`

## 环境与构建

- Node.js 22+
- JDK 21
- Android SDK 35

```powershell
npm.cmd ci
npm.cmd run android:sync
npm.cmd run android:build:debug
```

Debug APK：`android/app/build/outputs/apk/debug/app-debug.apk`

当前应用主要是远程 WebView 壳，仅允许 HTTPS，禁止明文 HTTP 和混合内容。发布前应验证登录、门店切换、报表、报销附件和网络恢复。