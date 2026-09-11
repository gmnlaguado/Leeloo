package com.leeloo.wakewword

import android.app.*
import android.content.Intent
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlin.math.sqrt

/**
 * ForegroundService con dos capas de detección:
 *
 * 1. Energy gate (AudioRecord nativo): captura audio en background y detecta
 *    cuando hay energía vocal significativa (posible wake word).
 *
 * 2. Cuando la energía supera el umbral durante varios frames consecutivos,
 *    muestra notificación interactiva "¿Hey Leeloo? Toca para hablar".
 *    Tocar la notificación abre la app directamente al modo escucha.
 *
 * Esto funciona incluso con la app cerrada en Android porque el proceso
 * queda vivo gracias al ForegroundService con tipo "microphone".
 */
class LeelooWakeWordService : Service() {

    companion object {
        private const val TAG = "LeelooWakeWordService"
        private const val CHANNEL_PERSISTENT = "leeloo_wake_word"
        private const val CHANNEL_ALERT      = "leeloo_wake_alert"
        private const val NOTIF_PERSISTENT   = 1001
        private const val NOTIF_ALERT        = 1002

        const val ACTION_START = "com.leeloo.app.WAKE_WORD_START"
        const val ACTION_STOP  = "com.leeloo.app.WAKE_WORD_STOP"

        // Audio config
        private const val SAMPLE_RATE      = 16000
        private const val BUFFER_MULT      = 4
        // Energy gate: RMS threshold (0-32768 range for 16-bit PCM)
        private const val ENERGY_THRESHOLD = 800.0
        // Frames consecutivos con energía para disparar alerta
        private const val SPEECH_FRAMES_TRIGGER = 6
        // Frames de silencio para resetear el contador
        private const val SILENCE_FRAMES_RESET  = 10
        // Cooldown entre alertas (ms) para no molestar
        private const val ALERT_COOLDOWN_MS     = 8000L
    }

    private var audioRecord: AudioRecord? = null
    private var recordingThread: Thread?  = null
    @Volatile private var isRecording = false
    private var lastAlertTime = 0L

    // ─────────────────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand: ${intent?.action}")
        when (intent?.action) {
            ACTION_STOP -> {
                stopAudio()
                stopForeground(true)
                stopSelf()
                LeelooWakeWordServiceState.isRunning = false
                return START_NOT_STICKY
            }
            else -> {
                startForeground(NOTIF_PERSISTENT, buildPersistentNotification())
                LeelooWakeWordServiceState.isRunning = true
                startAudio()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopAudio()
        LeelooWakeWordServiceState.isRunning = false
        super.onDestroy()
        Log.d(TAG, "Service destroyed")
    }

    // ─── Audio recording ──────────────────────────────────────────────────────

    private fun startAudio() {
        if (isRecording) return
        val minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuf <= 0) {
            Log.e(TAG, "AudioRecord not supported (minBuf=$minBuf)")
            return
        }
        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                minBuf * BUFFER_MULT,
            )
            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "AudioRecord failed to initialize")
                audioRecord = null
                return
            }
            isRecording = true
            audioRecord!!.startRecording()
            recordingThread = Thread({ processAudio(minBuf) }, "LeelooEarsThread")
            recordingThread!!.start()
            Log.d(TAG, "Audio recording started (sampleRate=$SAMPLE_RATE, buf=${minBuf * BUFFER_MULT})")
        } catch (e: SecurityException) {
            Log.e(TAG, "RECORD_AUDIO permission missing: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "startAudio failed: ${e.message}")
        }
    }

    private fun stopAudio() {
        isRecording = false
        try {
            audioRecord?.stop()
            audioRecord?.release()
        } catch (_: Exception) {}
        audioRecord = null
        recordingThread?.interrupt()
        recordingThread = null
        Log.d(TAG, "Audio recording stopped")
    }

    private fun processAudio(bufferSize: Int) {
        val buf = ShortArray(bufferSize)
        var speechFrames  = 0
        var silenceFrames = 0

        while (isRecording) {
            val read = audioRecord?.read(buf, 0, bufferSize) ?: -1
            if (read <= 0) continue

            val rms = rmsEnergy(buf, read)

            if (rms > ENERGY_THRESHOLD) {
                silenceFrames = 0
                speechFrames++
                if (speechFrames >= SPEECH_FRAMES_TRIGGER) {
                    val now = System.currentTimeMillis()
                    if (now - lastAlertTime > ALERT_COOLDOWN_MS) {
                        lastAlertTime = now
                        showWakeAlert()
                    }
                    speechFrames = 0
                }
            } else {
                silenceFrames++
                if (silenceFrames >= SILENCE_FRAMES_RESET) {
                    speechFrames  = 0
                    silenceFrames = 0
                }
            }
        }
    }

    private fun rmsEnergy(buf: ShortArray, length: Int): Double {
        var sum = 0.0
        for (i in 0 until length) {
            val s = buf[i].toDouble()
            sum += s * s
        }
        return sqrt(sum / length)
    }

    // ─── Notifications ────────────────────────────────────────────────────────

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)

        // Persistent low-priority channel
        nm.createNotificationChannel(
            NotificationChannel(
                CHANNEL_PERSISTENT,
                "Leeloo — Modo espera",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Leeloo está esperando tu voz"
                setShowBadge(false)
            },
        )

        // Alert channel (default importance for heads-up)
        nm.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ALERT,
                "Leeloo — Activación",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Alerta de wake word"
                enableVibration(true)
                setShowBadge(true)
            },
        )
    }

    private fun buildPersistentNotification(): Notification {
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingFlags = pendingIntentFlags()
        val pendingIntent = PendingIntent.getActivity(this, 0, openIntent, pendingFlags)

        return NotificationCompat.Builder(this, CHANNEL_PERSISTENT)
            .setContentTitle("Leeloo está escuchando")
            .setContentText("Di \"Hey Leeloo\" para activarme")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .build()
    }

    private fun showWakeAlert() {
        // Deep-link intent: opens app at leeloo://voice
        val voiceIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            data = android.net.Uri.parse("leeloo://voice")
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pendingFlags = pendingIntentFlags()
        val voicePending = PendingIntent.getActivity(this, NOTIF_ALERT, voiceIntent, pendingFlags)

        val notification = NotificationCompat.Builder(this, CHANNEL_ALERT)
            .setContentTitle("¿Hey Leeloo?")
            .setContentText("Toca para hablar ahora →")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(voicePending)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .build()

        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIF_ALERT, notification)
        Log.d(TAG, "Wake alert shown (rms exceeded threshold)")
    }

    private fun pendingIntentFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        else
            PendingIntent.FLAG_UPDATE_CURRENT
}

object LeelooWakeWordServiceState {
    @Volatile var isRunning: Boolean = false
}
