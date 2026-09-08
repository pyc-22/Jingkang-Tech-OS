package com.jingkang.operations.technician;

import android.Manifest;
import android.app.AlarmManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.appcompat.app.AlertDialog;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String NATIVE_ALERT_KEY = "jingkang-native-dispatch-enabled";
    private static final String INSTALL_NATIVE_TOGGLE_SCRIPT =
        "(() => {" +
        "const button=document.querySelector('#enable-dispatch-sound');" +
        "if(!button||button.dataset.nativeToggleInstalled==='1')return;" +
        "button.dataset.nativeToggleInstalled='1';" +
        "const render=()=>{const enabled=localStorage.getItem('" + NATIVE_ALERT_KEY + "')==='1';" +
        "button.textContent=enabled?'派单强提醒已开启':'开启派单强提醒';" +
        "button.classList.toggle('enabled',enabled);};" +
        "button.addEventListener('click',event=>{" +
        "const enabled=localStorage.getItem('" + NATIVE_ALERT_KEY + "')==='1';" +
        "localStorage.setItem('" + NATIVE_ALERT_KEY + "',enabled?'0':'1');" +
        "render();" +
        "if(enabled){event.preventDefault();event.stopImmediatePropagation();}" +
        "},true);render();" +
        "})()";
    private static final String STATE_SCRIPT =
        "JSON.stringify({token:localStorage.getItem('chengxin-mobile-access-token')||''," +
        "enabled:localStorage.getItem('" + NATIVE_ALERT_KEY + "')==='1'})";
    private final Handler tokenHandler = new Handler(Looper.getMainLooper());
    private boolean exactAlarmPromptShown;
    private final Runnable tokenSync = new Runnable() {
        @Override
        public void run() {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().evaluateJavascript(INSTALL_NATIVE_TOGGLE_SCRIPT, ignored -> {});
                bridge.getWebView().evaluateJavascript(STATE_SCRIPT, value -> {
                    NativeAlertState state = decodeState(value);
                    if (state.token.isEmpty() || !state.enabled) {
                        stopService(new Intent(MainActivity.this, DispatchMonitorService.class));
                    } else {
                        DispatchMonitorService.start(MainActivity.this, state.token);
                    }
                });
            }
            tokenHandler.postDelayed(this, 3000);
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1001);
        }
        tokenHandler.postDelayed(this::requestExactAlarmPermission, 1200);
    }

    @Override
    public void onResume() {
        super.onResume();
        tokenHandler.removeCallbacks(tokenSync);
        tokenHandler.post(tokenSync);
    }

    @Override
    public void onPause() {
        super.onPause();
        tokenHandler.removeCallbacks(tokenSync);
    }

    private void requestExactAlarmPermission() {
        if (exactAlarmPromptShown || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        AlarmManager alarmManager = (AlarmManager) getSystemService(ALARM_SERVICE);
        if (alarmManager.canScheduleExactAlarms()) return;
        exactAlarmPromptShown = true;
        new AlertDialog.Builder(this)
            .setTitle("开启精准报钟")
            .setMessage("授权后，项目结束前10分钟、5分钟和结束时会像系统闹钟一样在后台和息屏状态准时提醒。")
            .setNegativeButton("稍后", null)
            .setPositiveButton("去授权", (dialog, which) -> {
                Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                    .setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            })
            .show();
    }

    private NativeAlertState decodeState(String value) {
        if (value == null || "null".equals(value) || "\"\"".equals(value)) return new NativeAlertState("", false);
        try {
            String json = value;
            if (json.startsWith("\"") && json.endsWith("\"")) {
                json = json.substring(1, json.length() - 1)
                    .replace("\\\"", "\"")
                    .replace("\\\\", "\\");
            }
            JSONObject state = new JSONObject(json);
            return new NativeAlertState(state.optString("token", ""), state.optBoolean("enabled", false));
        } catch (Exception ignored) {
            return new NativeAlertState("", false);
        }
    }

    private static class NativeAlertState {
        final String token;
        final boolean enabled;

        NativeAlertState(String token, boolean enabled) {
            this.token = token;
            this.enabled = enabled;
        }
    }
}
