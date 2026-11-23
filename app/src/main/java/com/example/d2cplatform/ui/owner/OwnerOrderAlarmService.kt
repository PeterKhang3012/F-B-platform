package com.example.d2cplatform.ui.owner

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Keeps the kitchen alarm playing after the owner backgrounds the screen. */
class OwnerOrderAlarmService : Service() {
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private var player: MediaPlayer? = null
    private var started = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (started) return START_NOT_STICKY
        val url = intent?.getStringExtra("url")
        val token = intent?.getStringExtra("token")
        if (url == null || token.isNullOrBlank()) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        started = true
        startForeground(42, notification())
        playAlarm()
        val api = OwnerApi(url).apply { this.token = token }
        worker.scheduleWithFixedDelay({
            try {
                val orders = api.request("/owner/dashboard").getJSONArray("orders")
                val pending = (0 until orders.length()).any {
                    orders.getJSONObject(it).optString("status") == "PENDING"
                }
                if (!pending) stopSelf()
            } catch (error: OwnerApiError) {
                if (error.status == 401) stopSelf()
            } catch (_: java.io.IOException) {
                // Retain the alarm during a transient connection failure.
            }
        }, 0, 3, TimeUnit.SECONDS)
        return START_NOT_STICKY
    }

    private fun playAlarm() {
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ?: return
        val media = MediaPlayer()
        player = media
        try {
            media.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
            media.setDataSource(this, uri)
            media.isLooping = true
            media.setOnPreparedListener { it.start() }
            media.setOnErrorListener { failed, _, _ ->
                failed.release()
                if (player === failed) player = null
                true
            }
            media.prepareAsync()
        } catch (_: java.io.IOException) {
            media.release()
            player = null
        }
    }

    private fun notification(): Notification {
        val channel = "owner_order_alarm"
        val builder = if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(channel, "Chuông đơn mới", NotificationManager.IMPORTANCE_LOW),
            )
            Notification.Builder(this, channel)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val open = Intent(this, OwnerActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return builder.setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Quán có đơn mới")
            .setContentText("Mở màn hình Chủ quán để xử lý đơn.")
            .setOngoing(true)
            .apply {
                setContentIntent(
                    PendingIntent.getActivity(this@OwnerOrderAlarmService, 0, open, PendingIntent.FLAG_IMMUTABLE),
                )
            }.build()
    }

    override fun onDestroy() {
        worker.shutdownNow()
        player?.release()
        player = null
        super.onDestroy()
    }
}
