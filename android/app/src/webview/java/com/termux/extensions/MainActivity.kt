package com.termux.extensions

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterFragment
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream

class MainActivity : AppCompatActivity() {

    private lateinit var webView: FilteredWebView
    private lateinit var nativeHeader: View

    private lateinit var consoleOverlay: FrameLayout
    private lateinit var consoleScroll: ScrollView
    private lateinit var consoleText: TextView

    private val editorInputFilter = EditorInputFilter()
    private var uiIpcClient: UiIpcClient? = null

    private var editorAssetManager: EditorAssetManager? = null
    private var localAssetServer: LocalAssetServer? = null

    private var consoleEventBridge: ConsoleEventBridge? = null
    private var flutterFragment: FlutterFragment? = null

    private lateinit var btnConsoleBack: Button
    private lateinit var btnConsoleStart: Button
    private lateinit var btnConsoleStop: Button

    private val httpClient = OkHttpClient()
    private val uiHandler = Handler(Looper.getMainLooper())

    private var frameworkBaseUrl: String = DEFAULT_FRAMEWORK_URL
    private var currentAppId: String = DEFAULT_APP_ID
    private var isLocked: Boolean = false

    private var inAppShell: Boolean = true
    private var persistentNetworkNotificationEnabled: Boolean = false
    private var notificationPermissionRequestInFlight: Boolean = false
    private var pendingPersistentServiceStart: Boolean = false

    private fun prefs() = getSharedPreferences("webview_session_state", Context.MODE_PRIVATE)

    // ── Asset intercept ─────────────────────────────────────────────

    /**
     * URL prefixes that should be served from the local asset server
     * instead of going to the Python framework. Mirrors background.js.
     */
    private val INTERCEPT_PREFIXES = arrayOf(
        "/static/vendor/codicons/",
        "/static/vendor/seti-icons/",
        "/static/vendor/es-module-shims/",
        "/static/vendor/xterm/",
        "/static/vendor/ws/",
        "/static/vendor/monaco-editor-core/te2-lang/bootstrap/",
        "/static/vendor/monaco-editor-core/te2-lang/basic-languages/",
        "/static/vendor/monaco-editor-core/te2-lang/language/",
        "/static/vendor/monaco-editor-core/esm/",
        "/static/fonts/",
        "/static/js/",
        "/apps/file_editor_cm6/static/",
        "/api/app/file_editor_cm6/ui/monaco_editor/",
        "/api/app/file_editor_cm6/ui/monaco_vscode/lang/",
        "/api/app/file_editor_cm6/ui/monaco_vscode/esm/",
        "/apps/file_editor_cm6/monaco_editor/vscode_build_src/"
    )

    private val INTERCEPT_FILES = arrayOf(
        "/static/icon.png",
        "/static/move.png",
        "/static/manifest.webmanifest",
        "/static/bookmarks.json",
        "/static/vendor/socket.io.min.js"
    )

    private val WORKER_RE = Regex("/te2-lang/workers/")
    private val TE2_LANG_CHUNK_RE = Regex("^/static/vendor/monaco-editor-core/te2-lang/chunk-[A-Z0-9]+\\.js$")

    private fun mapPath(urlPath: String): String {
        if (urlPath.startsWith("/api/app/file_editor_cm6/static/")) {
            return "/apps/file_editor_cm6/static/" + urlPath.removePrefix("/api/app/file_editor_cm6/static/")
        }
        if (urlPath == "/api/app/file_editor_cm6/ui/nc") {
            return "/api/app/file_editor_cm6/ui/nc.html"
        }
        if (urlPath == "/app/file_editor_cm6") {
            return "/app_shell_file_editor_cm6.html"
        }
        if (urlPath == "/") {
            return "/index.html"
        }
        return urlPath
    }

    private fun shouldIntercept(urlPath: String): Boolean {
        if (WORKER_RE.containsMatchIn(urlPath)) return false
        if (TE2_LANG_CHUNK_RE.matches(urlPath)) return true
        if (urlPath == "/" || urlPath == "/app/file_editor_cm6" || urlPath == "/api/app/file_editor_cm6/ui/nc") return true
        for (f in INTERCEPT_FILES) {
            if (urlPath == f) return true
        }
        for (prefix in INTERCEPT_PREFIXES) {
            if (urlPath.startsWith(prefix)) return true
        }
        return false
    }

    private fun interceptRequest(request: WebResourceRequest): WebResourceResponse? {
        val server = localAssetServer ?: return null
        if (server.port == 0) return null

        val url = request.url ?: return null
        val host = url.host ?: return null
        if (host != "127.0.0.1" && host != "localhost") return null

        val path = url.path ?: return null
        if (!shouldIntercept(path)) return null

        val localPath = mapPath(path).removePrefix("/")
        val assetRoot = editorAssetManager?.getAssetRoot() ?: return null
        val file = File(assetRoot, localPath)

        if (!file.exists() || !file.isFile) return null
        if (!file.canonicalPath.startsWith(assetRoot.canonicalPath)) return null

        val mime = guessMimeType(file.name)
        val encoding = if (isBinaryMime(mime)) null else "UTF-8"
        return try {
            Log.d("AssetIntercept", "Serving $path → $localPath ($mime)")
            WebResourceResponse(mime, encoding, FileInputStream(file))
        } catch (e: Exception) {
            Log.w("AssetIntercept", "Failed to serve $localPath: ${e.message}")
            null
        }
    }

    private fun isBinaryMime(mime: String): Boolean {
        return mime.startsWith("image/") || mime.startsWith("font/") ||
               mime == "application/octet-stream"
    }

    private fun guessMimeType(name: String): String {
        return when {
            name.endsWith(".js") || name.endsWith(".mjs") -> "application/javascript"
            name.endsWith(".css") -> "text/css"
            name.endsWith(".html") -> "text/html"
            name.endsWith(".json") -> "application/json"
            name.endsWith(".png") -> "image/png"
            name.endsWith(".svg") -> "image/svg+xml"
            name.endsWith(".ico") -> "image/x-icon"
            name.endsWith(".woff") -> "font/woff"
            name.endsWith(".woff2") -> "font/woff2"
            name.endsWith(".ttf") -> "font/ttf"
            name.endsWith(".webmanifest") -> "application/manifest+json"
            else -> "application/octet-stream"
        }
    }

    // ── Persistent network ──────────────────────────────────────────

    private fun updatePersistentNetworkService() {
        if (!persistentNetworkNotificationEnabled || !inAppShell) {
            pendingPersistentServiceStart = false
            stopService(Intent(this, PersistentNetworkService::class.java))
            return
        }

        if (android.os.Build.VERSION.SDK_INT >= 33) {
            val granted = ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                pendingPersistentServiceStart = true
                if (!notificationPermissionRequestInFlight) {
                    notificationPermissionRequestInFlight = true
                    ActivityCompat.requestPermissions(
                        this,
                        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                        9301
                    )
                }
                return
            }
        }

        pendingPersistentServiceStart = false
        try {
            val intent = Intent(this, PersistentNetworkService::class.java)
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                ContextCompat.startForegroundService(this, intent)
            } else {
                startService(intent)
            }
        } catch (_: Exception) {
            disablePersistentNetworkNotificationSetting()
        }
    }

    private fun disablePersistentNetworkNotificationSetting() {
        persistentNetworkNotificationEnabled = false
        pendingPersistentServiceStart = false
        notificationPermissionRequestInFlight = false
        stopService(Intent(this, PersistentNetworkService::class.java))

        Thread {
            try {
                val settingsUrl = frameworkBaseUrl.trimEnd('/') + "/api/settings"
                val merged = JSONObject()

                try {
                    val getReq = Request.Builder().url(settingsUrl).get().build()
                    httpClient.newCall(getReq).execute().use { resp ->
                        val body = resp.body?.string().orEmpty()
                        if (resp.isSuccessful && body.isNotBlank()) {
                            val json = JSONObject(body)
                            val data = json.optJSONObject("data")
                            if (data != null) {
                                val keys = data.keys()
                                while (keys.hasNext()) {
                                    val key = keys.next() as String
                                    merged.put(key, data.opt(key) ?: JSONObject.NULL)
                                }
                            }
                        }
                    }
                } catch (_: Exception) {
                }

                merged.put("persistent_network_notification", false)

                val postReq = Request.Builder()
                    .url(settingsUrl)
                    .post(merged.toString().toRequestBody("application/json".toMediaType()))
                    .build()
                httpClient.newCall(postReq).execute().close()
            } catch (_: Exception) {
            }
        }.start()
    }

    // ── onCreate ────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Pre-warm Flutter engine for console overlay
        consoleEventBridge = ConsoleEventBridge(this).also { it.init() }

        webView = findViewById(R.id.webview)
        webView.editorInputFilter = editorInputFilter
        nativeHeader = findViewById(R.id.nativeHeader)

        consoleOverlay = findViewById(R.id.consoleOverlay)
        consoleScroll = findViewById(R.id.consoleScroll)
        consoleText = findViewById(R.id.consoleText)
        consoleText.typeface = Typeface.MONOSPACE

        btnConsoleBack = findViewById(R.id.btnConsoleBack)
        btnConsoleStart = findViewById(R.id.btnConsoleStart)
        btnConsoleStop = findViewById(R.id.btnConsoleStop)

        findViewById<Button>(R.id.btnHome).setOnClickListener { loadHome() }
        findViewById<Button>(R.id.btnReload).setOnClickListener { webView.reload() }
        findViewById<Button>(R.id.btnRecents).setOnClickListener { showRecents() }
        findViewById<Button>(R.id.btnLock).setOnClickListener { toggleLock() }
        findViewById<Button>(R.id.btnQuit).setOnClickListener { quitCurrentApp() }
        findViewById<Button>(R.id.btnConsole).setOnClickListener { toggleConsoleOverlay() }

        btnConsoleBack.setOnClickListener { hideConsoleOverlay() }
        btnConsoleStart.setOnClickListener { flushBrowserCache() }
        btnConsoleStop.visibility = View.GONE

        findViewById<Button>(R.id.btnUpdateTe2).setOnClickListener { updateTe2Ui() }
        consoleScroll.visibility = View.GONE

        consoleOverlay.setOnClickListener { hideConsoleOverlay() }
        findViewById<View>(R.id.consolePanel).setOnClickListener { /* consume */ }

        // WebView settings
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = true
            allowContentAccess = true
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
        }

        webView.isFocusableInTouchMode = true
        webView.addJavascriptInterface(NativeBridge(this), "Android")

        webView.webViewClient = object : WebViewClient() {

            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                if (request != null) {
                    val intercepted = interceptRequest(request)
                    if (intercepted != null) return intercepted
                }
                return super.shouldInterceptRequest(view, request)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                val host = url.host ?: return false
                if (host == "127.0.0.1" || host == "localhost") {
                    // App shell detection
                    val path = url.path ?: ""
                    if (isAppShellUrl(url)) {
                        inAppShell = true
                        nativeHeader.visibility = View.VISIBLE
                        val appId = path.removePrefix("/app/").split("?").first()
                        if (appId.isNotBlank()) {
                            currentAppId = appId
                            isLocked = false
                            findViewById<Button>(R.id.btnLock).text = "Lock"
                        }
                        // Inject gv_native param
                        val newUri = ensureGvNative(url)
                        if (newUri != url) {
                            view?.loadUrl(newUri.toString())
                            return true
                        }
                    } else if (path == "/" || path.isEmpty()) {
                        inAppShell = false
                        nativeHeader.visibility = View.GONE
                    }
                    updatePersistentNetworkService()
                    return false
                }
                return false
            }

            private fun isAppShellUrl(uri: Uri): Boolean {
                val path = uri.path ?: return false
                return path.startsWith("/app/") && path.count { it == '/' } <= 2
            }

            private fun ensureGvNative(uri: Uri): Uri {
                if (uri.getQueryParameter("gv_native") == "1") return uri
                return uri.buildUpon()
                    .appendQueryParameter("gv_native", "1")
                    .build()
            }

            override fun onReceivedError(
                view: WebView?,
                errorCode: Int,
                description: String?,
                failingUrl: String?
            ) {
                Toast.makeText(
                    this@MainActivity,
                    getString(R.string.error_framework_not_running),
                    Toast.LENGTH_LONG
                ).show()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onJsAlert(
                view: WebView?,
                url: String?,
                message: String?,
                result: android.webkit.JsResult?
            ): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }

            override fun onJsConfirm(
                view: WebView?,
                url: String?,
                message: String?,
                result: android.webkit.JsResult?
            ): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                    .setNegativeButton(android.R.string.cancel) { _, _ -> result?.cancel() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }

            override fun onJsPrompt(
                view: WebView?,
                url: String?,
                message: String?,
                defaultValue: String?,
                result: android.webkit.JsPromptResult?
            ): Boolean {
                val input = EditText(this@MainActivity).apply {
                    setText(defaultValue ?: "")
                }
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setView(input)
                    .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm(input.text.toString()) }
                    .setNegativeButton(android.R.string.cancel) { _, _ -> result?.cancel() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }
        }

        // Init editor assets (local server for intercept)
        initEditorAssets()

        // Wake framework and load
        wakeFrameworkAndLoad()
    }

    // ── Editor assets ───────────────────────────────────────────────

    private fun initEditorAssets() {
        try {
            val mgr = EditorAssetManager(this)
            editorAssetManager = mgr

            val seeded = mgr.seedFromApk()
            if (seeded) {
                val ver = mgr.getLocalVersion() ?: "?"
                Toast.makeText(this, "Assets seeded from APK: v$ver", Toast.LENGTH_SHORT).show()
            }

            if (!mgr.getAssetRoot().exists()) {
                Log.w("MainActivity", "No editor assets available, skipping asset server")
                return
            }

            val server = LocalAssetServer(mgr.getAssetRoot())
            server.start()
            localAssetServer = server
            Log.i("MainActivity", "Local asset server on port ${server.port}")
        } catch (e: Exception) {
            Log.e("MainActivity", "initEditorAssets failed", e)
        }
    }

    // ── Lifecycle ───────────────────────────────────────────────────

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 9301) {
            notificationPermissionRequestInFlight = false
            val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            if (granted) {
                if (pendingPersistentServiceStart) {
                    updatePersistentNetworkService()
                }
            } else {
                disablePersistentNetworkNotificationSetting()
            }
        }
    }

    // ── Cache ───────────────────────────────────────────────────────

    private fun flushBrowserCache() {
        webView.clearCache(true)
        webView.reload()
        Toast.makeText(this, "Browser cache flushed", Toast.LENGTH_SHORT).show()
        hideConsoleOverlay()
    }

    private fun updateTe2Ui() {
        Toast.makeText(this, "Force-updating assets…", Toast.LENGTH_SHORT).show()
        Thread {
            try {
                val port = java.net.URI(frameworkBaseUrl).port.let { if (it == -1) 8089 else it }
                val mgr = editorAssetManager
                if (mgr != null) {
                    val ok = mgr.forceUpdateFromServer(port)
                    runOnUiThread {
                        if (ok) {
                            val ver = mgr.getLocalVersion() ?: "?"
                            Toast.makeText(this, "Assets updated to v$ver — reloading", Toast.LENGTH_SHORT).show()
                            findViewById<TextView>(R.id.consoleTitle)?.let {
                                if (consoleOverlay.visibility == View.VISIBLE)
                                    it.text = "Tools · v$ver"
                            }
                            flushBrowserCache()
                        } else {
                            Toast.makeText(this, "Asset update failed", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this, "Update failed: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }.start()
    }

    // ── Navigation ──────────────────────────────────────────────────

    private fun loadHome() {
        inAppShell = false
        nativeHeader.visibility = View.GONE
        updatePersistentNetworkService()
        webView.loadUrl(frameworkBaseUrl.trimEnd('/') + "/")
    }

    private fun loadApp(appId: String) {
        inAppShell = true
        nativeHeader.visibility = View.VISIBLE
        updatePersistentNetworkService()
        currentAppId = appId
        isLocked = false
        findViewById<Button>(R.id.btnLock).text = "Lock"
        webView.loadUrl(frameworkBaseUrl.trimEnd('/') + "/app/" + appId + "?gv_native=1")
    }

    private fun showRecents() {
        if (inAppShell) {
            webView.evaluateJavascript(
                "(function(){try{if(window.teOpenRecentsModal){window.teOpenRecentsModal();return;}var b=document.getElementById('btn-recents');if(b){b.click();}}catch(e){}})()",
                null
            )
            return
        }
        showNativeRecents()
    }

    private fun showNativeRecents() {
        Thread {
            try {
                val url = frameworkBaseUrl.trimEnd('/') + "/api/apps/running"
                val req = Request.Builder().url(url).get().build()
                httpClient.newCall(req).execute().use { resp ->
                    val body = resp.body?.string().orEmpty()
                    if (!resp.isSuccessful || body.isBlank()) return@use
                    val json = JSONObject(body)
                    val data = json.optJSONArray("data") ?: return@use
                    val ids = mutableListOf<String>()
                    for (i in 0 until data.length()) {
                        val obj = data.optJSONObject(i) ?: continue
                        val id = obj.optString("app_id")
                        if (id.isNotBlank()) ids.add(id)
                    }
                    runOnUiThread {
                        if (ids.isEmpty()) {
                            AlertDialog.Builder(this)
                                .setMessage("No running apps")
                                .setPositiveButton(android.R.string.ok, null)
                                .show()
                            return@runOnUiThread
                        }
                        AlertDialog.Builder(this)
                            .setTitle("Recents")
                            .setItems(ids.toTypedArray()) { _, which ->
                                val target = ids[which]
                                loadApp(target)
                            }
                            .setNegativeButton(android.R.string.cancel, null)
                            .show()
                    }
                }
            } catch (_: Exception) {
            }
        }.start()
    }

    private fun toggleLock() {
        Thread {
            try {
                val endpoint = if (isLocked) "unlock" else "lock"
                val url = frameworkBaseUrl.trimEnd('/') + "/api/apps/" + currentAppId + "/" + endpoint
                val req = Request.Builder()
                    .url(url)
                    .post("".toRequestBody("application/json".toMediaType()))
                    .build()
                httpClient.newCall(req).execute().use { resp ->
                    val body = resp.body?.string().orEmpty()
                    if (!resp.isSuccessful || body.isBlank()) return@use
                    val json = JSONObject(body)
                    if (json.optBoolean("ok")) {
                        isLocked = !isLocked
                        runOnUiThread {
                            findViewById<Button>(R.id.btnLock).text = if (isLocked) "Unlock" else "Lock"
                        }
                    }
                }
            } catch (_: Exception) {
            }
        }.start()
    }

    private fun quitCurrentApp() {
        Thread {
            try {
                val url = frameworkBaseUrl.trimEnd('/') + "/api/apps/" + currentAppId + "/quit"
                val req = Request.Builder()
                    .url(url)
                    .post("".toRequestBody("application/json".toMediaType()))
                    .build()
                httpClient.newCall(req).execute().close()
            } catch (_: Exception) {
            }
            runOnUiThread { loadHome() }
        }.start()
    }

    // ── Console overlay ─────────────────────────────────────────────

    private fun showConsoleOverlay() {
        consoleOverlay.visibility = View.VISIBLE
        attachFlutterConsole()
        // Show asset version inline with title
        try {
            val ver = editorAssetManager?.getLocalVersion() ?: "unknown"
            findViewById<TextView>(R.id.consoleTitle)?.text = "Tools · v$ver"
        } catch (_: Exception) {}
    }

    private fun hideConsoleOverlay() {
        consoleOverlay.visibility = View.GONE
    }

    private fun toggleConsoleOverlay() {
        if (consoleOverlay.visibility == View.VISIBLE) hideConsoleOverlay() else showConsoleOverlay()
    }

    private fun attachFlutterConsole() {
        if (flutterFragment != null) return
        val existing = supportFragmentManager.findFragmentByTag("flutter_console")
        if (existing is FlutterFragment) {
            flutterFragment = existing
            return
        }
        val fragment = FlutterFragment
            .withCachedEngine(ConsoleEventBridge.ENGINE_ID)
            .shouldAttachEngineToActivity(false)
            .renderMode(io.flutter.embedding.android.RenderMode.texture)
            .transparencyMode(io.flutter.embedding.android.TransparencyMode.transparent)
            .build<FlutterFragment>()
        flutterFragment = fragment
        supportFragmentManager.beginTransaction()
            .add(R.id.flutterConsoleContainer, fragment, "flutter_console")
            .commit()
        Log.d("MainActivity", "FlutterFragment attached to console overlay")
    }

    // ── Framework wake ──────────────────────────────────────────────

    private fun wakeFrameworkAndLoad(forceLoadHome: Boolean = true) {
        Thread {
            val base = IPC_SLEEP_BASE_URL.trimEnd('/')
            try {
                val wakeReq = Request.Builder()
                    .url("$base/actions/wake")
                    .post("".toRequestBody("application/json".toMediaType()))
                    .build()
                httpClient.newCall(wakeReq).execute().close()
            } catch (_: Exception) {
            }

            var frameworkUrl = DEFAULT_FRAMEWORK_URL
            try {
                val cfgReq = Request.Builder().url("$base/config").get().build()
                httpClient.newCall(cfgReq).execute().use { resp ->
                    val body = resp.body?.string()
                    if (resp.isSuccessful && !body.isNullOrBlank()) {
                        val json = JSONObject(body)
                        val data = json.optJSONObject("data")
                        val candidate = data?.optString("framework_url")
                        if (!candidate.isNullOrBlank()) {
                            frameworkUrl = candidate
                        }
                    }
                }
            } catch (_: Exception) {
            }

            frameworkBaseUrl = frameworkUrl

            // Check server for newer assets and download bundle if needed
            try {
                val port = java.net.URI(frameworkUrl).port.let { if (it == -1) 8089 else it }
                val mgr = editorAssetManager
                if (mgr != null) {
                    val serverVer = mgr.checkServerVersion(port)
                    if (serverVer != null) {
                        val localVer = mgr.getLocalVersion() ?: "none"
                        runOnUiThread {
                            Toast.makeText(this@MainActivity,
                                "Updating assets: v$localVer → v$serverVer…",
                                Toast.LENGTH_LONG).show()
                        }
                        val ok = mgr.downloadFromServer(port)
                        if (ok) {
                            runOnUiThread {
                                Toast.makeText(this@MainActivity,
                                    "Assets updated to v$serverVer",
                                    Toast.LENGTH_SHORT).show()
                                // Refresh title if overlay is showing
                                findViewById<TextView>(R.id.consoleTitle)?.let {
                                    if (consoleOverlay.visibility == View.VISIBLE)
                                        it.text = "Tools · v$serverVer"
                                }
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w("MainActivity", "Asset server check failed", e)
            }

            // Connect IME filter IPC
            try {
                val port = java.net.URI(frameworkUrl).port.let { if (it == -1) 8089 else it }
                uiIpcClient = UiIpcClient(editorInputFilter) { active ->
                    runOnUiThread {
                        val imm = getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager
                        if (active) {
                            webView.requestFocus()
                            imm?.restartInput(webView)
                            imm?.showSoftInput(webView, 0)
                        } else {
                            imm?.restartInput(webView)
                        }
                    }
                }
                // Wire console events from Socket.IO → Flutter EventChannel
                uiIpcClient?.onConsoleEvent = { eventName, data ->
                    consoleEventBridge?.onConsoleEvent(eventName, data)
                }
                consoleEventBridge?.uiIpcClient = uiIpcClient
                uiIpcClient?.connect(port)
            } catch (e: Exception) {
                Log.w("MainActivity", "UiIpcClient setup failed", e)
            }

            try {
                val androidCfgUrl = frameworkUrl.trimEnd('/') + "/api/android/config"
                val req = Request.Builder().url(androidCfgUrl).get().build()
                httpClient.newCall(req).execute().use { resp ->
                    val body = resp.body?.string()
                    if (resp.isSuccessful && !body.isNullOrBlank()) {
                        val json = JSONObject(body)
                        val data = json.optJSONObject("data")
                        persistentNetworkNotificationEnabled =
                            data?.optBoolean("persistent_network_notification", false) ?: false
                    }
                }
            } catch (_: Exception) {
            }
            runOnUiThread {
                if (forceLoadHome) {
                    loadHome()
                } else {
                    try {
                        updatePersistentNetworkService()
                    } catch (_: Exception) {
                    }
                }
            }
        }.start()
    }

    // ── Back / Destroy ──────────────────────────────────────────────

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (consoleOverlay.visibility == View.VISIBLE) {
            hideConsoleOverlay()
            return
        }
        if (webView.canGoBack()) {
            webView.goBack()
            return
        }
        super.onBackPressed()
    }

    override fun onDestroy() {
        uiIpcClient?.disconnect()
        uiIpcClient = null
        consoleEventBridge?.destroy()
        consoleEventBridge = null
        localAssetServer?.stop()
        localAssetServer = null
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val DEFAULT_FRAMEWORK_URL = "http://127.0.0.1:8089"
        private const val IPC_SLEEP_BASE_URL = "http://127.0.0.1:9100"
        private const val DEFAULT_APP_ID = "file_editor_cm6"
    }
}
