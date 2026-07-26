package com.termux.extensions

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.util.Log
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import android.net.Uri
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
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.BasicSelectionActionDelegate
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.StorageController
import org.mozilla.geckoview.WebExtension
import org.mozilla.geckoview.WebExtensionController
import android.view.inputmethod.InputMethodManager
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : AppCompatActivity() {
    private lateinit var geckoView: FilteredGeckoView
    private lateinit var geckoSession: GeckoSession
    private lateinit var runtime: GeckoRuntime
    private lateinit var nativeHeader: View

    private lateinit var consoleOverlay: FrameLayout
    private lateinit var composeConsoleContainer: ComposeView
    private lateinit var inspectorPanel: FrameLayout
    private lateinit var inspectorGeckoView: GeckoView
    private lateinit var inspectorStatus: TextView
    private lateinit var btnToolsConsole: Button
    private lateinit var btnToolsInspector: Button

    private val editorInputFilter = EditorInputFilter()
    private val composeConsoleState = ComposeConsoleState()
    private var uiIpcClient: UiIpcClient? = null
    private var nativeConsoleWorker: AndroidNativeConsoleWorker? = null
    private var devToolsInspector: GeckoDevToolsInspector? = null
    private var devToolsInspectorEnabled = false
    private var devToolsInspectorStatus = "disabled"
    private var toolsConsoleSelected = true

    private var editorAssetManager: EditorAssetManager? = null
    private var localAssetServer: LocalAssetServer? = null
    private lateinit var androidSettingsStore: AndroidAppSettingsStore
    private lateinit var androidDiagnostics: AndroidDiagnostics
    @Volatile private var lastStartupFailure: String? = null
    private var assetExtension: WebExtension? = null
    private var assetExtensionPort: WebExtension.Port? = null
    @Volatile private var assetInterceptorReady: Boolean = false

    private lateinit var btnConsoleBack: Button
    private lateinit var btnConsoleStart: Button

    private val httpClient = OkHttpClient()
    private val uiHandler = Handler(Looper.getMainLooper())
    private val assetUpdateInFlight = AtomicBoolean(false)

    private var frameworkBaseUrl: String = DEFAULT_FRAMEWORK_URL
    private var currentAppId: String = DEFAULT_APP_ID
    private var isLocked: Boolean = false

    private var canNavigateBack = false

    private var inAppShell: Boolean = true
    private var persistentNetworkNotificationEnabled: Boolean = false
    private var pendingSurfaceRecover: Boolean = false
    private var notificationPermissionRequestInFlight: Boolean = false
    private var persistentNetworkPermissionDenied: Boolean = false
    private var persistentNetworkStartFailed: Boolean = false

    private fun prefs() = getSharedPreferences("gecko_session_state", Context.MODE_PRIVATE)

    private fun persistSessionState(state: GeckoSession.SessionState?) {
        try {
            val serialized = state?.toString()
            prefs().edit().putString("session_state", serialized).apply()
        } catch (_: Exception) {
        }
    }

    private fun loadSavedSessionState(): GeckoSession.SessionState? {
        return try {
            val s = prefs().getString("session_state", null)
            if (s.isNullOrBlank()) null else GeckoSession.SessionState.fromString(s)
        } catch (_: Exception) {
            null
        }
    }

    private fun persistLastUrl(url: String?) {
        try {
            if (url.isNullOrBlank()) return
            prefs().edit().putString("last_url", url).apply()
        } catch (_: Exception) {
        }
    }

    private fun loadLastUrl(): String? {
        return try {
            prefs().getString("last_url", null)
        } catch (_: Exception) {
            null
        }
    }

    private fun shouldRestoreRemoteAppSession(): Boolean {
        val lastUrl = loadLastUrl() ?: return false
        return try {
            val path = Uri.parse(lastUrl).path.orEmpty()
            path == "/app" || path.startsWith("/app/")
        } catch (_: Exception) {
            false
        }
    }

    private fun effectivePort(uri: Uri): Int {
        if (uri.port >= 0) return uri.port
        return if (uri.scheme.equals("https", ignoreCase = true)) 443 else 80
    }

    private fun isFrameworkOrigin(uri: Uri): Boolean {
        val frameworkUri = Uri.parse(frameworkBaseUrl)
        return uri.scheme.equals(frameworkUri.scheme, ignoreCase = true) &&
            uri.host.equals(frameworkUri.host, ignoreCase = true) &&
            effectivePort(uri) == effectivePort(frameworkUri)
    }

    private fun createClipboardSelectionActionDelegate() =
        object : BasicSelectionActionDelegate(this) {
            override fun onShowClipboardPermissionRequest(
                session: GeckoSession,
                permission: GeckoSession.SelectionActionDelegate.ClipboardPermission,
            ): GeckoResult<AllowOrDeny> {
                // This wrapper exposes only the configured framework surface.
                return GeckoResult.fromValue(AllowOrDeny.ALLOW)
            }
        }

    private fun createGeckoSession(): GeckoSession {
        return GeckoSession(
            GeckoSessionSettings.Builder().usePrivateMode(false).build()
        ).apply {
            selectionActionDelegate = createClipboardSelectionActionDelegate()
            historyDelegate = object : GeckoSession.HistoryDelegate {
                override fun onHistoryStateChange(
                    session: GeckoSession,
                    historyList: GeckoSession.HistoryDelegate.HistoryList
                ) {
                    canNavigateBack = historyList.currentIndex > 0
                }
            }
            progressDelegate = object : GeckoSession.ProgressDelegate {
                override fun onSessionStateChange(
                    session: GeckoSession,
                    sessionState: GeckoSession.SessionState
                ) {
                    persistSessionState(sessionState)
                }
            }
            contentDelegate = object : GeckoSession.ContentDelegate {
                override fun onCrash(session: GeckoSession) {
                    runOnUiThread { recoverSessionAfterContentDeath("crash") }
                }

                override fun onKill(session: GeckoSession) {
                    runOnUiThread { recoverSessionAfterContentDeath("kill") }
                }
            }
            promptDelegate = object : GeckoSession.PromptDelegate {
                override fun onAlertPrompt(
                    session: GeckoSession,
                    prompt: GeckoSession.PromptDelegate.AlertPrompt
                ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
                    val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                    runOnUiThread {
                        AlertDialog.Builder(this@MainActivity)
                            .setMessage(prompt.message ?: "")
                            .setPositiveButton(android.R.string.ok) { _, _ ->
                                result.complete(prompt.dismiss())
                            }
                            .setOnCancelListener {
                                result.complete(prompt.dismiss())
                            }
                            .show()
                    }
                    return result
                }

                override fun onButtonPrompt(
                    session: GeckoSession,
                    prompt: GeckoSession.PromptDelegate.ButtonPrompt
                ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
                    val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                    runOnUiThread {
                        AlertDialog.Builder(this@MainActivity)
                            .setMessage(prompt.message ?: "")
                            .setPositiveButton(android.R.string.ok) { _, _ ->
                                result.complete(
                                    prompt.confirm(
                                        GeckoSession.PromptDelegate.ButtonPrompt.Type.POSITIVE
                                    )
                                )
                            }
                            .setNegativeButton(android.R.string.cancel) { _, _ ->
                                result.complete(
                                    prompt.confirm(
                                        GeckoSession.PromptDelegate.ButtonPrompt.Type.NEGATIVE
                                    )
                                )
                            }
                            .setOnCancelListener {
                                result.complete(prompt.dismiss())
                            }
                            .show()
                    }
                    return result
                }

                override fun onTextPrompt(
                    session: GeckoSession,
                    prompt: GeckoSession.PromptDelegate.TextPrompt
                ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
                    val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                    runOnUiThread {
                        val input = EditText(this@MainActivity).apply {
                            setText(prompt.defaultValue ?: "")
                            setSelection(text?.length ?: 0)
                        }
                        AlertDialog.Builder(this@MainActivity)
                            .setMessage(prompt.message ?: "")
                            .setView(input)
                            .setPositiveButton(android.R.string.ok) { _, _ ->
                                val value = input.text?.toString() ?: ""
                                result.complete(prompt.confirm(value))
                            }
                            .setNegativeButton(android.R.string.cancel) { _, _ ->
                                result.complete(prompt.dismiss())
                            }
                            .setOnCancelListener {
                                result.complete(prompt.dismiss())
                            }
                            .show()
                    }
                    return result
                }

                override fun onColorPrompt(
                    session: GeckoSession,
                    prompt: GeckoSession.PromptDelegate.ColorPrompt
                ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
                    val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                    runOnUiThread {
                        var red = 0
                        var green = 0
                        var blue = 0
                        var alpha = 255 // Default to opaque

                        // Try to parse initial color from prompt.defaultValue
                        prompt.defaultValue?.let {
                            try {
                                val color = Color.parseColor(it)
                                red = Color.red(color)
                                green = Color.green(color)
                                blue = Color.blue(color)
                                alpha = Color.alpha(color)
                            } catch (e: IllegalArgumentException) {
                                // Default to black if parsing fails
                                red = 0
                                green = 0
                                blue = 0
                                alpha = 255
                            }
                        }

                        val colorPreview = android.view.View(this@MainActivity).apply {
                            layoutParams = LinearLayout.LayoutParams(
                                dpToPx(50),
                                dpToPx(50)
                            ).apply {
                                setMargins(0, dpToPx(8), 0, dpToPx(8))
                            }
                            setBackgroundColor(Color.argb(alpha, red, green, blue))
                        }

                        val redSeekBar = SeekBar(this@MainActivity).apply { max = 255; progress = red }
                        val greenSeekBar = SeekBar(this@MainActivity).apply { max = 255; progress = green }
                        val blueSeekBar = SeekBar(this@MainActivity).apply { max = 255; progress = blue }
                        val alphaSeekBar = SeekBar(this@MainActivity).apply { max = 255; progress = alpha }

                        val updatePreview = {
                            colorPreview.setBackgroundColor(Color.argb(alpha, red, green, blue))
                        }

                        val listener = object : SeekBar.OnSeekBarChangeListener {
                            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                                when (seekBar) {
                                    redSeekBar -> red = progress
                                    greenSeekBar -> green = progress
                                    blueSeekBar -> blue = progress
                                    alphaSeekBar -> alpha = progress
                                }
                                updatePreview()
                            }

                            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
                            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
                        }

                        redSeekBar.setOnSeekBarChangeListener(listener)
                        greenSeekBar.setOnSeekBarChangeListener(listener)
                        blueSeekBar.setOnSeekBarChangeListener(listener)
                        alphaSeekBar.setOnSeekBarChangeListener(listener)

                        val container = LinearLayout(this@MainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            addView(TextView(this@MainActivity).apply { text = "Preview" })
                            addView(colorPreview)
                            addView(TextView(this@MainActivity).apply { text = "Red" })
                            addView(redSeekBar)
                            addView(TextView(this@MainActivity).apply { text = "Green" })
                            addView(greenSeekBar)
                            addView(TextView(this@MainActivity).apply { text = "Blue" })
                            addView(blueSeekBar)
                            addView(TextView(this@MainActivity).apply { text = "Alpha" })
                            addView(alphaSeekBar)
                        }

                        AlertDialog.Builder(this@MainActivity)
                            .setTitle(prompt.title ?: "Choose color")
                            .setView(container)
                            .setPositiveButton(android.R.string.ok) { _, _ ->
                                val webColorString = if (alpha < 255) {
                                    "rgba($red, $green, $blue, ${String.format("%.2f", alpha / 255f)})"
                                } else {
                                    String.format("#%02X%02X%02X", red, green, blue)
                                }
                                result.complete(prompt.confirm(webColorString))
                            }
                            .setNegativeButton(android.R.string.cancel) { _, _ ->
                                result.complete(prompt.dismiss())
                            }
                            .setOnCancelListener {
                                result.complete(prompt.dismiss())
                            }
                            .show()
                    }
                    return result
                }
            }

            navigationDelegate = object : GeckoSession.NavigationDelegate {
                private fun isAppShellUrl(uri: Uri): Boolean {
                    val path = uri.path ?: return false
                    return path == "/app" || path.startsWith("/app/")
                }

                private fun ensureGvNative(uri: Uri): Uri {
                    val params = uri.queryParameterNames
                    if (params.contains("gv_native")) return uri
                    val builder = uri.buildUpon()
                    val existingQuery = uri.encodedQuery
                    if (existingQuery.isNullOrBlank()) {
                        builder.encodedQuery("gv_native=1")
                    } else {
                        builder.encodedQuery("$existingQuery&gv_native=1")
                    }
                    return builder.build()
                }

                override fun onLoadRequest(
                    session: GeckoSession,
                    request: GeckoSession.NavigationDelegate.LoadRequest
                ): GeckoResult<AllowOrDeny>? {
                    val uri = try {
                        Uri.parse(request.uri)
                    } catch (_: Exception) {
                        return GeckoResult.fromValue(AllowOrDeny.ALLOW)
                    }

                    val scheme = uri.scheme?.lowercase()
                    if (scheme != null && scheme != "http" && scheme != "https") {
                        // Ignore javascript:, about:, etc. so UI state isn't toggled.
                        return GeckoResult.fromValue(AllowOrDeny.ALLOW)
                    }

                    val path = uri.path.orEmpty()
                    if (isFrameworkOrigin(uri) && (path == "/" || path.isEmpty())) {
                        runOnUiThread { loadHome() }
                        return GeckoResult.fromValue(AllowOrDeny.DENY)
                    }

                    val isAppShell = isAppShellUrl(uri)
                    runOnUiThread {
                        inAppShell = isAppShell
                        nativeHeader.visibility = if (inAppShell) View.VISIBLE else View.GONE
                        updatePersistentNetworkService()
                    }

                    if (!isAppShell) {
                        return GeckoResult.fromValue(AllowOrDeny.ALLOW)
                    }

                    val rewritten = ensureGvNative(uri)
                    if (rewritten.toString() == request.uri) {
                        persistLastUrl(request.uri)
                        return GeckoResult.fromValue(AllowOrDeny.ALLOW)
                    }

                    runOnUiThread {
                        persistLastUrl(rewritten.toString())
                        geckoSession.loadUri(rewritten.toString())
                    }
                    return GeckoResult.fromValue(AllowOrDeny.DENY)
                }
            }
        }
    }

    private fun recoverSessionAfterContentDeath(reason: String) {
        if (!requireAssetInterceptor("session recovery")) return
        Log.w("MainActivity", "Gecko content process $reason; recovering session...")

        try {
            if (::geckoSession.isInitialized) {
                try {
                    geckoSession.close()
                } catch (_: Exception) {
                }
            }
        } catch (_: Exception) {
        }

        geckoSession = createGeckoSession()
        try {
            geckoSession.open(runtime)
            devToolsInspector?.rebindTargetSession(geckoSession)
        } catch (_: Exception) {
        }
        try {
            geckoView.setSession(geckoSession)
        } catch (_: Exception) {
        }

        val restored = try {
            val st = loadSavedSessionState()
            if (st != null && shouldRestoreRemoteAppSession()) {
                geckoSession.restoreState(st)
                true
            } else {
                false
            }
        } catch (_: Exception) {
            false
        }

        try {
            geckoSession.setActive(true)
        } catch (_: Exception) {
        }

        if (!restored) {
            val last = loadLastUrl()
            if (!last.isNullOrBlank() && shouldRestoreRemoteAppSession()) {
                try {
                    geckoSession.loadUri(last)
                } catch (_: Exception) {
                }
            } else {
                loadHome()
            }
        }
    }

    private fun dpToPx(dp: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            dp.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        androidDiagnostics = AndroidDiagnostics(applicationContext)
        androidDiagnostics.beginSession()
        androidSettingsStore = AndroidAppSettingsStore(applicationContext)
        applyAndroidSettings(androidSettingsStore.load(), reconnect = false)
        setContentView(R.layout.activity_main)

        geckoView = findViewById(R.id.geckoView)
        geckoView.editorInputFilter = editorInputFilter
        nativeHeader = findViewById(R.id.nativeHeader)

        consoleOverlay = findViewById(R.id.consoleOverlay)
        composeConsoleContainer = findViewById(R.id.composeConsoleContainer)
        inspectorPanel = findViewById(R.id.inspectorPanel)
        inspectorGeckoView = findViewById(R.id.inspectorGeckoView)
        inspectorStatus = findViewById(R.id.inspectorStatus)
        btnToolsConsole = findViewById(R.id.btnToolsConsole)
        btnToolsInspector = findViewById(R.id.btnToolsInspector)
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

        findViewById<Button>(R.id.btnHome).setOnClickListener { loadHome() }
        findViewById<Button>(R.id.btnReload).setOnClickListener {
            if (!::geckoSession.isInitialized || !requireAssetInterceptor("reload")) return@setOnClickListener
            try {
                geckoSession.reload()
            } catch (_: Exception) {
            }
        }
        findViewById<Button>(R.id.btnRecents).setOnClickListener { showRecents() }
        findViewById<Button>(R.id.btnLock).setOnClickListener { toggleLock() }
        findViewById<Button>(R.id.btnQuit).setOnClickListener { quitCurrentApp() }
        findViewById<Button>(R.id.btnConsole).setOnClickListener { toggleConsoleOverlay() }

        btnConsoleBack.setOnClickListener { hideConsoleOverlay() }
        btnConsoleStart.setOnClickListener { flushBrowserCache() }
        btnToolsConsole.setOnClickListener { showConsoleTools() }
        btnToolsInspector.setOnClickListener { showInspectorTools() }

        findViewById<Button>(R.id.btnUpdateTe2).setOnClickListener { updateTe2Ui() }

        // Clicking the dimmed backdrop closes; the panel consumes clicks.
        consoleOverlay.setOnClickListener { hideConsoleOverlay() }
        findViewById<View>(R.id.consolePanel).setOnClickListener { /* consume */ }

        geckoSession = GeckoSession(
            GeckoSessionSettings.Builder().usePrivateMode(false).build()
        ).apply {
            selectionActionDelegate = createClipboardSelectionActionDelegate()
            historyDelegate = object : GeckoSession.HistoryDelegate {
                override fun onHistoryStateChange(
                    session: GeckoSession,
                    historyList: GeckoSession.HistoryDelegate.HistoryList
                ) {
                    canNavigateBack = historyList.currentIndex > 0
                }
            }
            progressDelegate = object : GeckoSession.ProgressDelegate {
                override fun onSessionStateChange(
                    session: GeckoSession,
                    sessionState: GeckoSession.SessionState
                ) {
                    persistSessionState(sessionState)
                }
            }
            contentDelegate = object : GeckoSession.ContentDelegate {
                override fun onCrash(session: GeckoSession) {
                    runOnUiThread { recoverSessionAfterContentDeath("crash") }
                }

                override fun onKill(session: GeckoSession) {
                    runOnUiThread { recoverSessionAfterContentDeath("kill") }
                }
            }
            promptDelegate = object : GeckoSession.PromptDelegate {
                override fun onAlertPrompt(
                    session: GeckoSession,
                    prompt: GeckoSession.PromptDelegate.AlertPrompt
                ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
                    val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                    runOnUiThread {
                        AlertDialog.Builder(this@MainActivity)
                            .setMessage(prompt.message ?: "")
                            .setPositiveButton(android.R.string.ok) { _, _ ->
                                result.complete(prompt.dismiss())
                            }
                            .setOnCancelListener {
                                result.complete(prompt.dismiss())
                            }
                            .show()
                    }
                    return result
                }

                override fun onButtonPrompt(
                    session: GeckoSession,
                    prompt: GeckoSession.PromptDelegate.ButtonPrompt
                ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
                    val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                    runOnUiThread {
                        AlertDialog.Builder(this@MainActivity)
                            .setMessage(prompt.message ?: "")
                            .setPositiveButton(android.R.string.ok) { _, _ ->
                                result.complete(
                                    prompt.confirm(
                                        GeckoSession.PromptDelegate.ButtonPrompt.Type.POSITIVE
                                    )
                                )
                            }
                            .setNegativeButton(android.R.string.cancel) { _, _ ->
                                result.complete(
                                    prompt.confirm(
                                        GeckoSession.PromptDelegate.ButtonPrompt.Type.NEGATIVE
                                    )
                                )
                            }
                            .setOnCancelListener {
                                result.complete(prompt.dismiss())
                            }
                            .show()
                    }
                    return result
                }

                override fun onTextPrompt(
                    session: GeckoSession,
                    prompt: GeckoSession.PromptDelegate.TextPrompt
                ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
                    val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                    runOnUiThread {
                        val input = EditText(this@MainActivity).apply {
                            setText(prompt.defaultValue ?: "")
                            setSelection(text?.length ?: 0)
                        }
                        AlertDialog.Builder(this@MainActivity)
                            .setMessage(prompt.message ?: "")
                            .setView(input)
                            .setPositiveButton(android.R.string.ok) { _, _ ->
                                val value = input.text?.toString() ?: ""
                                result.complete(prompt.confirm(value))
                            }
                            .setNegativeButton(android.R.string.cancel) { _, _ ->
                                result.complete(prompt.dismiss())
                            }
                            .setOnCancelListener {
                                result.complete(prompt.dismiss())
                            }
                            .show()
                    }
                    return result
                }

                override fun onColorPrompt(
                    session: GeckoSession,
                    prompt: GeckoSession.PromptDelegate.ColorPrompt
                ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
                    val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                    runOnUiThread {
                        var red = 0
                        var green = 0
                        var blue = 0
                        var alpha = 255 // Default to opaque

                        // Try to parse initial color from prompt.defaultValue
                        prompt.defaultValue?.let {
                            try {
                                val color = Color.parseColor(it)
                                red = Color.red(color)
                                green = Color.green(color)
                                blue = Color.blue(color)
                                alpha = Color.alpha(color)
                            } catch (e: IllegalArgumentException) {
                                // Default to black if parsing fails
                                red = 0
                                green = 0
                                blue = 0
                                alpha = 255
                            }
                        }

                        val colorPreview = android.view.View(this@MainActivity).apply {
                            layoutParams = LinearLayout.LayoutParams(
                                LinearLayout.LayoutParams.MATCH_PARENT,
                                dpToPx(50) // 50dp height
                            ).apply {
                                bottomMargin = dpToPx(16)
                            }
                            setBackgroundColor(Color.argb(alpha, red, green, blue))
                        }

                        val layout = LinearLayout(this@MainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(dpToPx(24), dpToPx(16), dpToPx(24), dpToPx(16))
                            addView(colorPreview)
                        }

                        // Helper to add a color control (TextView + SeekBar)
                        val addColorControl = { labelText: String, initialValue: Int, onProgressChanged: (Int) -> Unit ->
                            val label = TextView(this@MainActivity).apply {
                                text = labelText
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.WRAP_CONTENT,
                                    LinearLayout.LayoutParams.WRAP_CONTENT
                                ).apply {
                                    topMargin = dpToPx(8)
                                    bottomMargin = dpToPx(4)
                                }
                                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                                setTextColor(Color.WHITE) // Assuming dark theme
                            }
                            val seekBar = SeekBar(this@MainActivity).apply {
                                max = 255
                                progress = initialValue
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.MATCH_PARENT,
                                    LinearLayout.LayoutParams.WRAP_CONTENT
                                )
                                setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                                    override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                                        onProgressChanged(progress)
                                        colorPreview.setBackgroundColor(Color.argb(alpha, red, green, blue))
                                    }
                                    override fun onStartTrackingTouch(seekBar: SeekBar?) {}
                                    override fun onStopTrackingTouch(seekBar: SeekBar?) {}
                                })
                            }
                            layout.addView(label)
                            layout.addView(seekBar)
                            seekBar
                        }

                        val redSeekBar = addColorControl("Red", red) { p -> red = p }
                        val greenSeekBar = addColorControl("Green", green) { p -> green = p }
                        val blueSeekBar = addColorControl("Blue", blue) { p -> blue = p }
                        val alphaSeekBar = addColorControl("Alpha", alpha) { p -> alpha = p }

                        AlertDialog.Builder(this@MainActivity)
                            .setTitle("Select Color")
                            .setView(layout)
                            .setPositiveButton(android.R.string.ok) { _, _ ->
                                // Format color as #AARRGGBB hex string for web, or rgba() if alpha < 255
                                val hexColor = String.format("#%02X%02X%02X%02X", alpha, red, green, blue)
                                val webColorString = if (alpha < 255) {
                                    "rgba($red, $green, $blue, ${String.format("%.2f", alpha / 255f)})"
                                } else {
                                    String.format("#%02X%02X%02X", red, green, blue)
                                }
                                result.complete(prompt.confirm(webColorString))
                            }
                            .setNegativeButton(android.R.string.cancel) { _, _ ->
                                result.complete(prompt.dismiss())
                            }
                            .setOnCancelListener {
                                result.complete(prompt.dismiss())
                            }
                            .show()
                    }
                    return result
                }
            }

            navigationDelegate = object : GeckoSession.NavigationDelegate {
                private fun isAppShellUrl(uri: Uri): Boolean {
                    val path = uri.path ?: return false
                    return path == "/app" || path.startsWith("/app/")
                }

                private fun ensureGvNative(uri: Uri): Uri {
                    val params = uri.queryParameterNames
                    if (params.contains("gv_native")) return uri
                    val builder = uri.buildUpon()
                    val existingQuery = uri.encodedQuery
                    if (existingQuery.isNullOrBlank()) {
                        builder.encodedQuery("gv_native=1")
                    } else {
                        builder.encodedQuery("$existingQuery&gv_native=1")
                    }
                    return builder.build()
                }

                override fun onLoadRequest(
                    session: GeckoSession,
                    request: GeckoSession.NavigationDelegate.LoadRequest
                ): GeckoResult<AllowOrDeny>? {
                    val uri = try {
                        Uri.parse(request.uri)
                    } catch (_: Exception) {
                        return GeckoResult.fromValue(AllowOrDeny.ALLOW)
                    }

                    val scheme = uri.scheme?.lowercase()
                    if (scheme != null && scheme != "http" && scheme != "https") {
                        // Ignore javascript:, about:, etc. so UI state isn't toggled.
                        return GeckoResult.fromValue(AllowOrDeny.ALLOW)
                    }

                    val path = uri.path.orEmpty()
                    if (isFrameworkOrigin(uri) && (path == "/" || path.isEmpty())) {
                        runOnUiThread { loadHome() }
                        return GeckoResult.fromValue(AllowOrDeny.DENY)
                    }

                    val isAppShell = isAppShellUrl(uri)
                    runOnUiThread {
                        inAppShell = isAppShell
                        nativeHeader.visibility = if (inAppShell) View.VISIBLE else View.GONE
                        updatePersistentNetworkService()
                    }

                    if (!isAppShell) {
                        return GeckoResult.fromValue(AllowOrDeny.ALLOW)
                    }

                    val rewritten = ensureGvNative(uri)
                    if (rewritten.toString() == request.uri) {
                        persistLastUrl(request.uri)
                        return GeckoResult.fromValue(AllowOrDeny.ALLOW)
                    }

                    runOnUiThread {
                        persistLastUrl(rewritten.toString())
                        geckoSession.loadUri(rewritten.toString())
                    }
                    return GeckoResult.fromValue(AllowOrDeny.DENY)
                }
            }
        }

        runtime = GeckoRuntimeProvider.get(
            applicationContext,
            androidSettingsStore.load().frameworkHost,
        )
        devToolsInspector = GeckoDevToolsInspector(
            runtime,
            geckoSession,
            inspectorGeckoView,
        ) { status ->
            runOnUiThread { updateDevToolsInspectorStatus(status) }
        }

        // A blank open session starts Gecko's extension process. Restore and
        // navigation remain locked until the local static route is confirmed.
        geckoSession.open(runtime)
        geckoView.setSession(geckoSession)

        initEditorAssets { ready ->
            runOnUiThread {
                if (!ready) {
                    Log.e("MainActivity", "Local asset interceptor failed; Gecko navigation blocked")
                    showFatalStartupToast("Local editor assets unavailable; navigation blocked")
                    return@runOnUiThread
                }
                devToolsInspector?.configure(devToolsInspectorEnabled) {
                    runOnUiThread { unlockGeckoNavigation() }
                }
            }
        }
    }

    private fun unlockGeckoNavigation() {
        if (!assetInterceptorReady) return

        val restored = try {
            val state = loadSavedSessionState()
            if (state != null && shouldRestoreRemoteAppSession()) {
                geckoSession.restoreState(state)
                true
            } else {
                false
            }
        } catch (_: Exception) {
            false
        }

        Log.i("MainActivity", "Asset interceptor ready; Gecko navigation unlocked")
        if (!restored) loadHome()
        wakeFrameworkAndLoad(forceLoadHome = false)
    }

    override fun onResume() {
        super.onResume()
        persistentNetworkPermissionDenied = false
        persistentNetworkStartFailed = false
        try {
            if (::geckoSession.isInitialized) geckoSession.setActive(true)
        } catch (_: Exception) {
        }

        // White-surface recovery: sometimes the renderer/surface detaches on background.
        // Re-attaching the session after a short delay often forces a repaint.
        if (!pendingSurfaceRecover) {
            pendingSurfaceRecover = true
            uiHandler.postDelayed({
                pendingSurfaceRecover = false
                try {
                    if (!::geckoView.isInitialized || !::geckoSession.isInitialized) return@postDelayed
                    try { geckoView.releaseSession() } catch (_: Exception) {}
                    geckoView.setSession(geckoSession)
                    try { geckoSession.setActive(true) } catch (_: Exception) {}
                } catch (_: Exception) {
                }
            }, 300)
        }
    }

    override fun onPause() {
        try {
            if (::geckoSession.isInitialized) geckoSession.setActive(false)
        } catch (_: Exception) {
        }
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

    private fun flushBrowserCache() {
        clearBrowserCachesAndReload(hideToolsAfter = true) { result ->
            Toast.makeText(
                this,
                if (result.isSuccess) "Browser cache flushed" else "Cache flush failed",
                Toast.LENGTH_SHORT,
            ).show()
        }
    }

    private fun updateTe2Ui() {
        Toast.makeText(this, "Force-updating assets…", Toast.LENGTH_SHORT).show()
        forceUpdateAssetsAndReload(showFeedback = true) { result ->
            if (result.isFailure) {
                Toast.makeText(
                    this,
                    "Asset update failed: ${result.exceptionOrNull()?.message}",
                    Toast.LENGTH_SHORT,
                ).show()
            }
        }
    }

    private fun forceUpdateAssetsAndReload(
        showFeedback: Boolean,
        completion: (Result<JSONObject>) -> Unit,
    ) {
        if (!assetUpdateInFlight.compareAndSet(false, true)) {
            runOnUiThread {
                completion(Result.failure(IllegalStateException("asset update already running")))
            }
            return
        }
        val manager = editorAssetManager
        if (manager == null) {
            assetUpdateInFlight.set(false)
            runOnUiThread {
                completion(Result.failure(IllegalStateException("asset manager unavailable")))
            }
            return
        }
        val previousVersion = manager.getLocalVersion()
        Thread {
            try {
                if (!manager.forceUpdateFromServer(frameworkBaseUrl)) {
                    throw IllegalStateException("asset download or installation failed")
                }
                val installedVersion = manager.getLocalVersion()
                    ?: throw IllegalStateException("installed asset version unavailable")
                runOnUiThread {
                    findViewById<TextView>(R.id.consoleTitle)?.let {
                        if (consoleOverlay.visibility == View.VISIBLE) {
                            it.text = "Tools · v$installedVersion"
                        }
                    }
                    clearBrowserCachesAndReload(hideToolsAfter = showFeedback) { cacheResult ->
                        assetUpdateInFlight.set(false)
                        cacheResult.fold(
                            onSuccess = { reloadRequested ->
                                if (showFeedback) {
                                    Toast.makeText(
                                        this,
                                        "Assets updated to v$installedVersion",
                                        Toast.LENGTH_SHORT,
                                    ).show()
                                }
                                completion(
                                    Result.success(
                                        JSONObject().apply {
                                            put("method", ANDROID_ASSET_FORCE_UPDATE_METHOD)
                                            put(
                                                "previousVersion",
                                                previousVersion ?: JSONObject.NULL,
                                            )
                                            put("installedVersion", installedVersion)
                                            put("updated", true)
                                            put("cacheCleared", true)
                                            put("reloadRequested", reloadRequested)
                                        },
                                    ),
                                )
                            },
                            onFailure = { error ->
                                completion(Result.failure(error))
                            },
                        )
                    }
                }
            } catch (e: Exception) {
                assetUpdateInFlight.set(false)
                runOnUiThread {
                    completion(Result.failure(e))
                }
            }
        }.start()
    }

    private fun clearBrowserCachesAndReload(
        hideToolsAfter: Boolean,
        completion: (Result<Boolean>) -> Unit,
    ) {
        if (!::runtime.isInitialized) {
            completion(Result.failure(IllegalStateException("Gecko runtime unavailable")))
            return
        }
        try {
            runtime.storageController
                .clearData(StorageController.ClearFlags.ALL_CACHES)
                .accept(
                    {
                        runOnUiThread {
                            try {
                                val reloadRequested = ::geckoSession.isInitialized
                                if (reloadRequested) geckoSession.reload()
                                if (hideToolsAfter) hideConsoleOverlay()
                                completion(Result.success(reloadRequested))
                            } catch (error: Exception) {
                                completion(Result.failure(error))
                            }
                        }
                    },
                    { error ->
                        runOnUiThread {
                            completion(
                                Result.failure(
                                    IllegalStateException(
                                        "Gecko cache clear failed",
                                        error,
                                    ),
                                ),
                            )
                        }
                    },
                )
        } catch (error: Exception) {
            completion(Result.failure(error))
        }
    }

    private fun connectNativeConsoleWorker(frameworkUrl: String) {
        val worker = nativeConsoleWorker ?: AndroidNativeConsoleWorker(
            workerId = androidNativeConsoleWorkerId(this, "gecko"),
            workerLabel = "android-gecko",
        ) { command, completion ->
            when (command) {
                AndroidNativeConsoleCommand.FORCE_UPDATE_AND_RELOAD ->
                    forceUpdateAssetsAndReload(
                        showFeedback = false,
                        completion = completion,
                    )
            }
        }.also {
            nativeConsoleWorker = it
        }
        worker.connect(frameworkUrl)
    }

    private fun loadHome() {
        if (!::geckoSession.isInitialized) return
        if (!requireAssetInterceptor("home navigation")) return
        inAppShell = false
        nativeHeader.visibility = View.GONE
        updatePersistentNetworkService()
        val server = localAssetServer
        if (server == null || server.port <= 0) {
            showFatalStartupToast("Android launcher server is unavailable")
            return
        }
        val launcherUrl = server.url("/android-shell/index.html")
        persistLastUrl(launcherUrl)
        geckoSession.loadUri(launcherUrl)
    }

    private fun loadApp(appId: String) {
        if (!::geckoSession.isInitialized) return
        if (!requireAssetInterceptor("app navigation")) return
        inAppShell = true
        nativeHeader.visibility = View.VISIBLE
        updatePersistentNetworkService()
        currentAppId = appId
        isLocked = false
        findViewById<Button>(R.id.btnLock).text = "Lock"
        geckoSession.loadUri(frameworkBaseUrl.trimEnd('/') + "/app/" + appId + "?gv_native=1")
    }

    private fun showRecents() {
        if (!::geckoSession.isInitialized) return

        if (inAppShell) {
            // GeckoView doesn't expose a stable JS-eval API across versions; use a javascript: URI.
            geckoSession.loadUri(
                "javascript:(function(){try{if(window.teOpenRecentsModal){window.teOpenRecentsModal();return;}var b=document.getElementById('btn-recents');if(b){b.click();}}catch(e){}})()"
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

    private fun showConsoleOverlay() {
        consoleOverlay.visibility = View.VISIBLE
        showConsoleTools()
        // Show asset version inline with title
        try {
            val ver = editorAssetManager?.getLocalVersion() ?: "unknown"
            findViewById<TextView>(R.id.consoleTitle)?.text = "Tools · v$ver"
        } catch (_: Exception) {}
    }

    private fun hideConsoleOverlay() {
        consoleOverlay.visibility = View.GONE
        devToolsInspector?.setVisible(false)
        uiIpcClient?.setConsoleDrawerEnabled(false)
        composeConsoleState.resetSession()
    }

    private fun toggleConsoleOverlay() {
        if (consoleOverlay.visibility == View.VISIBLE) hideConsoleOverlay() else showConsoleOverlay()
    }

    private fun showConsoleTools() {
        toolsConsoleSelected = true
        composeConsoleContainer.visibility = View.VISIBLE
        inspectorPanel.visibility = View.GONE
        devToolsInspector?.setVisible(false)
        btnToolsConsole.isEnabled = false
        btnToolsInspector.isEnabled = true
        composeConsoleState.resetSession()
        loadAndroidDiagnosticsIntoTools()
        uiIpcClient?.setConsoleDrawerEnabled(true, CONSOLE_TAIL_LINES)
    }

    private fun showInspectorTools() {
        toolsConsoleSelected = false
        composeConsoleContainer.visibility = View.GONE
        inspectorPanel.visibility = View.VISIBLE
        btnToolsConsole.isEnabled = true
        btnToolsInspector.isEnabled = false
        uiIpcClient?.setConsoleDrawerEnabled(false)
        composeConsoleState.resetSession()
        updateDevToolsInspectorSurface()
    }

    private fun updateDevToolsInspectorStatus(status: String) {
        devToolsInspectorStatus = status
        if (status.startsWith("error:")) {
            Log.w("MainActivity", "Native developer tools: $status")
        } else {
            Log.i("MainActivity", "Native developer tools: $status")
        }
        if (::inspectorStatus.isInitialized) updateDevToolsInspectorSurface()
    }

    private fun updateDevToolsInspectorSurface() {
        val inspectorSelected =
            ::consoleOverlay.isInitialized &&
                consoleOverlay.visibility == View.VISIBLE &&
                !toolsConsoleSelected
        val showClient =
            inspectorSelected &&
                devToolsInspectorEnabled &&
                !devToolsInspectorStatus.startsWith("error:")
        inspectorStatus.text = when {
            !devToolsInspectorEnabled ->
                "Enable native developer tools in Android Settings."
            devToolsInspectorStatus.startsWith("error:") ->
                "Developer tools $devToolsInspectorStatus"
            else -> "Developer tools: $devToolsInspectorStatus"
        }
        inspectorStatus.visibility =
            if (inspectorSelected && !showClient) View.VISIBLE else View.GONE
        devToolsInspector?.setVisible(showClient)
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
        put("assetInterceptorReady", assetInterceptorReady)
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

    /**
     * Seed bundled editor assets to filesDir and start the local asset server.
     * Must be called after runtime is available but before pages load.
     */
    private fun initEditorAssets(onReady: (Boolean) -> Unit) {
        try {
            val mgr = EditorAssetManager(this)
            editorAssetManager = mgr

            // Seed from APK (no-op if version matches)
            val seeded = mgr.seedFromApk()
            if (seeded) {
                val ver = mgr.getLocalVersion() ?: "?"
                Toast.makeText(this, "Assets seeded from APK: v$ver", Toast.LENGTH_SHORT).show()
            }

            if (!mgr.getAssetRoot().exists()) {
                recordStartupFailure("APK editor asset seed did not create the local asset root")
                onReady(false)
                return
            }

            // Start local file server
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
            Log.i("MainActivity", "Local asset server on port ${server.port}")

            // Install the asset intercept WebExtension
            if (server.port <= 0) {
                recordStartupFailure("Local asset server did not bind a port")
                onReady(false)
                return
            }
            installAssetExtension(server.port, onReady)
        } catch (e: Exception) {
            recordStartupFailure("Local launcher initialization failed", e)
            onReady(false)
        }
    }

    private fun installAssetExtension(assetPort: Int, onReady: (Boolean) -> Unit) {
        val completed = AtomicBoolean(false)
        lateinit var timeout: Runnable

        fun completeReady() {
            if (!completed.compareAndSet(false, true)) return
            assetInterceptorReady = true
            lastStartupFailure = null
            uiHandler.removeCallbacks(timeout)
            onReady(true)
        }

        fun completeFailure(error: String) {
            if (!completed.compareAndSet(false, true)) return
            assetInterceptorReady = false
            lastStartupFailure = error
            uiHandler.removeCallbacks(timeout)
            Log.e("MainActivity", error)
            onReady(false)
        }

        timeout = Runnable {
            completeFailure("Timed out waiting for asset interceptor acknowledgement")
        }
        uiHandler.postDelayed(timeout, ASSET_INTERCEPT_READY_TIMEOUT_MS)

        val extLocation = "resource://android/assets/asset_intercept/"
        runtime.webExtensionController
            .ensureBuiltIn(extLocation, "asset_intercept@mrselect6")
            .accept(
                { extension ->
                    val ext = extension ?: run {
                        completeFailure("Asset extension install returned no extension")
                        return@accept
                    }
                    assetExtension = ext
                    Log.i(
                        "MainActivity",
                        "Asset intercept extension ready id=${ext.id} version=${ext.metaData.version}",
                    )

                    // Send the asset server port to the extension via MessageDelegate
                    val delegate = object : WebExtension.MessageDelegate {
                        override fun onConnect(port: WebExtension.Port) {
                            assetExtensionPort = port
                            port.setDelegate(object : WebExtension.PortDelegate {
                                override fun onPortMessage(
                                    message: Any,
                                    source: WebExtension.Port,
                                ) {
                                    val payload = message as? JSONObject ?: return
                                    if (
                                        payload.optString("type") == "asset_intercept_ready" &&
                                        payload.optInt("port") == assetPort
                                    ) {
                                        Log.i(
                                            "MainActivity",
                                            "Asset interceptor acknowledged local port $assetPort",
                                        )
                                        completeReady()
                                    }
                                }

                                override fun onDisconnect(source: WebExtension.Port) {
                                    if (assetExtensionPort === source) assetExtensionPort = null
                                    assetInterceptorReady = false
                                    Log.e("MainActivity", "Asset interceptor native port disconnected")
                                }
                            })
                            val msg = JSONObject().apply {
                                put("type", "set_asset_port")
                                put("port", assetPort)
                            }
                            port.postMessage(msg)
                            Log.i("MainActivity", "Sent asset port $assetPort to extension")
                        }

                        override fun onMessage(
                            nativeApp: String,
                            message: Any,
                            sender: WebExtension.MessageSender
                        ): GeckoResult<Any>? = null
                    }

                    // Register for background script messaging
                    ext.setMessageDelegate(delegate, "browser")

                    try {
                        runtime.webExtensionController.enable(
                            ext,
                            WebExtensionController.EnableSource.APP,
                        )
                    } catch (e: Exception) {
                        Log.w("MainActivity", "Asset extension enable request failed", e)
                    }

                    Log.i("MainActivity", "Asset intercept extension installed")
                },
                { e ->
                    completeFailure("Asset extension install failed: ${e?.message}")
                }
            )
    }

    private fun requireAssetInterceptor(action: String): Boolean {
        if (assetInterceptorReady) return true
        val detail = "Blocked $action while local asset interceptor is unavailable"
        Log.e("MainActivity", detail)
        showFatalStartupToast(detail)
        return false
    }

    private fun releaseAssetInterceptor() {
        // GeckoRuntime survives activity recreation, so its native port must not
        // retain the destroyed activity's delegates or local-server port.
        assetInterceptorReady = false
        try {
            assetExtension?.setMessageDelegate(null, "browser")
        } catch (e: Exception) {
            Log.w("MainActivity", "Failed to clear asset extension message delegate", e)
        }
        try {
            assetExtensionPort?.setDelegate(null)
            assetExtensionPort?.disconnect()
        } catch (e: Exception) {
            Log.w("MainActivity", "Failed to disconnect asset extension native port", e)
        }
        assetExtensionPort = null
        assetExtension = null
        Log.i("MainActivity", "Released asset interceptor for activity teardown")
    }

    private fun applyAndroidSettings(settings: AndroidAppSettings, reconnect: Boolean) {
        val devToolsSettingChanged =
            devToolsInspectorEnabled != settings.devToolsInspectorEnabled
        frameworkBaseUrl = settings.frameworkBaseUrl
        persistentNetworkNotificationEnabled = settings.persistentNetworkNotification
        devToolsInspectorEnabled = settings.devToolsInspectorEnabled
        if (!reconnect) return

        runOnUiThread {
            updatePersistentNetworkService()
        }
        uiIpcClient?.setImeContextSwitchingEnabled(settings.imeContextSwitchingEnabled)
        uiIpcClient?.disconnect()
        uiIpcClient = null
        nativeConsoleWorker?.disconnect()
        if (devToolsSettingChanged) {
            runOnUiThread {
                updateDevToolsInspectorStatus(
                    if (devToolsInspectorEnabled) "starting" else "stopping",
                )
                devToolsInspector?.configure(devToolsInspectorEnabled) { configured ->
                    runOnUiThread {
                        updateDevToolsInspectorSurface()
                        if (configured && inAppShell && ::geckoSession.isInitialized) {
                            geckoSession.reload()
                            Toast.makeText(
                                this,
                                "Developer tools updated; app page reloaded",
                                Toast.LENGTH_SHORT,
                            ).show()
                        }
                    }
                }
            }
        }
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
                android.util.Log.w("MainActivity", "Asset server check failed", e)
            }

            connectNativeConsoleWorker(frameworkUrl)

            // Connect IME filter IPC after server URL is known
            try {
                uiIpcClient?.disconnect()
                uiIpcClient = UiIpcClient(
                    filter = editorInputFilter,
                    imeContextSwitchingEnabled = settings.imeContextSwitchingEnabled,
                ) { active ->
                    runOnUiThread {
                        val imm = getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager
                        if (active) {
                            geckoView.requestFocus()
                            imm?.restartInput(geckoView)
                            imm?.showSoftInput(geckoView, 0)
                        } else {
                            imm?.restartInput(geckoView)
                        }
                    }
                }
                uiIpcClient?.onConsoleEvent = { eventName, data ->
                    composeConsoleState.onConsoleEvent(eventName, data)
                }
                uiIpcClient?.connect(frameworkUrl)
                if (consoleOverlay.visibility == View.VISIBLE && toolsConsoleSelected) {
                    uiIpcClient?.setConsoleDrawerEnabled(true, CONSOLE_TAIL_LINES)
                }
            } catch (e: Exception) {
                android.util.Log.w("MainActivity", "UiIpcClient setup failed", e)
            }

            runOnUiThread {
                if (forceLoadHome) {
                    loadHome()
                } else {
                    // If we restored session state, don't clobber it by forcing a fresh home load.
                    // Still apply native side effects (header + foreground service decision) based on current URL.
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

    override fun onBackPressed() {
        if (::geckoSession.isInitialized && canNavigateBack) {
            geckoSession.goBack()
            return
        }
        super.onBackPressed()
    }

    override fun onDestroy() {
        uiIpcClient?.disconnect()
        uiIpcClient = null
        nativeConsoleWorker?.disconnect()
        nativeConsoleWorker = null
        devToolsInspector?.release()
        devToolsInspector = null
        releaseAssetInterceptor()
        localAssetServer?.stop()
        localAssetServer = null
        if (::geckoSession.isInitialized) {
            geckoSession.close()
        }
        super.onDestroy()
    }

    companion object {
        private const val CONSOLE_TAIL_LINES = 500
        private const val DEFAULT_FRAMEWORK_URL = "http://127.0.0.1:8089"
        private const val ASSET_INTERCEPT_READY_TIMEOUT_MS = 10_000L
        private const val IPC_SLEEP_BASE_URL = "http://127.0.0.1:9100"
        private const val DEFAULT_APP_ID = "file_editor_cm6"
    }
}
