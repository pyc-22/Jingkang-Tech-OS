package com.jingkang.operations.technician;

import android.app.Notification;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class DispatchMonitorService extends Service {
    private static final String ACTION_START = "com.jingkang.operations.technician.START_MONITOR";
    static final String ACTION_PLAY_REMINDER = "com.jingkang.operations.technician.PLAY_SERVICE_REMINDER";
    private static final String EXTRA_TOKEN = "accessToken";
    static final String EXTRA_REMINDER_TYPE = "reminderType";
    static final String EXTRA_REMINDER_SESSION_ID = "reminderSessionId";
    static final String EXTRA_REMINDER_SERVICE_NAME = "reminderServiceName";
    static final String EXTRA_REMINDER_EXPECTED_END = "reminderExpectedEnd";
    private static final String API_URL = "https://tech.jkyygl.xyz/api/v1/mobile/technician/dispatch-notification";
    private static final String DASHBOARD_URL = "https://tech.jkyygl.xyz/api/v1/mobile/technician/me";
    private static final String PREFS = "dispatch-monitor";
    private static final String TOKEN_KEY = "access-token";
    private static final String MONITOR_CHANNEL = "technician_monitor";
    private static final String DISPATCH_CHANNEL = "technician_dispatch_alarm";
    private static final int MONITOR_NOTIFICATION_ID = 2101;
    private static final int DISPATCH_NOTIFICATION_ID = 2102;
    private static final String SCHEDULED_SESSION_KEY = "scheduled-reminder-session";
    private static final String SCHEDULED_END_KEY = "scheduled-reminder-end";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private String accessToken = "";
    private String activeDispatchId = "";
    private MediaPlayer alarmPlayer;
    private MediaPlayer reminderPlayer;
    private PowerManager.WakeLock wakeLock;
    private PowerManager.WakeLock monitorWakeLock;
    private AudioManager audioManager;
    private AlarmManager alarmManager;
    private AudioFocusRequest audioFocusRequest;
    private boolean audioFocusHeld;
    private final AudioManager.OnAudioFocusChangeListener audioFocusChangeListener = focusChange -> {
        if (focusChange == AudioManager.AUDIOFOCUS_GAIN && !activeDispatchId.isEmpty()) {
            handler.post(this::playAlarm);
        }
    };

    private final Runnable pollTask = new Runnable() {
        @Override
        public void run() {
            pollDispatch();
            handler.postDelayed(this, 5000);
        }
    };

    public static void start(Context context, String token) {
        Intent intent = new Intent(context, DispatchMonitorService.class)
            .setAction(ACTION_START)
            .putExtra(EXTRA_TOKEN, token);
        ContextCompat.startForegroundService(context, intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
        startForeground(MONITOR_NOTIFICATION_ID, monitorNotification());
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        alarmManager = (AlarmManager) getSystemService(ALARM_SERVICE);
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        monitorWakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "JingkangTechnician:ReminderMonitor");
        monitorWakeLock.setReferenceCounted(false);
        monitorWakeLock.acquire();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_PLAY_REMINDER.equals(intent.getAction())) {
            playExactReminder(intent);
        }
        String incomingToken = intent == null ? null : intent.getStringExtra(EXTRA_TOKEN);
        if (incomingToken != null && !incomingToken.isBlank()) {
            accessToken = incomingToken;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(TOKEN_KEY, accessToken).apply();
        } else {
            accessToken = getSharedPreferences(PREFS, MODE_PRIVATE).getString(TOKEN_KEY, "");
        }
        handler.removeCallbacks(pollTask);
        if (accessToken.isBlank()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        handler.post(pollTask);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(pollTask);
        stopAlarm();
        stopReminderPlayer();
        if (monitorWakeLock != null && monitorWakeLock.isHeld()) monitorWakeLock.release();
        monitorWakeLock = null;
        abandonAudioFocus();
        executor.shutdownNow();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void pollDispatch() {
        if (accessToken.isBlank()) return;
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(API_URL).openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setRequestProperty("Authorization", "Bearer " + accessToken);
                int status = connection.getResponseCode();
                if (status == 401) {
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(TOKEN_KEY).apply();
                    handler.post(this::stopSelf);
                    return;
                }
                if (status < 200 || status >= 300) return;
                StringBuilder body = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) body.append(line);
                }
                JSONObject dispatch = new JSONObject(body.toString()).optJSONObject("dispatch");
                if (dispatch == null) {
                    handler.post(this::stopAlarm);
                } else {
                    String dispatchId = dispatch.optString("serviceSessionId", dispatch.optString("id", "dispatch"));
                    String service = dispatch.optString("serviceNameSnapshot", "新服务项目");
                    String room = dispatch.optString("roomCode", "待确认房间");
                    int minutes = dispatch.optInt("plannedDurationMinutes", 0);
                    handler.post(() -> startAlarm(dispatchId, service, room, minutes));
                }
                pollServiceReminder();
            } catch (Exception ignored) {
                // Keep the current alarm active when a temporary network failure occurs.
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private void pollServiceReminder() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(DASHBOARD_URL).openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("Authorization", "Bearer " + accessToken);
            if (connection.getResponseCode() != 200) return;
            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }
            JSONObject active = new JSONObject(body.toString()).optJSONObject("activeSession");
            if (active == null || active.isNull("expectedEndAt")) {
                cancelScheduledServiceReminders();
                return;
            }
            long expectedEndAt;
            try {
                expectedEndAt = java.time.Instant.parse(active.optString("expectedEndAt")).toEpochMilli();
            } catch (Exception ignored) {
                return;
            }
            long remainingSeconds = (long) Math.ceil((expectedEndAt - System.currentTimeMillis()) / 1000.0);
            String sessionId = active.optString("id", "active");
            String service = active.optString("serviceNameSnapshot", "项目服务");
            scheduleExactServiceReminders(sessionId, service, expectedEndAt);
            String reminderId = null;
            int rawId = 0;
            String message = "";
            if (remainingSeconds <= 600 && remainingSeconds > 540) {
                reminderId = "ten-minutes";
                rawId = R.raw.service_reminder_ten_minutes;
                message = "距离项目服务还剩十分钟";
            } else if (remainingSeconds <= 300 && remainingSeconds > 240) {
                reminderId = "five-minutes";
                rawId = R.raw.service_reminder_five_minutes;
                message = "距离项目结束还剩五分钟";
            } else if (remainingSeconds <= 0) {
                reminderId = "finished";
                rawId = R.raw.service_reminder_finished;
                message = "项目服务已经结束，欢迎光临";
            }
            if (reminderId == null) return;
            String key = "reminder:" + sessionId + ":" + expectedEndAt + ":" + reminderId;
            SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
            if (preferences.getBoolean(key, false)) return;
            preferences.edit().putBoolean(key, true).apply();
            String finalMessage = message;
            int finalRawId = rawId;
            handler.post(() -> playServiceReminder(finalRawId, service, finalMessage));
        } catch (Exception ignored) {
            // Temporary network failures are retried by the next poll.
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void playExactReminder(Intent intent) {
        String type = intent.getStringExtra(EXTRA_REMINDER_TYPE);
        String sessionId = intent.getStringExtra(EXTRA_REMINDER_SESSION_ID);
        String service = intent.getStringExtra(EXTRA_REMINDER_SERVICE_NAME);
        long expectedEndAt = intent.getLongExtra(EXTRA_REMINDER_EXPECTED_END, 0L);
        if (type == null || sessionId == null || expectedEndAt <= 0L) return;
        int rawId = reminderRawId(type);
        String message = reminderMessage(type);
        if (rawId == 0 || message.isEmpty()) return;
        String key = reminderPreferenceKey(sessionId, expectedEndAt, type);
        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (preferences.getBoolean(key, false)) return;
        preferences.edit().putBoolean(key, true).apply();
        handler.post(() -> playServiceReminder(rawId, service == null ? "项目服务" : service, message));
    }

    private void scheduleExactServiceReminders(String sessionId, String service, long expectedEndAt) {
        if (alarmManager == null) alarmManager = (AlarmManager) getSystemService(ALARM_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) return;
        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        String scheduledSession = preferences.getString(SCHEDULED_SESSION_KEY, "");
        long scheduledEnd = preferences.getLong(SCHEDULED_END_KEY, 0L);
        if (sessionId.equals(scheduledSession) && expectedEndAt == scheduledEnd) return;
        cancelScheduledServiceReminders();
        scheduleExactReminder(sessionId, service, expectedEndAt, "ten-minutes", expectedEndAt - 10 * 60 * 1000L);
        scheduleExactReminder(sessionId, service, expectedEndAt, "five-minutes", expectedEndAt - 5 * 60 * 1000L);
        scheduleExactReminder(sessionId, service, expectedEndAt, "finished", expectedEndAt);
        preferences.edit()
            .putString(SCHEDULED_SESSION_KEY, sessionId)
            .putLong(SCHEDULED_END_KEY, expectedEndAt)
            .apply();
    }

    private void scheduleExactReminder(String sessionId, String service, long expectedEndAt, String type, long triggerAt) {
        if (triggerAt <= System.currentTimeMillis()) return;
        PendingIntent pendingIntent = reminderPendingIntent(sessionId, service, expectedEndAt, type);
        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
    }

    private void cancelScheduledServiceReminders() {
        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        String sessionId = preferences.getString(SCHEDULED_SESSION_KEY, "");
        long expectedEndAt = preferences.getLong(SCHEDULED_END_KEY, 0L);
        if (!sessionId.isEmpty() && alarmManager != null) {
            for (String type : new String[]{"ten-minutes", "five-minutes", "finished"}) {
                alarmManager.cancel(reminderPendingIntent(sessionId, "项目服务", expectedEndAt, type));
            }
        }
        preferences.edit().remove(SCHEDULED_SESSION_KEY).remove(SCHEDULED_END_KEY).apply();
    }

    private PendingIntent reminderPendingIntent(String sessionId, String service, long expectedEndAt, String type) {
        Intent intent = new Intent(this, ServiceReminderReceiver.class)
            .setData(Uri.parse("jingkang://service-reminder/" + Uri.encode(sessionId) + "/" + type))
            .putExtra(EXTRA_REMINDER_TYPE, type)
            .putExtra(EXTRA_REMINDER_SESSION_ID, sessionId)
            .putExtra(EXTRA_REMINDER_SERVICE_NAME, service)
            .putExtra(EXTRA_REMINDER_EXPECTED_END, expectedEndAt);
        int requestCode = (sessionId + ":" + type).hashCode() & 0x7fffffff;
        return PendingIntent.getBroadcast(this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private String reminderPreferenceKey(String sessionId, long expectedEndAt, String type) {
        return "reminder:" + sessionId + ":" + expectedEndAt + ":" + type;
    }

    private int reminderRawId(String type) {
        if ("ten-minutes".equals(type)) return R.raw.service_reminder_ten_minutes;
        if ("five-minutes".equals(type)) return R.raw.service_reminder_five_minutes;
        if ("finished".equals(type)) return R.raw.service_reminder_finished;
        return 0;
    }

    private String reminderMessage(String type) {
        if ("ten-minutes".equals(type)) return "距离项目服务还剩十分钟";
        if ("five-minutes".equals(type)) return "距离项目结束还剩五分钟";
        if ("finished".equals(type)) return "项目服务已经结束，欢迎光临";
        return "";
    }

    private void playServiceReminder(int rawId, String service, String message) {
        stopReminderPlayer();
        try (AssetFileDescriptor descriptor = getResources().openRawResourceFd(rawId)) {
            reminderPlayer = new MediaPlayer();
            reminderPlayer.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            reminderPlayer.setDataSource(descriptor.getFileDescriptor(), descriptor.getStartOffset(), descriptor.getLength());
            reminderPlayer.setOnCompletionListener(player -> stopReminderPlayer());
            reminderPlayer.prepare();
            requestAudioFocus();
            audioManager.setStreamVolume(AudioManager.STREAM_ALARM, audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
            reminderPlayer.setVolume(1.0f, 1.0f);
            reminderPlayer.start();
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.notify(2103, reminderNotification(service, message));
        } catch (Exception ignored) {
            stopReminderPlayer();
        }
    }

    private void stopReminderPlayer() {
        if (reminderPlayer != null) {
            if (reminderPlayer.isPlaying()) reminderPlayer.stop();
            reminderPlayer.release();
            reminderPlayer = null;
        }
        abandonAudioFocusIfIdle();
    }

    private void startAlarm(String dispatchId, String service, String room, int minutes) {
        if (!dispatchId.equals(activeDispatchId)) {
            activeDispatchId = dispatchId;
            acquireWakeLock();
            playAlarm();
        } else if (alarmPlayer != null && !alarmPlayer.isPlaying()) {
            playAlarm();
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(DISPATCH_NOTIFICATION_ID, dispatchNotification(service, room, minutes));
    }

    private void playAlarm() {
        if (alarmPlayer == null) {
            try (AssetFileDescriptor descriptor = getResources().openRawResourceFd(R.raw.technician_dispatch_alert)) {
                alarmPlayer = new MediaPlayer();
                alarmPlayer.setLooping(true);
                alarmPlayer.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
                alarmPlayer.setDataSource(descriptor.getFileDescriptor(), descriptor.getStartOffset(), descriptor.getLength());
                alarmPlayer.prepare();
            } catch (Exception error) {
                if (alarmPlayer != null) alarmPlayer.release();
                alarmPlayer = null;
            }
        }
        if (alarmPlayer != null && !alarmPlayer.isPlaying()) {
            requestAudioFocus();
            int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            audioManager.setStreamVolume(AudioManager.STREAM_ALARM, max, 0);
            alarmPlayer.setVolume(1.0f, 1.0f);
            alarmPlayer.start();
        }
    }

    private void stopAlarm() {
        activeDispatchId = "";
        if (alarmPlayer != null) {
            if (alarmPlayer.isPlaying()) alarmPlayer.stop();
            alarmPlayer.release();
            alarmPlayer = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.cancel(DISPATCH_NOTIFICATION_ID);
        abandonAudioFocusIfIdle();
    }

    private void requestAudioFocus() {
        if (audioManager == null) audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        int result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (audioFocusRequest == null) {
                audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                    .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build())
                    .setAcceptsDelayedFocusGain(false)
                    .setOnAudioFocusChangeListener(audioFocusChangeListener, handler)
                    .build();
            }
            result = audioManager.requestAudioFocus(audioFocusRequest);
        } else {
            result = audioManager.requestAudioFocus(
                audioFocusChangeListener,
                AudioManager.STREAM_ALARM,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE
            );
        }
        audioFocusHeld = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    private void abandonAudioFocusIfIdle() {
        boolean alarmActive = alarmPlayer != null && alarmPlayer.isPlaying();
        boolean reminderActive = reminderPlayer != null && reminderPlayer.isPlaying();
        if (!alarmActive && !reminderActive) abandonAudioFocus();
    }

    private void abandonAudioFocus() {
        if (!audioFocusHeld || audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        } else {
            audioManager.abandonAudioFocus(audioFocusChangeListener);
        }
        audioFocusHeld = false;
    }

    private Notification reminderNotification(String service, String message) {
        return new NotificationCompat.Builder(this, DISPATCH_CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(service)
            .setContentText(message)
            .setContentIntent(openAppIntent())
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setAutoCancel(true)
            .build();
    }

    private void acquireWakeLock() {
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (wakeLock == null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "JingkangTechnician:DispatchAlarm");
            wakeLock.setReferenceCounted(false);
        }
        if (!wakeLock.isHeld()) wakeLock.acquire(10 * 60 * 1000L);
    }

    private PendingIntent openAppIntent() {
        Intent intent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification monitorNotification() {
        return new NotificationCompat.Builder(this, MONITOR_CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("靖康技师端正在接收派单")
            .setContentText("保持运行可在锁屏时接收新服务提醒")
            .setContentIntent(openAppIntent())
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private Notification dispatchNotification(String service, String room, int minutes) {
        String detail = room + " · " + service + (minutes > 0 ? " · " + minutes + "分钟" : "");
        return new NotificationCompat.Builder(this, DISPATCH_CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("有新的派单，请立即确认")
            .setContentText(detail)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(detail))
            .setContentIntent(openAppIntent())
            .setFullScreenIntent(openAppIntent(), true)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .build();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel monitor = new NotificationChannel(MONITOR_CHANNEL, "派单接收服务", NotificationManager.IMPORTANCE_LOW);
        monitor.setDescription("保持技师端在后台接收派单");
        manager.createNotificationChannel(monitor);

        NotificationChannel dispatch = new NotificationChannel(DISPATCH_CHANNEL, "新派单强提醒", NotificationManager.IMPORTANCE_HIGH);
        dispatch.setDescription("新派单循环铃声和锁屏提醒");
        dispatch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        dispatch.enableVibration(true);
        dispatch.setSound(null, null);
        manager.createNotificationChannel(dispatch);
    }
}
