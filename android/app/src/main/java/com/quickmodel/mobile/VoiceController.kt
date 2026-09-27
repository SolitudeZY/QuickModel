package com.quickmodel.mobile

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.media.*
import android.media.audiofx.AcousticEchoCanceler
import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.util.ArrayDeque
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.sqrt

/** Mic stays active on the visible call page; PCM playback can be interrupted. */
class VoiceController(private val activity: Activity, private val pool: ExecutorService,
    private val request: (String, String, JSONObject) -> Pair<Int, String>,
    private val stream: (String, String, (ByteArray) -> Boolean) -> Unit,
    private val event: (JSONObject) -> Unit) {
    private val playback = Executors.newSingleThreadExecutor()
    private val playTicket = AtomicInteger()
    private val callGeneration = AtomicInteger()
    @Volatile private var active = false
    @Volatile private var requested = false
    @Volatile private var waitingPermission = false
    @Volatile private var destroyed = false
    @Volatile private var awaitingTranscript = false
    @Volatile private var manual = false
    @Volatile private var listeningUser = false
    @Volatile private var playing = false
    @Volatile private var modelRunning = false
    @Volatile private var turn = ""
    @Volatile private var audioTrack: AudioTrack? = null
    @Volatile private var connection: HttpURLConnection? = null
    private var capture: AudioRecord? = null
    private var echo: AcousticEchoCanceler? = null
    private var monitor: Thread? = null
    private val audioManager = activity.getSystemService(AudioManager::class.java)
    private var priorAudioMode = AudioManager.MODE_NORMAL
    private var priorSpeakerphone = false
    private var audioModeChanged = false
    private var pendingSegments = 0

    private fun emit(status: String, message: String = "") = activity.runOnUiThread {
        if (!destroyed) event(JSONObject().put("status", status).also { if (message.isNotEmpty()) it.put("message", message) })
    }
    fun attach(conn: HttpURLConnection?) { connection = conn }

    fun startCall() {
        if (active || destroyed) return
        requested = true
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            waitingPermission = true
            activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 42)
            emit("permission", "请允许麦克风权限，通话会自动开始")
            return
        }
        try {
            val min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            require(min > 0)
            val record = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 16000,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min * 2, 4096))
            require(record.state == AudioRecord.STATE_INITIALIZED)
            capture = record
            if (AcousticEchoCanceler.isAvailable()) echo = AcousticEchoCanceler.create(record.audioSessionId)?.apply { enabled = true }
            priorAudioMode = audioManager.mode
            @Suppress("DEPRECATION")
            priorSpeakerphone = audioManager.isSpeakerphoneOn
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioModeChanged = true
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = true
            active = true
            callGeneration.incrementAndGet()
            record.startRecording()
            monitor = Thread({ monitorLoop(record) }, "QuickModel voice monitor").apply { isDaemon = true; start() }
            emit("listening")
        } catch (_: Exception) { endCall(); emit("error", "麦克风启动失败，请检查通话权限") }
    }

    fun onPermissionResult(granted: Boolean) {
        waitingPermission = false
        if (!requested) return
        if (granted) startCall() else emit("error", "麦克风权限未获授权")
    }

    fun setTurn(id: String) {
        stopPlayback()
        turn = id; modelRunning = true
        emit("thinking")
    }
    fun turnFinished(id: String) {
        if (turn != id) return
        modelRunning = false
        synchronized(this) { if (pendingSegments == 0 && !listeningUser && !awaitingTranscript) emit("listening") }
    }

    fun say(id: String, text: String) {
        if (!active || id != turn || text.isBlank() || text.length > 220) return
        val ticket = playTicket.get()
        synchronized(this) { if (pendingSegments >= 64) return; pendingSegments++ }
        playback.execute {
            var localTrack: AudioTrack? = null
            var writtenFrames = 0L
            try {
                if (!active || ticket != playTicket.get() || id != turn) return@execute
                emit("synthesizing")
                stream("/voice/tts-stream", text) { pcm ->
                    if (!active || ticket != playTicket.get() || id != turn) return@stream false
                    if (localTrack == null) {
                        val min = AudioTrack.getMinBufferSize(24000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
                        require(min > 0)
                        localTrack = AudioTrack.Builder().setAudioAttributes(AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                            .setAudioFormat(AudioFormat.Builder().setSampleRate(24000).setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                            .setBufferSizeInBytes(maxOf(min * 2, 8192)).setTransferMode(AudioTrack.MODE_STREAM).build()
                        audioTrack = localTrack
                        localTrack!!.play(); playing = true
                        emit("speaking")
                    }
                    try {
                        var offset = 0
                        while (offset < pcm.size && active && ticket == playTicket.get()) {
                            val accepted = localTrack!!.write(pcm, offset, pcm.size - offset, AudioTrack.WRITE_BLOCKING)
                            if (accepted <= 0) return@stream false
                            offset += accepted; writtenFrames += accepted / 2
                        }
                        offset == pcm.size
                    } catch (_: Exception) { false }
                }
                if (localTrack != null && active && ticket == playTicket.get()) {
                    val remaining = maxOf(0L, writtenFrames - localTrack!!.playbackHeadPosition.toLong())
                    var wait = minOf(5000L, remaining * 1000 / 24000)
                    while (wait > 0 && active && ticket == playTicket.get()) {
                        val step = minOf(50L, wait)
                        Thread.sleep(step); wait -= step
                    }
                }
            } catch (_: Exception) { if (ticket == playTicket.get()) { stopPlayback(); emit("error", "语音播放中断，可继续文字对话") } }
            finally {
                if (localTrack != null) try { localTrack!!.pause(); localTrack!!.flush(); localTrack!!.release() } catch (_: Exception) {}
                if (audioTrack === localTrack) audioTrack = null
                if (ticket == playTicket.get()) {
                    playing = false
                    synchronized(this) {
                        pendingSegments = maxOf(0, pendingSegments - 1)
                        if (active && pendingSegments == 0 && !listeningUser && !awaitingTranscript)
                            emit(if (modelRunning) "thinking" else "listening")
                    }
                }
            }
        }
    }

    fun stopPlayback() {
        playTicket.incrementAndGet()
        connection?.disconnect(); connection = null
        val t = audioTrack; audioTrack = null
        if (t != null) try { t.pause(); t.flush(); t.release() } catch (_: Exception) {}
        pendingSegments = 0; playing = false; turn = ""; modelRunning = false
    }
    fun interrupt() { stopPlayback(); manual = true; emit("listening") }
    fun stopManual() { manual = false }

    private fun monitorLoop(record: AudioRecord) {
        var noise = 180.0
        var voiced = 0
        var voicedInTurn = 0
        var quiet = 0
        val pre = ArrayDeque<ByteArray>()
        var captured = ByteArrayOutputStream()
        while (active) {
            val buffer = ByteArray(640)
            val count = try { record.read(buffer, 0, buffer.size) } catch (_: Exception) { break }
            if (count <= 0 || awaitingTranscript) continue
            var sum = 0.0
            for (i in 0 until count - 1 step 2) {
                val sample = ((buffer[i + 1].toInt() shl 8) or (buffer[i].toInt() and 255)).toShort().toDouble()
                sum += sample * sample
            }
            val rms = sqrt(sum / (count / 2))
            val threshold = maxOf(if (playing) 1550.0 else 650.0, noise * (if (playing) 4.5 else 3.1))
            val voice = rms > threshold
            if (!listeningUser && !playing && !voice) noise = noise * .98 + rms * .02
            if (!listeningUser) {
                pre.addLast(buffer)
                if (pre.size > 15) pre.removeFirst()
                voiced = if (voice) voiced + 1 else 0
                if (manual || voiced >= if (playing) 13 else 8) {
                    listeningUser = true; quiet = 0; voicedInTurn = if (voice) 1 else 0; captured = ByteArrayOutputStream()
                    for (part in pre) captured.write(part)
                    pre.clear()
                    if (playing || modelRunning) { stopPlayback(); emit("interrupt") }
                    emit("recording")
                }
            } else {
                captured.write(buffer, 0, count)
                if (voice) voicedInTurn++
                quiet = if (voice) 0 else quiet + 1
                if ((!manual && quiet >= 45 && captured.size() > 10000) || captured.size() >= 760000) {
                    val audio = captured.toByteArray()
                    listeningUser = false; manual = false; voiced = 0; quiet = 0; pre.clear()
                    if (voicedInTurn >= 4) transcribe(audio) else emit("listening")
                    voicedInTurn = 0
                }
            }
        }
    }

    private fun transcribe(pcm: ByteArray) {
        awaitingTranscript = true
        val generation = callGeneration.get()
        emit("transcribing")
        pool.execute {
            val result = try {
                val wav = ByteArrayOutputStream()
                fun le(value: Int, bytes: Int) { for (i in 0 until bytes) wav.write((value ushr (8 * i)) and 255) }
                wav.write("RIFF".toByteArray()); le(36 + pcm.size, 4); wav.write("WAVEfmt ".toByteArray())
                le(16, 4); le(1, 2); le(1, 2); le(16000, 4); le(32000, 4); le(2, 2); le(16, 2)
                wav.write("data".toByteArray()); le(pcm.size, 4); wav.write(pcm)
                val (status, body) = request("POST", "/voice/asr", JSONObject().put("data", Base64.encodeToString(wav.toByteArray(), Base64.NO_WRAP)))
                if (status !in 200..299) throw IllegalStateException()
                JSONObject(body).put("status", "ready")
            } catch (_: Exception) { JSONObject().put("status", "error").put("message", "语音识别失败，请轻点麦克风重试") }
            if (generation == callGeneration.get()) {
                awaitingTranscript = false
                if (active) activity.runOnUiThread {
                    if (active && generation == callGeneration.get()) event(result)
                }
            }
        }
    }

    fun endCall() {
        callGeneration.incrementAndGet()
        requested = false
        waitingPermission = false
        active = false
        stopPlayback()
        try { capture?.stop() } catch (_: Exception) {}
        capture?.release(); capture = null
        echo?.release(); echo = null
        monitor?.interrupt(); monitor = null
        if (audioModeChanged) {
            audioManager.mode = priorAudioMode
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = priorSpeakerphone
            audioModeChanged = false
        }
        listeningUser = false; manual = false
        awaitingTranscript = false
        emit("idle")
    }
    fun pause() { if (!waitingPermission) endCall() }
    fun destroy() { endCall(); destroyed = true; playback.shutdownNow() }
}
