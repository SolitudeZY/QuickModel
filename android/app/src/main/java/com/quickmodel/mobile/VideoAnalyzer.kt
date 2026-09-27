package com.quickmodel.mobile

import android.content.Context
import android.net.Uri
import android.media.MediaMetadataRetriever
import android.media.MediaExtractor
import android.media.MediaMuxer
import android.media.MediaCodec
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer

/** Bounded sparse sampling, not continuous or frame-complete video understanding. */
object VideoAnalyzer {
    fun extract(context: Context, uri: Uri, request: (String, String, JSONObject) -> Pair<Int, String>): JSONObject {
        val retriever = MediaMetadataRetriever()
        val images = JSONArray()
        val labels = mutableListOf<String>()
        try {
            retriever.setDataSource(context, uri)
            val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0
            require(duration in 1..60000) { "请选择 60 秒以内的视频" }
            val count = minOf(12, maxOf(2, (duration / 5000 + 1).toInt()))
            for (i in 0 until count) {
                val at = i * (duration - 1) / (count - 1)
                val frame = retriever.getScaledFrameAtTime(at * 1000, MediaMetadataRetriever.OPTION_CLOSEST, 960, 960) ?: continue
                val output = ByteArrayOutputStream(); frame.compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, output); frame.recycle()
                val (status, body) = request("POST", "/media/images", JSONObject().put("data", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)))
                check(status in 200..299) { "视频帧上传失败，请重试" }
                images.put(JSONObject(body)); labels.add("第 ${images.length()} 张：${at / 1000.0} 秒")
            }
            check(images.length() > 0) { "无法提取视频画面" }
            val transcript = transcribeAudio(context, uri, request)
            return JSONObject().put("images", images).put("description",
                "[短视频抽帧分析；视频 ${duration / 1000.0} 秒，${labels.joinToString("；")}。稀疏抽帧可能遗漏快速动作。音轨：$transcript]")
        } finally { retriever.release() }
    }

    private fun transcribeAudio(context: Context, uri: Uri, request: (String, String, JSONObject) -> Pair<Int, String>): String {
        val extractor = MediaExtractor()
        val file = File.createTempFile("video-audio-", ".m4a", context.cacheDir)
        var muxer: MediaMuxer? = null
        try {
            extractor.setDataSource(context, uri, null)
            val index = (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString("mime")?.startsWith("audio/") == true }
                ?: return "没有音轨"
            val format = extractor.getTrackFormat(index)
            if (format.getString("mime") != "audio/mp4a-latm") return "此音频编码暂不转写，仅分析画面"
            extractor.selectTrack(index)
            muxer = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val track = muxer.addTrack(format); muxer.start()
            val buffer = ByteBuffer.allocate(256000); val info = MediaCodec.BufferInfo()
            var total = 0
            while (true) {
                buffer.clear(); val size = extractor.readSampleData(buffer, 0)
                if (size < 0) break
                total += size; if (total > 900000) return "音轨过大，暂仅分析画面"
                info.set(0, size, extractor.sampleTime, extractor.sampleFlags)
                muxer.writeSampleData(track, buffer, info); extractor.advance()
            }
            muxer.stop(); muxer.release(); muxer = null
            val (status, body) = request("POST", "/voice/asr", JSONObject().put("data", Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)))
            return if (status in 200..299) JSONObject(body).optString("text", "无可识别语音") else "转写失败，暂仅分析画面"
        } catch (_: Exception) { return "转写不可用，暂仅分析画面" }
        finally { try { muxer?.release() } catch (_: Exception) {} ; extractor.release(); file.delete() }
    }
}
