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
import androidx.compose.ui.platform.ComposeView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
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
    private lateinit var composeConsoleContainer: ComposeView
    private lateinit var consoleScroll: ScrollView
    private lateinit var consoleText: TextView

    private val editorInputFilter = EditorInputFilter()
    private val composeConsoleState = ComposeConsoleState()
    private var uiIpcClient: UiIpcClient? = null

    private var editorAssetManager: EditorAssetManager? = null
    private var localAssetServer: LocalAssetServer? = null
    private lateinit var androidSettingsStore: AndroidAppSettingsStore
    private lateinit var androidDiagnostics: AndroidDiagnostics
    @Volatile private var lastStartupFailure: String? = null

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
    private var persistentNetworkPermissionDenied: Boolean = false
    private var persistentNetworkStartFailed: Boolean = false

    private fun prefs() = getSharedPreferences("webview_session_state", Context.MODE_PRIVATE)

    // ── Asset intercept ─────────────────────────────────────────────

    /** Static OTA trees mirrored by the GeckoView request interceptor. */
    private val LOCAL_PREFIXES = arrayOf(
        "/static/vendor/codicons/",
        "/static/vendor/seti-icons/",
        "/static/vendor/es-module-shims/",
        "/static/vendor/codemirror.1/",
        "/static/vendor/xterm/",
        "/static/vendor/ws/",
        "/static/fonts/",
        "/static/js/",
        "/extensions/",
        "/apps/file_editor_cm6/static/icons/",
        "/apps/file_editor_cm6/static/vendor/monaco-touch-selection/",
        "/apps/file_editor_cm6/vendor/android-terminalapp-assets-js/",
        "/api/app/file_editor_cm6/static/vendor/monaco-touch-selection/",
        "/api/app/file_editor_cm6/ui/monaco_editor/textmate/",
        "/api/app/file_editor_cm6/ui/monaco_editor/themes/",
        "/api/app/file_editor_cm6/ui/monaco_vscode/lang/workers/"
    )

    private val LOCAL_FILES = setOf(
        "/static/icon.png",
        "/static/move.png",
        "/static/manifest.webmanifest",
        "/static/bookmarks.json",
        "/static/vendor/socket.io.min.js",
        "/static/vendor/monaco-editor-core/te2-lang/bootstrap/monaco.bootstrap.bundle.css",
        "/static/vendor/monaco-editor-core/te2-lang/bootstrap/codicon-LN6W7LCM.ttf",
        "/static/vendor/monaco-editor-core/esm/vs/editor/common/services/editorWebWorkerMain.bundle.js",
        "/apps/file_editor_cm6/template.html",
        "/apps/by-id/file_editor_cm6/template.html",
        "/apps/file_editor_cm6/static/dist/host.js",
        "/apps/by-id/file_editor_cm6/static/dist/host.js",
        "/apps/file_editor_cm6/static/dist/host.css",
        "/apps/file_editor_cm6/static/dist/explorer.css",
        "/apps/file_editor_cm6/static/dist/explorer-highlight-github.css",
        "/apps/file_editor_cm6/static/dist/explorer-search-widget.css",
        "/apps/file_editor_cm6/static/vendor/vconsole/vconsole.min.js",
        "/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.css",
        "/api/app/file_editor_cm6/ui/monaco_vscode/esm/vs/editor/common/services/editorWebWorkerMain.bundle.js",
        "/apps/file_editor_cm6/monaco_editor/vscode_build_src/out/breadcrumbsWidget.css",
        "/apps/file_editor_cm6/monaco_editor/vscode_chat_editing_vendor/upstream/media/chatEditorController.css",
        "/apps/file_editor_cm6/monaco_editor/vscode_chat_editing_vendor/upstream/media/chatEditingEditorOverlay.css"
    )

    private fun localPathFor(urlPath: String): String? {
        if (urlPath == "/") return "/index.html"
        if (urlPath == "/app/file_editor_cm6") return "/app_shell_file_editor_cm6.html"
        if (urlPath !in LOCAL_FILES && LOCAL_PREFIXES.none { urlPath.startsWith(it) }) {
            return null
        }
        if (urlPath == "/apps/by-id/file_editor_cm6/template.html") {
            return "/apps/file_editor_cm6/template.html"
        }
        if (urlPath.startsWith("/apps/by-id/file_editor_cm6/static/")) {
            return "/apps/file_editor_cm6/static/" + urlPath.removePrefix("/apps/by-id/file_editor_cm6/static/")
        }
        if (urlPath.startsWith("/api/app/file_editor_cm6/static/")) {
            return "/apps/file_editor_cm6/static/" + urlPath.removePrefix("/api/app/file_editor_cm6/static/")
        }
        if (urlPath.startsWith("/api/app/file_editor_cm6/ui/monaco_vscode/lang/")) {
            return "/static/vendor/monaco-editor-core/te2-lang/" + urlPath.removePrefix("/api/app/file_editor_cm6/ui/monaco_vscode/lang/")
        }
        if (urlPath.startsWith("/api/app/file_editor_cm6/ui/monaco_vscode/esm/")) {
            return "/static/vendor/monaco-editor-core/esm/" + urlPath.removePrefix("/api/app/file_editor_cm6/ui/monaco_vscode/esm/")
        }
        if (urlPath.startsWith("/apps/file_editor_cm6/monaco_editor/vscode_build_src/")) {
            return "/api/app/file_editor_cm6/ui/monaco_editor/vscode_build_src/" + urlPath.removePrefix("/apps/file_editor_cm6/monaco_editor/vscode_build_src/")
        }
        return urlPath
    }

    private fun interceptRequest(request: WebResourceRequest): WebResourceResponse? {
        val server = localAssetServer ?: return null
        if (server.port == 0) return null

        val url = request.url ?: return null
        val path = url.path ?: return null
        val localPath = localPathFor(path)?.removePrefix("/") ?: return null
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
            stopPersistentNetworkServiceLocally()
            persistentNetworkStartFailed = false
            return
        }

        if (persistentNetworkStartFailed) return

        if (android.os.Build.VERSION.SDK_INT >= 33) {
            val granted = ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                if (!persistentNetworkPermissionDenied && !notificationPermissionRequestInFlight) {
                    notificationPermissionRequestInFlight = true
                    ActivityCompat.requestPermissions(
                        this,
                        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                        9301
                    )
                }
            }
        }

        try {
            val intent = Intent(this, PersistentNetworkService::class.java)
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                ContextCompat.startForegroundService(this, intent)
            } else {
                startService(intent)
            }
        } catch (_: Exception) {
            persistentNetworkStartFailed = true
            stopPersistentNetworkServiceLocally()
        }
    }

    private fun stopPersistentNetworkServiceLocally() {
        notificationPermissionRequestInFlight = false
        stopService(Intent(this, PersistentNetworkService::class.java))
    }

    // ── onCreate ────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        androidDiagnostics = AndroidDiagnostics(applicationContext)
        androidDiagnostics.beginSession()
        androidSettingsStore = AndroidAppSettingsStore(applicationContext)
        applyAndroidSettings(androidSettingsStore.load(), reconnect = false)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        webView.editorInputFilter = editorInputFilter
        nativeHeader = findViewById(R.id.nativeHeader)

        consoleOverlay = findViewById(R.id.consoleOverlay)
        composeConsoleContainer = findViewById(R.id.composeConsoleContainer)
        consoleScroll = findViewById(R.id.consoleScroll)
        consoleText = findViewById(R.id.consoleText)
        consoleText.typeface = Typeface.MONOSPACE
        composeConsoleState.bind(
            composeConsoleContainer,
            onSendEval = { code, target ->
                uiIpcClient?.sendConsoleEval(code, target)
            },
            onRequestClear = {
                uiIpcClient?.sendConsoleClear()
            },
        )

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
                val frameworkUri = Uri.parse(frameworkBaseUrl)
                val isFrameworkOrigin =
                    url.scheme.equals(frameworkUri.scheme, ignoreCase = true) &&
                        url.host.equals(frameworkUri.host, ignoreCase = true) &&
                        effectivePort(url) == effectivePort(frameworkUri)
                val isAndroidShell =
                    (url.host == "127.0.0.1" || url.host == "localhost") &&
                        url.port == localAssetServer?.port &&
                        (url.path ?: "").startsWith("/android-shell/")
                if (isFrameworkOrigin || isAndroidShell) {
                    // App shell detection
                    val path = url.path ?: ""
                    if (isFrameworkOrigin && (path == "/" || path.isEmpty())) {
                        loadHome()
                        return true
                    }
                    if (isFrameworkOrigin && isAppShellUrl(url)) {
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
                    } else if (isAndroidShell) {
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

            private fun effectivePort(uri: Uri): Int {
                if (uri.port >= 0) return uri.port
                return if (uri.scheme.equals("https", ignoreCase = true)) 443 else 80
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

        // The local launcher is never gated on framework reachability.
        loadHome()
        wakeFrameworkAndLoad(forceLoadHome = false)
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
                recordStartupFailure("APK editor asset seed did not create the local asset root")
                return
            }

            val gateway = AndroidShellGateway(
                settingsStore = androidSettingsStore,
                httpClient = httpClient,
                onSettingsChanged = { settings ->
                    applyAndroidSettings(settings, reconnect = true)
                },
                diagnosticsProvider = {
                    androidDiagnostics.snapshot(androidDiagnosticRuntimeState())
                },
            )
            val server = LocalAssetServer(mgr.getAssetRoot(), gateway::handle)
            server.start()
            localAssetServer = server
            lastStartupFailure = null
            Log.i("MainActivity", "Local asset server on port ${server.port}")
        } catch (e: Exception) {
            recordStartupFailure("Local launcher initialization failed", e)
        }
    }

    // ── Lifecycle ───────────────────────────────────────────────────

    override fun onResume() {
        super.onResume()
        webView.onResume()
        persistentNetworkPermissionDenied = false
        persistentNetworkStartFailed = false
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
                persistentNetworkPermissionDenied = false
            } else {
                persistentNetworkPermissionDenied = true
            }
            updatePersistentNetworkService()
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
                val mgr = editorAssetManager
                if (mgr != null) {
                    val ok = mgr.forceUpdateFromServer(frameworkBaseUrl)
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
        updatePersistentNetworkService()
        val server = localAssetServer
        if (server == null || server.port <= 0) {
            showFatalStartupToast("Android launcher server is unavailable")
            return
        }
        nativeHeader.visibility = View.GONE
        webView.loadUrl(server.url("/android-shell/index.html"))
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
        composeConsoleState.resetSession()
        loadAndroidDiagnosticsIntoTools()
        uiIpcClient?.setConsoleDrawerEnabled(true, CONSOLE_TAIL_LINES)
        // Show asset version inline with title
        try {
            val ver = editorAssetManager?.getLocalVersion() ?: "unknown"
            findViewById<TextView>(R.id.consoleTitle)?.text = "Tools · v$ver"
        } catch (_: Exception) {}
    }

    private fun hideConsoleOverlay() {
        consoleOverlay.visibility = View.GONE
        uiIpcClient?.setConsoleDrawerEnabled(false)
        composeConsoleState.resetSession()
    }

    private fun toggleConsoleOverlay() {
        if (consoleOverlay.visibility == View.VISIBLE) hideConsoleOverlay() else showConsoleOverlay()
    }

    private fun loadAndroidDiagnosticsIntoTools() {
        Thread {
            val dump = androidDiagnostics.captureWarningsAndErrors()
            when {
                dump.error != null -> composeConsoleState.appendNativeLog("error", dump.error)
                dump.lines.isEmpty() -> composeConsoleState.appendNativeLog(
                    "info",
                    "No Android warnings or errors in this session",
                )
                else -> dump.lines.forEach { line ->
                    composeConsoleState.appendNativeLog(androidLogcatLevel(line), line)
                }
            }
        }.start()
    }

    private fun androidDiagnosticRuntimeState(): JSONObject = JSONObject().apply {
        put("frameworkBaseUrl", frameworkBaseUrl)
        put("localAssetServerPort", localAssetServer?.port ?: 0)
        put("assetRootExists", editorAssetManager?.getAssetRoot()?.exists() == true)
        put("localAssetVersion", editorAssetManager?.getLocalVersion() ?: JSONObject.NULL)
        put("lastStartupFailure", lastStartupFailure ?: JSONObject.NULL)
        put("inAppShell", inAppShell)
    }

    private fun recordStartupFailure(message: String, error: Throwable? = null) {
        val detail = formatStartupFailure(message, error)
        lastStartupFailure = detail
        if (error == null) Log.e("MainActivity", detail) else Log.e("MainActivity", detail, error)
    }

    private fun showFatalStartupToast(fallback: String) {
        nativeHeader.visibility = View.VISIBLE
        Toast.makeText(this, lastStartupFailure ?: fallback, Toast.LENGTH_LONG).show()
    }

    // ── Framework wake ──────────────────────────────────────────────

    private fun applyAndroidSettings(settings: AndroidAppSettings, reconnect: Boolean) {
        frameworkBaseUrl = settings.frameworkBaseUrl
        persistentNetworkNotificationEnabled = settings.persistentNetworkNotification
        if (!reconnect) return

        runOnUiThread {
            updatePersistentNetworkService()
        }
        uiIpcClient?.disconnect()
        uiIpcClient = null
        wakeFrameworkAndLoad(forceLoadHome = false)
    }

    private fun wakeFrameworkAndLoad(forceLoadHome: Boolean = true) {
        Thread {
            val base = IPC_SLEEP_BASE_URL.trimEnd('/')
            val settings = androidSettingsStore.load()
            val frameworkUrl = settings.frameworkBaseUrl
            val localTarget = settings.frameworkHost == "127.0.0.1" ||
                settings.frameworkHost.equals("localhost", ignoreCase = true)
            if (localTarget && !isFrameworkReachable(frameworkUrl)) {
                try {
                    val wakeReq = Request.Builder()
                        .url("$base/actions/wake")
                        .post("".toRequestBody("application/json".toMediaType()))
                        .build()
                    httpClient.newCall(wakeReq).execute().close()
                } catch (_: Exception) {
                }

                for (_attempt in 0 until 10) {
                    Thread.sleep(200)
                    if (isFrameworkReachable(frameworkUrl)) {
                        break
                    }
                }
            }

            frameworkBaseUrl = frameworkUrl

            // Check server for newer assets and download bundle if needed
            try {
                val mgr = editorAssetManager
                if (mgr != null) {
                    val serverVer = mgr.checkServerVersion(frameworkUrl)
                    if (serverVer != null) {
                        val localVer = mgr.getLocalVersion() ?: "none"
                        runOnUiThread {
                            Toast.makeText(this@MainActivity,
                                "Updating assets: v$localVer → v$serverVer…",
                                Toast.LENGTH_LONG).show()
                        }
                        val ok = mgr.downloadFromServer(frameworkUrl)
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
                uiIpcClient?.disconnect()
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
                uiIpcClient?.onConsoleEvent = { eventName, data ->
                    composeConsoleState.onConsoleEvent(eventName, data)
                }
                uiIpcClient?.connect(frameworkUrl)
                if (consoleOverlay.visibility == View.VISIBLE) {
                    uiIpcClient?.setConsoleDrawerEnabled(true, CONSOLE_TAIL_LINES)
                }
            } catch (e: Exception) {
                Log.w("MainActivity", "UiIpcClient setup failed", e)
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

    private fun isFrameworkReachable(frameworkUrl: String): Boolean {
        val probeUrl = frameworkUrl.trimEnd('/') + "/api/apps/catalog"
        return try {
            val req = Request.Builder().url(probeUrl).get().build()
            httpClient.newCall(req).execute().use { resp -> resp.isSuccessful }
        } catch (_: Exception) {
            false
        }
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
        localAssetServer?.stop()
        localAssetServer = null
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val CONSOLE_TAIL_LINES = 500
        private const val DEFAULT_FRAMEWORK_URL = "http://127.0.0.1:8089"
        private const val IPC_SLEEP_BASE_URL = "http://127.0.0.1:9100"
        private const val DEFAULT_APP_ID = "file_editor_cm6"
    }
}
