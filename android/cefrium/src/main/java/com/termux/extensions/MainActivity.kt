package com.termux.extensions

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.ui.platform.ComposeView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.cefrium.CefriumBrowser
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {
    private lateinit var browser: CefriumBrowser
    private lateinit var browserContainer: FrameLayout
    private lateinit var nativeHeader: View
    private lateinit var consoleOverlay: FrameLayout
    private lateinit var composeConsoleContainer: ComposeView
    private lateinit var inspectorPanel: FrameLayout
    private lateinit var btnToolsConsole: Button
    private lateinit var btnToolsInspector: Button
    private lateinit var consoleTitle: TextView

    private lateinit var settingsStore: AndroidAppSettingsStore
    private lateinit var diagnostics: AndroidDiagnostics
    private lateinit var assetManager: EditorAssetManager
    private lateinit var shellGateway: AndroidShellGateway
    private lateinit var relay: AndroidFrameworkRelay

    private val editorInputFilter = EditorInputFilter()
    private val consoleState = ComposeConsoleState()
    private var uiIpcClient: UiIpcClient? = null
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var frameworkBaseUrl = AndroidAppSettings().frameworkBaseUrl
    private var currentAppId = DEFAULT_APP_ID
    private var currentPath = LAUNCHER_PATH
    private var canNavigateBack = false
    private var inAppShell = false
    private var isLocked = false
    private var toolsConsoleSelected = true
    private var persistentNetworkEnabled = false
    private var notificationPermissionRequestInFlight = false
    private var notificationPermissionDenied = false

    private fun prefs() =
        getSharedPreferences("cefrium_session_state", Context.MODE_PRIVATE)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        diagnostics = AndroidDiagnostics(applicationContext)
        diagnostics.beginSession()
        settingsStore = AndroidAppSettingsStore(applicationContext)
        frameworkBaseUrl = settingsStore.load().frameworkBaseUrl
        persistentNetworkEnabled = settingsStore.load().persistentNetworkNotification

        setContentView(R.layout.activity_main)
        bindViews()
        bindControls()

        try {
            initializeAssetsAndRelay()
            initializeBrowser()
            connectFrameworkServices(settingsStore.load())
            checkForAssetUpdate()
            restoreOrLoadLauncher()
        } catch (error: Exception) {
            Log.e(TAG, "Cefrium shell startup failed", error)
            nativeHeader.visibility = View.VISIBLE
            Toast.makeText(
                this,
                "Cefrium startup failed: ${error.message ?: error.javaClass.simpleName}",
                Toast.LENGTH_LONG,
            ).show()
        }
    }

    private fun bindViews() {
        browserContainer = findViewById(R.id.browserContainer)
        nativeHeader = findViewById(R.id.nativeHeader)
        consoleOverlay = findViewById(R.id.consoleOverlay)
        composeConsoleContainer = findViewById(R.id.composeConsoleContainer)
        inspectorPanel = findViewById(R.id.inspectorPanel)
        btnToolsConsole = findViewById(R.id.btnToolsConsole)
        btnToolsInspector = findViewById(R.id.btnToolsInspector)
        consoleTitle = findViewById(R.id.consoleTitle)

        consoleState.bind(
            composeConsoleContainer,
            onSendEval = { code, target -> uiIpcClient?.sendConsoleEval(code, target) },
            onRequestClear = { uiIpcClient?.sendConsoleClear() },
        )
    }

    private fun bindControls() {
        findViewById<Button>(R.id.btnHome).setOnClickListener { loadLauncher() }
        findViewById<Button>(R.id.btnReload).setOnClickListener {
            if (::browser.isInitialized) browser.reload()
        }
        findViewById<Button>(R.id.btnRecents).setOnClickListener { showRecents() }
        findViewById<Button>(R.id.btnLock).setOnClickListener { toggleLock() }
        findViewById<Button>(R.id.btnQuit).setOnClickListener { quitCurrentApp() }
        findViewById<Button>(R.id.btnConsole).setOnClickListener { toggleTools() }
        findViewById<Button>(R.id.btnConsoleBack).setOnClickListener { hideTools() }
        findViewById<Button>(R.id.btnConsoleStart).setOnClickListener { flushBrowserCache() }
        findViewById<Button>(R.id.btnUpdateTe2).setOnClickListener { forceAssetUpdate() }
        btnToolsConsole.setOnClickListener { showConsoleTools() }
        btnToolsInspector.setOnClickListener { showInspectorTools() }
        consoleOverlay.setOnClickListener { hideTools() }
        findViewById<View>(R.id.consolePanel).setOnClickListener { /* consume */ }
    }

    private fun initializeAssetsAndRelay() {
        assetManager = EditorAssetManager(this)
        val seeded = assetManager.seedFromApk()
        if (!assetManager.getAssetRoot().isDirectory) {
            throw IllegalStateException("APK assets did not create the local asset root")
        }
        if (seeded) {
            Toast.makeText(
                this,
                "Assets seeded from APK: v${assetManager.getLocalVersion() ?: "?"}",
                Toast.LENGTH_SHORT,
            ).show()
        }

        relay = AndroidFrameworkRelay(
            assetRoot = assetManager.getAssetRoot(),
            assetPathResolver = CefriumAssetRoutes::localPath,
        ) { request -> shellGateway.handle(request) }
        shellGateway = AndroidShellGateway(
            settingsStore = settingsStore,
            httpClient = httpClient,
            onSettingsChanged = ::applySettings,
            diagnosticsProvider = {
                diagnostics.snapshot(
                    JSONObject().apply {
                        put("frameworkBaseUrl", frameworkBaseUrl)
                        put("relayOrigin", relay.browserOrigin)
                        put("assetRootExists", assetManager.getAssetRoot().isDirectory)
                        put("localAssetVersion", assetManager.getLocalVersion() ?: JSONObject.NULL)
                        put("inAppShell", inAppShell)
                    },
                )
            },
            appUrlRewriter = { relay.rewriteFrameworkUrl(it) },
        )
        relay.start(frameworkBaseUrl)
    }

    private fun initializeBrowser() {
        browser = CefriumBrowser.createWithSurface(this)
        browserContainer.addView(
            browser.surfaceContainer,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        browser.surfaceContainer.isFocusable = true
        browser.surfaceContainer.isFocusableInTouchMode = true

        browser.setOnUrlChangedListener { url ->
            runOnUiThread { handleUrlChanged(url) }
        }
        browser.setOnLoadingStateChangedListener { isLoading, canGoBack, _ ->
            runOnUiThread {
                this.canNavigateBack = canGoBack
                if (!isLoading) {
                    browser.evaluateJavaScript(CefriumPagePolicy.installScript())
                }
            }
        }
        browser.setOnRenderProcessTerminatedListener { status, errorCode ->
            runOnUiThread { recoverRenderer(status, errorCode) }
        }
        browser.setPermissionHandler { origin, permissions, callback ->
            val clipboardOnly =
                permissions != 0 &&
                    permissions and CefriumBrowser.PERMISSION_CLIPBOARD == permissions
            callback.respond(clipboardOnly && isRelayOrigin(origin))
        }
        browser.setOnContextMenuListener { menuItems, _ ->
            runOnUiThread { showContextMenu(menuItems) }
        }
        browser.setPullToRefreshEnabled(false)
    }

    private fun restoreOrLoadLauncher() {
        val savedPath = prefs().getString(KEY_LAST_PATH, null)
        if (!savedPath.isNullOrBlank() && isAppPath(savedPath)) {
            browser.loadUrl(relay.url(savedPath))
        } else {
            loadLauncher()
        }
    }

    private fun handleUrlChanged(url: String?) {
        if (url.isNullOrBlank()) return
        val parsed = try {
            URI(url)
        } catch (_: Exception) {
            return
        }
        if (!isRelayOrigin(url)) return

        currentPath = buildString {
            append(parsed.rawPath?.takeIf { it.isNotBlank() } ?: "/")
            parsed.rawQuery?.let { append('?').append(it) }
        }
        prefs().edit().putString(KEY_LAST_PATH, currentPath).apply()
        inAppShell = isAppPath(currentPath)
        nativeHeader.visibility = if (inAppShell) View.VISIBLE else View.GONE
        if (inAppShell) {
            parsed.path
                ?.takeIf { it.startsWith("/app/") }
                ?.removePrefix("/app/")
                ?.substringBefore('/')
                ?.takeIf { it.isNotBlank() }
                ?.let { currentAppId = it }
        }
        updatePersistentNetworkService()
    }

    private fun loadLauncher() {
        if (!::relay.isInitialized || !::browser.isInitialized) return
        currentPath = LAUNCHER_PATH
        inAppShell = false
        nativeHeader.visibility = View.GONE
        prefs().edit().putString(KEY_LAST_PATH, currentPath).apply()
        updatePersistentNetworkService()
        browser.loadUrl(relay.url(LAUNCHER_PATH))
    }

    private fun loadApp(appId: String) {
        currentAppId = appId
        isLocked = false
        findViewById<Button>(R.id.btnLock).text = "Lock"
        browser.loadUrl(relay.url("/app/$appId?gv_native=1"))
    }

    private fun showRecents() {
        if (inAppShell) {
            browser.evaluateJavaScript(
                """
                (() => {
                  try {
                    if (window.teOpenRecentsModal) return window.teOpenRecentsModal();
                    document.getElementById('btn-recents')?.click();
                  } catch (_) {}
                })();
                """.trimIndent(),
            )
            return
        }

        Thread {
            try {
                val request = Request.Builder()
                    .url("$frameworkBaseUrl/api/apps/running")
                    .get()
                    .build()
                httpClient.newCall(request).execute().use { response ->
                    val data = JSONObject(response.body?.string().orEmpty())
                        .optJSONArray("data")
                        ?: return@use
                    val ids = buildList {
                        for (index in 0 until data.length()) {
                            data.optJSONObject(index)
                                ?.optString("app_id")
                                ?.takeIf { it.isNotBlank() }
                                ?.let(::add)
                        }
                    }
                    runOnUiThread { showRecentAppChoices(ids) }
                }
            } catch (error: Exception) {
                runOnUiThread {
                    Toast.makeText(
                        this,
                        "Recents unavailable: ${error.message ?: "framework offline"}",
                        Toast.LENGTH_SHORT,
                    ).show()
                }
            }
        }.start()
    }

    private fun showRecentAppChoices(ids: List<String>) {
        if (ids.isEmpty()) {
            AlertDialog.Builder(this)
                .setMessage("No running apps")
                .setPositiveButton(android.R.string.ok, null)
                .show()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Recents")
            .setItems(ids.toTypedArray()) { _, index -> loadApp(ids[index]) }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun toggleLock() {
        if (!inAppShell) return
        Thread {
            val nextLocked = !isLocked
            val action = if (nextLocked) "lock" else "unlock"
            try {
                val request = Request.Builder()
                    .url("$frameworkBaseUrl/api/apps/$currentAppId/$action")
                    .post("".toRequestBody(JSON_MEDIA_TYPE))
                    .build()
                httpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IllegalStateException("HTTP ${response.code}")
                    }
                }
                isLocked = nextLocked
                runOnUiThread {
                    findViewById<Button>(R.id.btnLock).text =
                        if (isLocked) "Unlock" else "Lock"
                }
            } catch (error: Exception) {
                runOnUiThread {
                    Toast.makeText(
                        this,
                        "App $action failed: ${error.message}",
                        Toast.LENGTH_SHORT,
                    ).show()
                }
            }
        }.start()
    }

    private fun quitCurrentApp() {
        if (!inAppShell) {
            loadLauncher()
            return
        }
        val appId = currentAppId
        Thread {
            try {
                val request = Request.Builder()
                    .url("$frameworkBaseUrl/api/apps/$appId/quit")
                    .post("".toRequestBody(JSON_MEDIA_TYPE))
                    .build()
                httpClient.newCall(request).execute().close()
            } catch (_: Exception) {
            }
            runOnUiThread { loadLauncher() }
        }.start()
    }

    private fun showContextMenu(rawItems: String?) {
        val items = rawItems.orEmpty()
            .lineSequence()
            .mapNotNull { line ->
                val separator = line.indexOf('|')
                if (separator <= 0) return@mapNotNull null
                val id = line.substring(0, separator).toIntOrNull() ?: return@mapNotNull null
                val label = line.substring(separator + 1).trim()
                if (label.isBlank()) null else id to label
            }
            .toList()
        if (items.isEmpty()) {
            browser.contextMenuCommand(CONTEXT_MENU_CANCEL)
            return
        }
        AlertDialog.Builder(this)
            .setItems(items.map { it.second }.toTypedArray()) { _, index ->
                browser.contextMenuCommand(items[index].first)
            }
            .setOnCancelListener {
                browser.contextMenuCommand(CONTEXT_MENU_CANCEL)
            }
            .show()
    }

    private fun recoverRenderer(status: Int, errorCode: Int) {
        Log.e(TAG, "Renderer terminated status=$status errorCode=$errorCode")
        Toast.makeText(this, "Browser renderer restarted", Toast.LENGTH_SHORT).show()
        browser.loadUrl(relay.url(currentPath))
    }

    private fun applySettings(settings: AndroidAppSettings) {
        frameworkBaseUrl = settings.frameworkBaseUrl
        persistentNetworkEnabled = settings.persistentNetworkNotification
        relay.retarget(frameworkBaseUrl)
        runOnUiThread {
            reconnectUiIpc(settings)
            updatePersistentNetworkService()
            Toast.makeText(
                this,
                "Framework target updated",
                Toast.LENGTH_SHORT,
            ).show()
        }
        checkForAssetUpdate()
    }

    private fun connectFrameworkServices(settings: AndroidAppSettings) {
        reconnectUiIpc(settings)
    }

    private fun reconnectUiIpc(settings: AndroidAppSettings) {
        uiIpcClient?.disconnect()
        uiIpcClient = UiIpcClient(
            filter = editorInputFilter,
            imeContextSwitchingEnabled = settings.imeContextSwitchingEnabled,
        ) { active ->
            runOnUiThread {
                if (!::browser.isInitialized) return@runOnUiThread
                val target = currentFocus ?: browser.surfaceContainer
                val inputMethod =
                    getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager
                if (active) target.requestFocus()
                inputMethod?.restartInput(target)
                if (active) inputMethod?.showSoftInput(target, 0)
            }
        }.also { client ->
            client.onConsoleEvent = consoleState::onConsoleEvent
            client.connect(frameworkBaseUrl)
            if (
                ::consoleOverlay.isInitialized &&
                consoleOverlay.visibility == View.VISIBLE &&
                toolsConsoleSelected
            ) {
                client.setConsoleDrawerEnabled(true, CONSOLE_TAIL_LINES)
            }
        }
    }

    private fun checkForAssetUpdate() {
        Thread {
            try {
                val serverVersion = assetManager.checkServerVersion(frameworkBaseUrl) ?: return@Thread
                val installed = assetManager.downloadFromServer(frameworkBaseUrl)
                runOnUiThread {
                    if (installed) {
                        Toast.makeText(
                            this,
                            "Assets updated to v$serverVersion",
                            Toast.LENGTH_SHORT,
                        ).show()
                        consoleTitle.text = "Tools · v$serverVersion"
                        if (inAppShell) {
                            browser.clearCache()
                            browser.reload()
                        }
                    }
                }
            } catch (error: Exception) {
                Log.w(TAG, "Asset update check failed", error)
            }
        }.start()
    }

    private fun forceAssetUpdate() {
        Toast.makeText(this, "Force-updating assets…", Toast.LENGTH_SHORT).show()
        Thread {
            val updated = assetManager.forceUpdateFromServer(frameworkBaseUrl)
            runOnUiThread {
                if (updated) {
                    val version = assetManager.getLocalVersion() ?: "?"
                    consoleTitle.text = "Tools · v$version"
                    Toast.makeText(
                        this,
                        "Assets updated to v$version",
                        Toast.LENGTH_SHORT,
                    ).show()
                    browser.clearCache()
                    browser.reload()
                    hideTools()
                } else {
                    Toast.makeText(this, "Asset update failed", Toast.LENGTH_SHORT).show()
                }
            }
        }.start()
    }

    private fun flushBrowserCache() {
        browser.clearCache()
        browser.reload()
        Toast.makeText(this, "Browser cache flushed", Toast.LENGTH_SHORT).show()
        hideTools()
    }

    private fun toggleTools() {
        if (consoleOverlay.visibility == View.VISIBLE) hideTools() else showTools()
    }

    private fun showTools() {
        consoleOverlay.visibility = View.VISIBLE
        consoleTitle.text = "Tools · v${assetManager.getLocalVersion() ?: "unknown"}"
        showConsoleTools()
    }

    private fun hideTools() {
        consoleOverlay.visibility = View.GONE
        uiIpcClient?.setConsoleDrawerEnabled(false)
        consoleState.resetSession()
    }

    private fun showConsoleTools() {
        toolsConsoleSelected = true
        composeConsoleContainer.visibility = View.VISIBLE
        inspectorPanel.visibility = View.GONE
        btnToolsConsole.isEnabled = false
        btnToolsInspector.isEnabled = true
        consoleState.resetSession()
        loadAndroidDiagnostics()
        uiIpcClient?.setConsoleDrawerEnabled(true, CONSOLE_TAIL_LINES)
    }

    private fun showInspectorTools() {
        toolsConsoleSelected = false
        composeConsoleContainer.visibility = View.GONE
        inspectorPanel.visibility = View.VISIBLE
        btnToolsConsole.isEnabled = true
        btnToolsInspector.isEnabled = false
        uiIpcClient?.setConsoleDrawerEnabled(false)
        consoleState.resetSession()
    }

    private fun loadAndroidDiagnostics() {
        Thread {
            val dump = diagnostics.captureWarningsAndErrors()
            when {
                dump.error != null -> consoleState.appendNativeLog("error", dump.error)
                dump.lines.isEmpty() -> consoleState.appendNativeLog(
                    "info",
                    "No Android warnings or errors in this session",
                )
                else -> dump.lines.forEach { line ->
                    consoleState.appendNativeLog(androidLogcatLevel(line), line)
                }
            }
        }.start()
    }

    private fun updatePersistentNetworkService() {
        if (!persistentNetworkEnabled || !inAppShell) {
            stopService(Intent(this, PersistentNetworkService::class.java))
            return
        }
        if (
            android.os.Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED &&
            !notificationPermissionRequestInFlight &&
            !notificationPermissionDenied
        ) {
            notificationPermissionRequestInFlight = true
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                NOTIFICATION_PERMISSION_REQUEST,
            )
        }
        val intent = Intent(this, PersistentNetworkService::class.java)
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            ContextCompat.startForegroundService(this, intent)
        } else {
            startService(intent)
        }
    }

    private fun isRelayOrigin(rawUrl: String): Boolean {
        return try {
            val expected = URI(relay.browserOrigin)
            val candidate = URI(rawUrl)
            candidate.scheme.equals(expected.scheme, ignoreCase = true) &&
                candidate.host.equals(expected.host, ignoreCase = true) &&
                effectivePort(candidate) == effectivePort(expected)
        } catch (_: Exception) {
            false
        }
    }

    private fun effectivePort(uri: URI): Int =
        if (uri.port >= 0) uri.port else if (uri.scheme == "https") 443 else 80

    private fun isAppPath(path: String): Boolean {
        val pathname = path.substringBefore('?')
        return pathname == "/app" || pathname.startsWith("/app/")
    }

    @Deprecated("Deprecated in Android")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (::browser.isInitialized && browser.onActivityResult(requestCode, resultCode, data)) {
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) {
            notificationPermissionRequestInFlight = false
            notificationPermissionDenied =
                grantResults.isEmpty() ||
                    grantResults[0] != PackageManager.PERMISSION_GRANTED
            updatePersistentNetworkService()
        }
    }

    override fun onResume() {
        super.onResume()
        if (::browser.isInitialized) browser.onResume()
    }

    override fun onPause() {
        if (::browser.isInitialized) browser.onPause()
        super.onPause()
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() {
        when {
            consoleOverlay.visibility == View.VISIBLE -> hideTools()
            ::browser.isInitialized && (canNavigateBack || browser.canGoBack()) -> browser.goBack()
            else -> super.onBackPressed()
        }
    }

    override fun onDestroy() {
        uiIpcClient?.disconnect()
        uiIpcClient = null
        if (::browser.isInitialized) {
            browserContainer.removeView(browser.surfaceContainer)
            browser.close()
        }
        if (::relay.isInitialized) relay.stop()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "CefriumMainActivity"
        private const val LAUNCHER_PATH = "/android-shell/index.html"
        private const val DEFAULT_APP_ID = "file_editor_cm6"
        private const val KEY_LAST_PATH = "last_path"
        private const val CONSOLE_TAIL_LINES = 500
        private const val CONTEXT_MENU_CANCEL = -1
        private const val NOTIFICATION_PERMISSION_REQUEST = 9301
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()
    }
}
