package com.quickmodel.mobile

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.Looper
import android.os.IBinder
import java.io.File

/** One authorized session, one delayed screenshot. No continuous screen uploads. */
class ScreenCaptureService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var projection: MediaProjection? = null
    private var reader: ImageReader? = null
    private var display: VirtualDisplay? = null
    private var finished = false
    private var latestImage: android.media.Image? = null
    override fun onBind(intent: Intent?): IBinder? = null

    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, ScreenCaptureService::class.java).setAction("stop"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, "capture").setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("QuickModel 截屏").setContentText(text).setContentIntent(open)
            .setOngoing(true).addAction(Notification.Action.Builder(null, "取消截屏", stop).build()).build()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") { finish("已取消截屏"); return START_NOT_STICKY }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("capture", "屏幕截图", NotificationManager.IMPORTANCE_LOW))
        if (android.os.Build.VERSION.SDK_INT >= 29) startForeground(301, notification("5 秒后截取一次；完成后返回应用预览"), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        else startForeground(301, notification("5 秒后截取一次；完成后返回应用预览"))
        try {
            @Suppress("DEPRECATION") val data = intent?.getParcelableExtra<Intent>("data") ?: throw IllegalArgumentException()
            val code = intent.getIntExtra("code", Activity.RESULT_CANCELED)
            projection = getSystemService(MediaProjectionManager::class.java).getMediaProjection(code, data)
            projection!!.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() { if (!finished) finish("屏幕共享已停止") }
            }, handler)
            val metrics = resources.displayMetrics
            // Smaller capture reduces memory; protected windows remain protected by Android.
            val scale = minOf(1.0, 1600.0 / maxOf(metrics.widthPixels, metrics.heightPixels))
            val w = maxOf(1, (metrics.widthPixels * scale).toInt())
            val h = maxOf(1, (metrics.heightPixels * scale).toInt())
            reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 3)
            reader!!.setOnImageAvailableListener({ source ->
                val image = source.acquireLatestImage() ?: return@setOnImageAvailableListener
                latestImage?.close(); latestImage = image
            }, handler)
            display = projection!!.createVirtualDisplay("QuickModel one-shot", w, h, metrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader!!.surface, null, handler)
            handler.postDelayed({
                if (!finished) {
                    try {
                        val image = latestImage ?: throw IllegalStateException()
                        val plane = image.planes[0]
                        val paddedWidth = w + (plane.rowStride - plane.pixelStride * w) / plane.pixelStride
                        val bitmap = Bitmap.createBitmap(paddedWidth, h, Bitmap.Config.ARGB_8888)
                        bitmap.copyPixelsFromBuffer(plane.buffer)
                        val cropped = Bitmap.createBitmap(bitmap, 0, 0, w, h)
                        File(cacheDir, "screen-ready.jpg").outputStream().use { cropped.compress(Bitmap.CompressFormat.JPEG, 85, it) }
                        if (cropped !== bitmap) cropped.recycle(); bitmap.recycle()
                        finish(null)
                    } catch (_: Exception) { finish("截图失败，请重新授权或使用系统截图上传") }
                }
            }, 5000)
            handler.postDelayed({ if (!finished) finish("截图超时，请重试或使用系统截图上传") }, 15000)
        } catch (_: Exception) { finish("无法开始截屏，请重新授权") }
        return START_NOT_STICKY
    }

    private fun finish(error: String?) {
        if (finished) return
        finished = true
        if (error != null) File(cacheDir, "screen-error.txt").writeText(error)
        handler.removeCallbacksAndMessages(null)
        display?.release(); display = null
        latestImage?.close(); latestImage = null
        reader?.close(); reader = null
        projection?.stop(); projection = null
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
    override fun onDestroy() { if (!finished) finish("截屏已中断"); super.onDestroy() }
}
