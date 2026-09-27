package com.quickmodel.mobile

import android.app.Activity
import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ExecutorService

/** Foreground, short turns only: record -> ASR -> chat -> TTS, with explicit stop. */
class VoiceController(private val activity: Activity, private val pool: ExecutorService,
    private val request: (String, String, JSONObject) -> Pair<Int, String>,
    private val event: (JSONObject) -> Unit) {
    private var recorder: MediaRecorder? = null
    private var player: MediaPlayer? = null
    private val handler = Handler(Looper.getMainLooper())
    private var generation = 0
    private var destroyed = false
    private val recording = File(activity.cacheDir, "voice-input.m4a")
    private val output = File(activity.cacheDir, "voice-output.wav")
    private val limit = Runnable { stop(true) }

    fun start() {
        if (destroyed) return
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 42)
            event(JSONObject().put("status", "permission").put("message", "请允许麦克风权限，再点语音开始")); return
        }
        if (recorder != null) return
        silence()
        try {
            @Suppress("DEPRECATION") val r = MediaRecorder()
            recorder = r
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioSamplingRate(16000); r.setAudioEncodingBitRate(64000)
            r.setOutputFile(recording.absolutePath)
            r.prepare(); r.start()
            handler.postDelayed(limit, 60000)
            event(JSONObject().put("status", "recording"))
        } catch (_: Exception) { stop(false); event(JSONObject().put("error", "录音启动失败，请检查麦克风权限")) }
    }

    fun stop(send: Boolean) {
        handler.removeCallbacks(limit)
        val r = recorder ?: return
        recorder = null
        var valid = true
        try { r.stop() } catch (_: Exception) { valid = false } finally { r.release() }
        if (!send || !valid) { recording.delete(); event(JSONObject().put("status", "idle")); return }
        val bytes = recording.readBytes(); recording.delete()
        val ticket = ++generation
        event(JSONObject().put("status", "transcribing"))
        pool.execute {
            val result = try {
                val (status, body) = request("POST", "/voice/asr", JSONObject().put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)))
                if (status !in 200..299) throw IllegalStateException()
                JSONObject(body).put("status", "ready")
            } catch (_: Exception) { JSONObject().put("error", "语音识别失败，请重试或输入文字") }
            activity.runOnUiThread { if (!destroyed && generation == ticket) event(result) }
        }
    }

    fun speak(text: String) {
        silence(); if (recorder != null || destroyed) return
        val ticket = generation
        event(JSONObject().put("status", "synthesizing"))
        pool.execute {
            val bytes = try {
                val (status, body) = request("POST", "/voice/tts", JSONObject().put("text", text.take(600)))
                if (status !in 200..299) throw IllegalStateException()
                Base64.decode(JSONObject(body).getString("audio"), Base64.DEFAULT)
            } catch (_: Exception) { null }
            activity.runOnUiThread {
                if (destroyed || generation != ticket) return@runOnUiThread
                if (bytes == null) { event(JSONObject().put("error", "语音合成失败，仍可阅读文字回复")); return@runOnUiThread }
                try {
                    output.writeBytes(bytes)
                    val p = MediaPlayer(); player = p
                    p.setDataSource(output.absolutePath)
                    p.setOnCompletionListener { silence(); event(JSONObject().put("status", "idle")) }
                    p.setOnErrorListener { _, _, _ -> silence(); event(JSONObject().put("error", "音频播放失败")); true }
                    p.prepare(); p.start(); event(JSONObject().put("status", "playing"))
                } catch (_: Exception) { silence(); event(JSONObject().put("error", "音频播放失败")) }
            }
        }
    }

    fun silence() { generation++; player?.release(); player = null; output.delete() }
    fun pause() { stop(false); silence(); event(JSONObject().put("status", "idle")) }
    fun destroy() { destroyed = true; pause(); recording.delete() }
}
