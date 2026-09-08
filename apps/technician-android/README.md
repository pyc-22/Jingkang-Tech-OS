# 靖康技师端 Android

Capacitor Android 应用，加载正式技师端：

`https://tech.jkyygl.xyz/mobile.html`

应用 ID：`com.jingkang.operations.technician`

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

## 原生能力

技师端包含派单监控前台服务、派单全屏通知与提示音、唤醒锁、精确闹钟和服务结束前提醒。应用仅允许 HTTPS，禁止明文 HTTP 和混合内容。通知、全屏提醒与精确闹钟权限必须在目标 Android 版本上实机验证。