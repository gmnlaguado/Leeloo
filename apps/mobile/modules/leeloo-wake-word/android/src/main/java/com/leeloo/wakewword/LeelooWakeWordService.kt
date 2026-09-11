package com.leeloo.wakewword

import android.app.*
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * ForegroundService that keeps the app process alive on Android
 * so the wake-word detector can continue processing audio
 * even when the app is in the background or killed by the system.
 *
 * The JS layer (wake-word.service.ts) controls start/stop via
 * LeelooWakeWordModule which calls startForegroundService / stopService.
 */
class LeelooWakeWordService : Service() {

    companion object {
        private const val TAG = "LeelooWakeWordService"
        private const val CHANNEL_ID = "leeloo_wake_word"
        private const val NOTIFICATION_ID = 1001
        const val ACTION_START = "com.leeloo.app.WAKE_WORD_START"
        const val ACTION_STOP  = "com.leeloo.app.WAKE_WORD_STOP"
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand: ${intent?.action}")
        when (intent?.action) {
            ACTION_STOP -> {
                stopForeground(true)
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                val notification = buildNotification()
                startForeground(NOTIFICATION_ID, notification)
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "Service destroyed")
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Leeloo Wake Word",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Leeloo is listening for wake word"
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            PendingIntent.FLAG_IMMUTABLE else PendingIntent.FLAG_UPDATE_CURRENT
        val pendingIntent = PendingIntent.getActivity(this, 0, openIntent, pendingFlags)

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Leeloo")
            .setContentText("Di \"Hey Leeloo\" para comenzar")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .build()
    }
}
