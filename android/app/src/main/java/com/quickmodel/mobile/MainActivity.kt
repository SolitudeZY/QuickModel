package com.quickmodel.mobile

import android.app.Activity
import android.os.Bundle
import android.content.Intent
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.view.WindowInsets
import android.view.WindowInsetsAnimation
import android.widget.FrameLayout
import android.view.ViewGroup
import android.graphics.Color
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.KeyGenerator
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.util.concurrent.Executors
import java.io.File

class MainActivity : Activity() {
    private lateinit var web: WebView
    private val pool = Executors.newFixedThreadPool(3)
    private val origin = "https://appassets.androidplatform.net"
    private val server = "https://47.102.146.139/quickmodel-api"
    private val prefs by lazy { getSharedPreferences("device", MODE_PRIVATE) }
    private val vaultLock = Any()
    private var pickingImage = false
    private lateinit var voice: VoiceController

    @Deprecated("Activity result compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 44) {
            pickingImage = false
            if (resultCode != RESULT_OK || data == null) { imageEvent(JSONObject().put("cancelled", true)); return }
            File(cacheDir, "screen-ready.jpg").delete(); File(cacheDir, "screen-error.txt").delete()
            startForegroundService(Intent(this, ScreenCaptureService::class.java).putExtra("code", resultCode).putExtra("data", data))
            imageEvent(JSONObject().put("cancelled", true))
            moveTaskToBack(true)
            return
        }
        if (requestCode == 43) {
            pickingImage = false
            val uri = data?.data
            if (resultCode != RESULT_OK || uri == null) { imageEvent(JSONObject().put("cancelled", true)); return }
            pool.execute {
                val result = try { VideoAnalyzer.extract(this, uri, ::request) }
                catch (e: Exception) { JSONObject().put("error", e.message?.take(120) ?: "视频分析准备失败") }
                imageEvent(result)
            }
            return
        }
        if (requestCode != 41) return
        pickingImage = false
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null) { imageEvent(JSONObject().put("cancelled", true)); return }
        pool.execute {
            val result = try {
                // ImageDecoder applies EXIF rotation, then scales without a full-size bitmap.
                val source = android.graphics.ImageDecoder.createSource(contentResolver, uri)
                val bitmap = android.graphics.ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                    val scale = minOf(1.0, 1600.0 / maxOf(info.size.width, info.size.height))
                    decoder.setTargetSize(maxOf(1, (info.size.width * scale).toInt()), maxOf(1, (info.size.height * scale).toInt()))
                    decoder.allocator = android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE
                }
                val output = java.io.ByteArrayOutputStream()
                bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, output); bitmap.recycle()
                if (output.size() > 1000000) throw IllegalArgumentException("图片过大，请裁剪后重试")
                val (status, body) = request("POST", "/media/images", JSONObject().put("data", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)))
                if (status !in 200..299) throw IllegalStateException("图片上传失败（$status）")
                JSONObject(body)
            } catch (_: Exception) { JSONObject().put("error", "图片读取或上传失败，请检查网络并重新选择") }
            imageEvent(result)
        }
    }

    private fun imageEvent(result: JSONObject) {
        runOnUiThread { if (!isDestroyed) web.evaluateJavascript("window.mobileImage && window.mobileImage(" + result.toString() + ")", null) }
    }

    private fun key(): SecretKey = synchronized(vaultLock) {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!store.containsAlias("quickmodel")) {
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder("quickmodel", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
                generateKey()
            }
        }
        store.getKey("quickmodel", null) as SecretKey
    }
    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }
    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }
    private fun token(): String = prefs.getString("token", null)?.let { decrypt(it) } ?: ""
    private fun cache(path: String): File {
        val hash = MessageDigest.getInstance("SHA-256").digest(path.toByteArray()).joinToString("") { "%02x".format(it) }
        val dir = File(filesDir, "offline").apply { mkdirs() }
        return File(dir, hash)
    }
    private fun request(method: String, path: String, body: JSONObject): Pair<Int, String> {
        val connection = URL(server + path).openConnection() as HttpsURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 15000
        connection.readTimeout = 50000
        connection.instanceFollowRedirects = false
        connection.setRequestProperty("Accept", "application/json")
        if (path != "/pair") connection.setRequestProperty("Authorization", "Bearer " + token())
        try {
            if (method == "POST" || method == "PATCH") {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "{}"
            if (response.length > 4_000_000) throw IllegalStateException("响应过大")
            return Pair(status, response)
        } finally { connection.disconnect() }
    }
    private fun dispatch(input: JSONObject): JSONObject {
        val method = input.optString("method", "GET")
        val path = input.optString("path")
        if (path == "/native/status") return JSONObject().put("paired", token().isNotEmpty())
        if (path == "/native/capture-screen") {
            runOnUiThread {
                if (!pickingImage) {
                    pickingImage = true
                    val manager = getSystemService(android.media.projection.MediaProjectionManager::class.java)
                    startActivityForResult(manager.createScreenCaptureIntent(), 44)
                }
            }
            return JSONObject().put("started", true)
        }
        if (path.startsWith("/native/voice-")) {
            val text = input.optJSONObject("body")?.optString("text") ?: ""
            runOnUiThread {
                when (path) {
                    "/native/voice-start" -> voice.start()
                    "/native/voice-stop" -> voice.stop(true)
                    "/native/voice-cancel" -> voice.pause()
                    "/native/voice-speak" -> voice.speak(text)
                }
            }
            return JSONObject().put("ok", true)
        }
        if (path == "/native/pick-image" || path == "/native/pick-video") {
            runOnUiThread {
                if (!pickingImage) {
                    pickingImage = true
                    try { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type = if (path.endsWith("video")) "video/*" else "image/*"; addCategory(Intent.CATEGORY_OPENABLE) }, if (path.endsWith("video")) 43 else 41) }
                    catch (_: Exception) { pickingImage = false; imageEvent(JSONObject().put("error", "系统图片选择器不可用")) }
                }
            }
            return JSONObject().put("started", true)
        }
        if (path == "/native/appearance") {
            val period = input.optJSONObject("body")?.optString("period") ?: "day"
            runOnUiThread {
                val color = when (period) { "night" -> Color.rgb(19,33,43); "dusk" -> Color.rgb(246,232,222); else -> Color.rgb(246,245,240) }
                (web.parent as? FrameLayout)?.setBackgroundColor(color)
                if (android.os.Build.VERSION.SDK_INT >= 30) {
                    val flags = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                    window.insetsController?.setSystemBarsAppearance(if (period == "night") 0 else flags, flags)
                }
            }
            return JSONObject().put("ok", true)
        }
        if (path == "/native/pending") {
            if (method == "POST") {
                prefs.edit().putString("pending", encrypt(input.getJSONObject("body").getString("value"))).commit()
                return JSONObject().put("ok", true)
            }
            return JSONObject().put("value", prefs.getString("pending", null)?.let { decrypt(it) } ?: "{}")
        }
        if (!Regex("^/(pair|device|models|settings|weather|media/images/[a-f0-9]{64}|conversations(?:/[A-Za-z0-9_-]+(?:/send)?)?|runs/[a-f0-9]+(?:/stop)?|health/(summary|heart-rate|sleep|coverage|connection|sync)|health-sync/[a-f0-9-]+)$").matches(path)
            || method !in listOf("GET", "POST", "PATCH", "DELETE")) throw IllegalArgumentException("不支持的操作")
        val cacheable = method == "GET" && (path.startsWith("/conversations") || path == "/models" || path == "/settings")
        val response: Pair<Int, String>
        try { response = request(method, path, input.optJSONObject("body") ?: JSONObject()) }
        catch (e: java.io.IOException) {
            if (cacheable && cache(path).exists()) return JSONObject().put("offline", true).put("payload", decrypt(cache(path).readText()))
            throw IllegalStateException("无法连接服务器，请检查网络后重试")
        }
        val (status, content) = response
        if (status !in 200..299) {
            if (status == 401) {
                prefs.edit().clear().commit()
                File(filesDir, "offline").listFiles()?.forEach { it.delete() }
            }
            val detail = try { JSONObject(content).optString("detail", "请求失败") } catch (_: Exception) { "请求失败" }
            throw IllegalStateException("$status · $detail")
        }
        if (path == "/pair") {
            prefs.edit().putString("token", encrypt(JSONObject(content).getString("token"))).commit()
            return JSONObject().put("paired", true)
        }
        if (path == "/device" && method == "DELETE") {
            prefs.edit().clear().commit()
            File(filesDir, "offline").listFiles()?.forEach { it.delete() }
        }
        if (cacheable) {
            val file = cache(path)
            synchronized(vaultLock) {
                val temp = File(file.path + ".tmp")
                temp.writeText(encrypt(content))
                if (!temp.renameTo(file)) { temp.delete(); throw IllegalStateException("离线缓存保存失败") }
                file.parentFile?.listFiles()?.sortedByDescending { it.lastModified() }?.drop(15)?.forEach { it.delete() }
            }
        }
        return JSONObject().put("payload", content).put("offline", false)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this)
        root.setBackgroundColor(Color.rgb(246, 245, 240))
        web = WebView(this)
        voice = VoiceController(this, pool, ::request) { result ->
            if (!isDestroyed) web.evaluateJavascript("window.mobileVoice && window.mobileVoice(" + result.toString() + ")", null)
        }
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            val types = WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime()
            var animating = false
            var latest: WindowInsets? = null
            fun applyInsets(insets: WindowInsets) {
                val safe = insets.getInsets(types)
                // WebView padding does not resize the CSS viewport. Resize its parent instead.
                root.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            }
            root.setOnApplyWindowInsetsListener { _, insets ->
                latest = insets
                if (!animating) applyInsets(insets)
                WindowInsets.CONSUMED
            }
            root.setWindowInsetsAnimationCallback(object : WindowInsetsAnimation.Callback(DISPATCH_MODE_STOP) {
                override fun onPrepare(animation: WindowInsetsAnimation) {
                    if (animation.typeMask and WindowInsets.Type.ime() != 0) animating = true
                }
                override fun onProgress(insets: WindowInsets, runningAnimations: MutableList<WindowInsetsAnimation>): WindowInsets {
                    applyInsets(insets)
                    return WindowInsets.CONSUMED
                }
                override fun onEnd(animation: WindowInsetsAnimation) {
                    if (animation.typeMask and WindowInsets.Type.ime() != 0) {
                        animating = false
                        latest?.let { applyInsets(it) }
                    }
                }
            })
            root.requestApplyInsets()
        } else {
            // On Android 9/10 the framework fits system bars and adjustResize handles IME.
            root.fitsSystemWindows = true
        }
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        WebView.setWebContentsDebuggingEnabled(false)
        val assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) { consumeScreenshot() }
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                return assets.shouldInterceptRequest(request.url)
                    ?: WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), "".byteInputStream())
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.toString().startsWith("$origin/assets/")) return false
                if (request.isForMainFrame && request.hasGesture() && request.url.scheme in listOf("https", "http")) {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                }
                return true
            }
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            web.loadData("请先更新 Android System WebView 后再打开 QuickModel。", "text/html", "utf-8")
            return
        }
        WebViewCompat.addWebMessageListener(web, "QuickModelNative", setOf(origin)) { _, message, source, isMain, reply ->
            if (!isMain || source.toString().trimEnd('/') != origin) return@addWebMessageListener
            val data = message.data ?: return@addWebMessageListener
            if (data.length > 200000) return@addWebMessageListener
            pool.execute {
                var id = ""
                val response = try {
                    val input = JSONObject(data); id = input.getString("id")
                    JSONObject().put("id", id).put("ok", true).put("data", dispatch(input))
                } catch (e: Exception) {
                    JSONObject().put("id", id).put("ok", false).put("error", e.message ?: "请求未完成")
                }
                runOnUiThread { if (!isDestroyed) reply.postMessage(response.toString()) }
            }
        }
        web.loadUrl("$origin/assets/index.html")
    }
    @Deprecated("Android compatibility")
    override fun onBackPressed() { web.evaluateJavascript("window.mobileBack && window.mobileBack()", null) }
    override fun onResume() {
        super.onResume()
        consumeScreenshot()
    }
    private fun consumeScreenshot() {
        if (!::web.isInitialized) return
        web.evaluateJavascript("typeof window.mobileImage === 'function'") { ready ->
            if (ready != "true") return@evaluateJavascript
            val error = File(cacheDir, "screen-error.txt")
            if (error.exists()) { imageEvent(JSONObject().put("error", error.readText())); error.delete() }
            val screenshot = File(cacheDir, "screen-ready.jpg")
            if (screenshot.exists()) {
                val bytes = screenshot.readBytes(); screenshot.delete()
                pool.execute {
                    val result = try {
                        val (status, body) = request("POST", "/media/images", JSONObject().put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)))
                        if (status !in 200..299) throw IllegalStateException()
                        JSONObject(body)
                    } catch (_: Exception) { JSONObject().put("error", "截图上传失败，请重新截屏或上传系统截图") }
                    imageEvent(result)
                }
            }
        }
    }
    override fun onPause() { if (::voice.isInitialized) voice.pause(); super.onPause() }
    override fun onDestroy() { voice.destroy(); web.destroy(); pool.shutdownNow(); super.onDestroy() }
}
