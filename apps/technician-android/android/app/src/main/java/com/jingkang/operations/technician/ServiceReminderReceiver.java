package com.jingkang.operations.technician;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

public class ServiceReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Intent serviceIntent = new Intent(context, DispatchMonitorService.class)
            .setAction(DispatchMonitorService.ACTION_PLAY_REMINDER)
            .putExtra(DispatchMonitorService.EXTRA_REMINDER_TYPE, intent.getStringExtra(DispatchMonitorService.EXTRA_REMINDER_TYPE))
            .putExtra(DispatchMonitorService.EXTRA_REMINDER_SESSION_ID, intent.getStringExtra(DispatchMonitorService.EXTRA_REMINDER_SESSION_ID))
            .putExtra(DispatchMonitorService.EXTRA_REMINDER_SERVICE_NAME, intent.getStringExtra(DispatchMonitorService.EXTRA_REMINDER_SERVICE_NAME))
            .putExtra(DispatchMonitorService.EXTRA_REMINDER_EXPECTED_END, intent.getLongExtra(DispatchMonitorService.EXTRA_REMINDER_EXPECTED_END, 0L));
        ContextCompat.startForegroundService(context, serviceIntent);
    }
}
