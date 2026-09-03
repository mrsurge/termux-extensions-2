package com.termux.extensions

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.FrameLayout
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.ui.platform.ComposeView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import com.cefrium.CefriumBrowser
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URI
import java.util.IdentityHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : AppCompatActivity() {
    private lateinit var browser: CefriumBrowser
    private lateinit var selectionIntegration: CefriumSelectionIntegration
    private var devToolsRuntime: CefriumDevToolsRuntime? = null
    private var inspectorBrowser: CefriumBrowser? = null
    private var processesBrowser: CefriumBrowser? = null
    private var processesLoadedUrl: String? = null
    private lateinit var browserContainer: FrameLayout
    private lateinit var nativeHeader: View
    private lateinit var consoleOverlay: FrameLayout
    private lateinit var composeConsoleContainer: ComposeView
    private lateinit var inspectorPanel: FrameLayout
    private lateinit var inspectorBrowserContainer: FrameLayout
    private lateinit var inspectorStatus: TextView
    private lateinit var inspectorTargetPicker: Spinner
    private lateinit var inspectorTargetAdapter: ArrayAdapter<String>
    private lateinit var processesPanel: FrameLayout
    private lateinit var btnToolsConsole: Button
    private lateinit var btnToolsInspector: Button
    private lateinit var btnToolsProcesses: Button
    private lateinit var consoleTitle: TextView

    private lateinit var settingsStore: AndroidAppSettingsStore
    private lateinit var diagnostics: AndroidDiagnostics
    private lateinit var assetManager: EditorAssetManager
    private lateinit var shellGateway: AndroidShellGateway
    private lateinit var toolsStateStore: AndroidToolsStateStore
    private lateinit var sidebarPresentationStore: AndroidSidebarPresentationStore

    private val editorInputFilter = EditorInputFilter()
    private val imeDismissalReducer = CefriumImeDismissalReducer()
    private val consoleState = ComposeConsoleState()
    private val uiHandler = Handler(Looper.getMainLooper())
    private val appHealthProbeInFlight = AtomicBoolean(false)
    private var clientRuntimeService: PersistentNetworkService? = null
    private var clientRuntimeBound = false
    private var clientInitializationStarted = false
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
    private var toolsState = AndroidToolsState()
    private var toolsSelectedTab = NativeToolsTab.CONSOLE
    private var devToolsRunProfilesEnabled = false
    private var devToolsDebugEnabled = false
    private val devToolsInspectorEnabled: Boolean
        get() = devToolsRunProfilesEnabled || devToolsDebugEnabled
    private var devToolsStatus = "disabled"
    private var inspectorClientReady = false
    private var inspectorPageLoaded = false
    private var inspectorDeliveredGeneration = 0L
    private var inspectorInitialTargetNudgeRequested = false
    private var inspectorInitialTargetNudgeCompleted = false
    private var inspectorPickerUpdating = false
    private var inspectorTargets = emptyList<CefriumDevToolsTarget>()
    private var inspectorActiveTargetId: String? = null
    private var mainBrowserReady = false
    private var androidDiagnosticsLoadedForTools = false
    private var activityResumed = false
    private var activeImeOwner: String? = null
    private var appHealthFailureCount = 0
    private val appHealthCheckRunnable = Runnable { runAppHealthProbe() }
    private var navigationGeneration = 0L
    private var persistentNetworkEnabled = false
    private var pendingColdRestorePath: String? = null
    private var notificationPermissionRequestInFlight = false
    private var notificationPermissionDenied = false

    private val devToolsListener = object : CefriumDevToolsRuntime.Listener {
        override fun onStatusChanged(status: String) {
            runOnUiThread {
                devToolsStatus = status
                updateInspectorSurface()
            }
        }

        override fun onTargetsChanged(
            targets: List<CefriumDevToolsTarget>,
            activeTargetId: String?,
        ) {
            runOnUiThread {
                inspectorTargets = targets
                inspectorActiveTargetId = activeTargetId
                if (
                    activeTargetId != null &&
                    activeTargetId != toolsState.inspectorTargetId
                ) {
                    persistToolsState(inspectorTargetId = activeTargetId)
                }
                renderInspectorTargets()
                publishInspectorTargetsToPage()
                updateInspectorSurface()
                performInitialInspectorTargetNudge()
            }
        }

        override fun onTargetReset(generation: Long) {
            runOnUiThread {
                deliverInspectorTargetReset(generation)
                updateInspectorSurface()
            }
        }

        override fun onTargetWaiting() {
            runOnUiThread {
                inspectorDeliveredGeneration = 0L
                sendInspectorMessage(JSONObject().put("type", "target_waiting"))
                updateInspectorSurface()
            }
        }

        override fun onProtocolMessage(payload: String) {
            runOnUiThread {
                sendInspectorMessage(
                    JSONObject()
                        .put("type", "protocol")
                        .put("payload", payload),
                )
            }
        }
    }

    private val clientRuntimeObserver = object : AndroidClientRuntimeObserver {
        override fun onRuntimeStateChanged(snapshot: AndroidClientRuntimeSnapshot) {
            if (!snapshot.projectionReady) return
            runOnUiThread { completePendingColdRestore() }
        }

        override fun onImeContextChanged(active: Boolean, owner: String?) {
            runOnUiThread {
                activeImeOwner = owner.takeIf { active }
                editorInputFilter.isActive = active
            }
        }

        override fun onConsoleEvent(eventName: String, data: JSONObject) {
            consoleState.onConsoleEvent(eventName, data)
        }

        override fun onNativeConsoleCommand(
            command: AndroidNativeConsoleCommand,
            completion: (Result<JSONObject>) -> Unit,
        ): Boolean {
            when (command) {
                AndroidNativeConsoleCommand.FORCE_UPDATE_AND_RELOAD ->
                    forceAssetUpdate(showFeedback = false, completion = completion)
                AndroidNativeConsoleCommand.DEVTOOLS_STATE_GET,
                AndroidNativeConsoleCommand.DEVTOOLS_TELEMETRY_CLEAR -> runOnUiThread {
                    val snapshot = devToolsRuntime?.debugSnapshot()
                        ?: JSONObject()
                            .put("available", true)
                            .put("renderer", "cefrium")
                            .put("enabled", false)
                            .put("status", devToolsStatus)
                    snapshot
                        .put("configuredEnabled", devToolsInspectorEnabled)
                        .put("runProfilesEnabled", devToolsRunProfilesEnabled)
                        .put("debugTargetsEnabled", devToolsDebugEnabled)
                        .put("appShellActive", inAppShell)
                        .put("mainBrowserReady", mainBrowserReady)
                        .put(
                            "registeredRuntimeSurfaceCount",
                            clientRuntimeService?.devRuntimeSurfaceSnapshot()?.size ?: 0,
                        )
                        .put("inspectorPageLoaded", inspectorPageLoaded)
                        .put("inspectorClientReady", inspectorClientReady)
                        .put("inspectorDeliveredGeneration", inspectorDeliveredGeneration)
                        .put(
                            "inspectorInitialTargetNudgeRequested",
                            inspectorInitialTargetNudgeRequested,
                        )
                        .put(
                            "inspectorInitialTargetNudgeCompleted",
                            inspectorInitialTargetNudgeCompleted,
                        )
                        .put(
                            "inspectorDocumentUrl",
                            inspectorBrowser?.url ?: JSONObject.NULL,
                        )
                        .put(
                            "inspectorUiActiveTargetId",
                            inspectorActiveTargetId ?: JSONObject.NULL,
                        )
                        .put("inspectorUiTargetCount", inspectorTargets.size)
                        .put("toolsSelectedTab", toolsSelectedTab.storageValue)
                        .put(
                            "toolsOverlayVisible",
                            ::consoleOverlay.isInitialized &&
                                consoleOverlay.visibility == View.VISIBLE,
                        )
                    completion(Result.success(snapshot))
                }
            }
            return true
        }
    }

    private val clientRuntimeConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val service = (binder as? PersistentNetworkService.LocalBinder)?.service ?: return
            clientRuntimeService = service
            clientRuntimeBound = true
            service.addObserver(clientRuntimeObserver)
            service.configure(settingsStore.load())
            service.setConsoleDrawerEnabled(
                ::consoleOverlay.isInitialized &&
                    consoleOverlay.visibility == View.VISIBLE &&
                    toolsSelectedTab == NativeToolsTab.CONSOLE,
                CONSOLE_TAIL_LINES,
            )
            syncDevToolsRuntimePolicy()
            if (!clientInitializationStarted) {
                clientInitializationStarted = true
                initializeClient()
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            clientRuntimeBound = false
            clientRuntimeService = null
        }
    }

    private fun prefs() =
        getSharedPreferences("cefrium_session_state", Context.MODE_PRIVATE)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        diagnostics = AndroidDiagnostics(applicationContext)
        diagnostics.beginSession()
        settingsStore = AndroidAppSettingsStore(applicationContext)
        sidebarPresentationStore = AndroidSidebarPresentationStore(applicationContext)
        toolsStateStore = AndroidToolsStateStore(applicationContext)
        toolsState = toolsStateStore.load()
        toolsSelectedTab = toolsState.selectedTab
        val settings = settingsStore.load()
        frameworkBaseUrl = settings.frameworkBaseUrl
        persistentNetworkEnabled = settings.persistentNetworkNotification
        devToolsRunProfilesEnabled = settings.devToolsRunProfilesEnabled
        devToolsDebugEnabled = settings.devToolsDebugEnabled

        setContentView(R.layout.activity_main)
        bindViews()
        bindControls()

        startService(PersistentNetworkService.runtimeIntent(this))
        bindService(
            Intent(this, PersistentNetworkService::class.java),
            clientRuntimeConnection,
            Context.BIND_AUTO_CREATE,
        )
    }

    private fun initializeClient() {
        try {
            initializeAssetsAndRelay()
            initializeBrowser()
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
        inspectorBrowserContainer = findViewById(R.id.inspectorBrowserContainer)
        inspectorStatus = findViewById(R.id.inspectorStatus)
        inspectorTargetPicker = findViewById(R.id.inspectorTargetPicker)
        processesPanel = findViewById(R.id.processesPanel)
        btnToolsConsole = findViewById(R.id.btnToolsConsole)
        btnToolsInspector = findViewById(R.id.btnToolsInspector)
        btnToolsProcesses = findViewById(R.id.btnToolsProcesses)
        consoleTitle = findViewById(R.id.consoleTitle)

        consoleState.bind(
            composeConsoleContainer,
            onSendEval = { code, target ->
                clientRuntimeService?.sendConsoleEval(code, target)
            },
            onRequestClear = { clientRuntimeService?.sendConsoleClear() },
        )
        inspectorTargetAdapter = ArrayAdapter<String>(
            this,
            android.R.layout.simple_spinner_item,
            mutableListOf("Waiting for inspected page..."),
        ).apply {
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }
        inspectorTargetPicker.adapter = inspectorTargetAdapter
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
        btnToolsProcesses.setOnClickListener { showProcessesTools() }
        inspectorTargetPicker.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(
                parent: AdapterView<*>?,
                view: View?,
                position: Int,
                id: Long,
            ) {
                if (inspectorPickerUpdating) return
                val target = inspectorTargets.getOrNull(position) ?: return
                if (target.targetId == inspectorActiveTargetId) return
                persistToolsState(inspectorTargetId = target.targetId)
                devToolsRuntime?.selectTarget(target.targetId)
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
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

        val runtimeService = clientRuntimeService
            ?: throw IllegalStateException("Android client runtime is not bound")
        shellGateway = AndroidShellGateway(
            settingsStore = settingsStore,
            httpClient = httpClient,
            onSettingsChanged = ::applySettings,
            diagnosticsProvider = {
                diagnostics.snapshot(
                    JSONObject().apply {
                        put("frameworkBaseUrl", frameworkBaseUrl)
                        put("relayOrigin", runtimeService.browserFrameworkBaseUrl())
                        put("assetRootExists", assetManager.getAssetRoot().isDirectory)
                        put("localAssetVersion", assetManager.getLocalVersion() ?: JSONObject.NULL)
                        put("inAppShell", inAppShell)
                    },
                )
            },
            appUrlRewriter = runtimeService::rewriteFrameworkUrl,
            nativeRenderer = "cefrium",
            settingsRuntimeProvider = { runtimeService.snapshot().toJson() },
            onOpenBatterySettings = runtimeService::openBatteryOptimizationSettings,
        )
        runtimeService.configureLocalRelayRoutes(
            assetRoot = assetManager.getAssetRoot(),
            assetPathResolver = CefriumAssetRoutes::localPath,
            requestHandler = { request ->
                CefriumInspectorAssetRoute.handle(assets, request)
                    ?: shellGateway.handle(request)
            },
        )
    }

    private fun initializeBrowser() {
        browser = CefriumBrowser.createWithSurface(this)
        selectionIntegration = CefriumSelectionIntegration(browser)
        browser.setQueryHandler { _, request, origin, callback ->
            handleNativeQuery(request, origin, callback)
        }
        browserContainer.addView(
            browser.surfaceContainer,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        browser.surfaceContainer.isFocusable = true
        browser.surfaceContainer.isFocusableInTouchMode = true
        installImeInsetsObserver()

        browser.setOnUrlChangedListener { url ->
            runOnUiThread { handleUrlChanged(url) }
        }
        browser.setOnLoadingStateChangedListener { isLoading, canGoBack, _ ->
            runOnUiThread {
                this.canNavigateBack = canGoBack
                if (isLoading) {
                    mainBrowserReady = false
                }
                if (!isLoading) {
                    selectionIntegration.installWhenReady()
                    browser.evaluateJavaScript(CefriumPagePolicy.installScript())
                    if (
                        inAppShell &&
                        browser.url.isNotBlank() &&
                        isRelayOrigin(browser.url)
                    ) {
                        mainBrowserReady = true
                        ensureInspectorBrowser()
                    }
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
        browser.surfaceContainer.post { selectionIntegration.installWhenReady() }
        configureDevToolsInspector()
        restoreToolsSurfaceState()
    }

    private fun installImeInsetsObserver() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        val decorView = window.decorView
        var latestImeInsets = ViewCompat.getRootWindowInsets(decorView)
        var lastAppliedImeVisibility: Boolean? = null
        val imeAnimationStartVisibility =
            IdentityHashMap<WindowInsetsAnimationCompat, Boolean>()

        fun imeState(imeVisible: Boolean): CefriumImeVisibilityState =
            CefriumImeVisibilityState(
                imeVisible = imeVisible,
                activityResumed = activityResumed,
                windowFocused = hasWindowFocus(),
                appPageReady = inAppShell,
                nativeOverlayHidden = consoleOverlay.visibility != View.VISIBLE,
            )

        fun logImeTransition(
            stage: String,
            imeVisible: Boolean? = null,
            startedVisible: Boolean? = null,
            dispatchRequested: Boolean = false,
        ) {
            Log.d(
                TAG,
                "IME dismissal stage=$stage" +
                    " visible=${imeVisible ?: "unknown"}" +
                    " startedVisible=${startedVisible ?: "unknown"}" +
                    " owner=${activeImeOwner ?: "none"}" +
                    " resumed=$activityResumed" +
                    " focused=${hasWindowFocus()}" +
                    " appPage=$inAppShell" +
                    " overlayHidden=${consoleOverlay.visibility != View.VISIBLE}" +
                    " dispatch=$dispatchRequested",
            )
        }

        fun dispatchImeDismissalIf(
            stage: String,
            requested: Boolean,
            imeVisible: Boolean? = null,
            startedVisible: Boolean? = null,
        ) {
            logImeTransition(
                stage = stage,
                imeVisible = imeVisible,
                startedVisible = startedVisible,
                dispatchRequested = requested,
            )
            if (requested && ::browser.isInitialized) {
                browser.evaluateJavaScript(CefriumPagePolicy.imeDismissalScript())
            }
        }

        fun observeAppliedImeInsets(insets: WindowInsetsCompat) {
            latestImeInsets = insets
            val visible = insets.isVisible(WindowInsetsCompat.Type.ime())
            imeDismissalReducer.observe(imeState(visible))
            if (lastAppliedImeVisibility != visible) {
                lastAppliedImeVisibility = visible
                logImeTransition(stage = "applied", imeVisible = visible)
            }
        }

        latestImeInsets?.let(::observeAppliedImeInsets)
        ViewCompat.setOnApplyWindowInsetsListener(browserContainer) { _, insets ->
            observeAppliedImeInsets(insets)
            insets
        }
        ViewCompat.requestApplyInsets(browserContainer)
        ViewCompat.setWindowInsetsAnimationCallback(
            decorView,
            object : WindowInsetsAnimationCompat.Callback(
                WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE,
            ) {
                override fun onPrepare(animation: WindowInsetsAnimationCompat) {
                    if (animation.typeMask and WindowInsetsCompat.Type.ime() == 0) return
                    val startInsets = ViewCompat.getRootWindowInsets(decorView)
                        ?: latestImeInsets
                        ?: return
                    val startedVisible = startInsets.isVisible(WindowInsetsCompat.Type.ime())
                    imeAnimationStartVisibility[animation] = startedVisible
                    logImeTransition(
                        stage = "prepare",
                        imeVisible = startedVisible,
                        startedVisible = startedVisible,
                    )
                }

                override fun onStart(
                    animation: WindowInsetsAnimationCompat,
                    bounds: WindowInsetsAnimationCompat.BoundsCompat,
                ): WindowInsetsAnimationCompat.BoundsCompat {
                    if (animation.typeMask and WindowInsetsCompat.Type.ime() == 0) {
                        return bounds
                    }
                    val startedVisible = imeAnimationStartVisibility[animation]
                        ?: return bounds
                    val endInsets = ViewCompat.getRootWindowInsets(decorView)
                        ?: latestImeInsets
                        ?: return bounds
                    val endsVisible = endInsets.isVisible(WindowInsetsCompat.Type.ime())
                    val releaseRequested = startedVisible &&
                        !endsVisible &&
                        imeDismissalReducer.beginHideAnimation(
                            imeState(imeVisible = true),
                        )
                    logImeTransition(
                        stage = "start",
                        imeVisible = endsVisible,
                        startedVisible = startedVisible,
                        dispatchRequested = releaseRequested,
                    )
                    if (releaseRequested && ::browser.isInitialized) {
                        browser.evaluateJavaScript(CefriumPagePolicy.imeDismissalScript())
                    }
                    return bounds
                }

                override fun onProgress(
                    insets: WindowInsetsCompat,
                    runningAnimations: MutableList<WindowInsetsAnimationCompat>,
                ): WindowInsetsCompat {
                    if (
                        runningAnimations.any {
                            it.typeMask and WindowInsetsCompat.Type.ime() != 0
                        }
                    ) {
                        latestImeInsets = insets
                    }
                    return insets
                }

                override fun onEnd(animation: WindowInsetsAnimationCompat) {
                    if (animation.typeMask and WindowInsetsCompat.Type.ime() == 0) return
                    val startedVisible = imeAnimationStartVisibility.remove(animation)
                    val finalInsets = ViewCompat.getRootWindowInsets(decorView)
                        ?: latestImeInsets
                        ?: return
                    latestImeInsets = finalInsets
                    val finalVisible = finalInsets.isVisible(WindowInsetsCompat.Type.ime())
                    dispatchImeDismissalIf(
                        stage = "end",
                        requested = imeDismissalReducer.completeHideAnimation(
                            imeState(finalVisible),
                        ),
                        imeVisible = finalVisible,
                        startedVisible = startedVisible,
                    )
                }
            },
        )
    }

    private fun restoreOrLoadLauncher() {
        val rawSavedPath = prefs().getString(KEY_LAST_PATH, null)
        val savedPath = rawSavedPath?.let(::canonicalizeCodeTe2AppPath)
        if (savedPath != null && savedPath != rawSavedPath) {
            prefs().edit().putString(KEY_LAST_PATH, savedPath).apply()
        }
        val runtime = clientRuntimeService ?: return
        val savedAppPath = savedPath?.takeIf(::isAppPath)
        when (
            androidColdRestoreDecision(
                hasSavedRemoteApp = savedAppPath != null,
                projectionReady = runtime.snapshot().projectionReady,
            )
        ) {
            AndroidColdRestoreDecision.LOAD_SAVED_APP -> {
                restoreSavedAppAfterHealth(checkNotNull(savedAppPath))
            }
            AndroidColdRestoreDecision.WAIT_FOR_FRESH_PROJECTION -> {
                pendingColdRestorePath = checkNotNull(savedAppPath)
                loadLauncher(preservePendingRestore = true)
            }
            AndroidColdRestoreDecision.LOAD_LAUNCHER -> loadLauncher()
        }
    }

    private fun completePendingColdRestore() {
        val savedPath = pendingColdRestorePath ?: return
        val runtime = clientRuntimeService ?: return
        if (!runtime.snapshot().projectionReady || !::browser.isInitialized) return
        pendingColdRestorePath = null
        restoreSavedAppAfterHealth(savedPath)
    }

    private fun handleUrlChanged(url: String?) {
        if (url.isNullOrBlank()) return
        val parsed = try {
            URI(url)
        } catch (_: Exception) {
            return
        }
        if (!isRelayOrigin(url)) return

        val nextPath = buildString {
            append(parsed.rawPath?.takeIf { it.isNotBlank() } ?: "/")
            parsed.rawQuery?.let { append('?').append(it) }
        }
        if (nextPath != currentPath) {
            imeDismissalReducer.reset()
        }
        currentPath = nextPath
        if (pendingColdRestorePath == null || isAppPath(currentPath)) {
            prefs().edit().putString(KEY_LAST_PATH, currentPath).apply()
        }
        val wasInAppShell = inAppShell
        inAppShell = isAppPath(currentPath)
        when {
            !wasInAppShell && inAppShell -> beginAppShellInspectorSession()
            wasInAppShell && !inAppShell -> endAppShellInspectorSession()
        }
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
        appHealthFailureCount = 0
        updateAppHealthMonitoring(immediate = true)
    }

    private fun restoreSavedAppAfterHealth(savedPath: String) {
        val generation = ++navigationGeneration
        val appId = appIdFromPath(savedPath)
        Thread {
            val health = probeRemoteAppHealth(frameworkBaseUrl, appId)
            runOnUiThread {
                if (generation != navigationGeneration || !::browser.isInitialized) {
                    return@runOnUiThread
                }
                if (health == AndroidRemoteAppHealth.UNHEALTHY || appId == null) {
                    loadLauncher()
                    return@runOnUiThread
                }
                currentAppId = appId
                browser.loadUrl(nativeFrameworkUrl(savedPath) ?: return@runOnUiThread)
            }
        }.start()
    }

    private fun appIdFromPath(path: String): String? {
        val pathname = path.substringBefore('?').substringBefore('#')
        if (!pathname.startsWith("/app/")) return null
        return pathname.removePrefix("/app/").substringBefore('/').takeIf { it.isNotBlank() }
    }

    private fun probeRemoteAppHealth(
        frameworkUrl: String,
        appId: String?,
    ): AndroidRemoteAppHealth {
        if (appId.isNullOrBlank()) return AndroidRemoteAppHealth.UNHEALTHY
        return try {
            val request = Request.Builder()
                .url(frameworkUrl.trimEnd('/') + "/api/apps/running")
                .get()
                .build()
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) AndroidRemoteAppHealth.UNREACHABLE
                else evaluateRunningAppsPayload(response.body?.string().orEmpty(), appId)
            }
        } catch (_: Exception) {
            AndroidRemoteAppHealth.UNREACHABLE
        }
    }

    private fun updateAppHealthMonitoring(immediate: Boolean = false) {
        uiHandler.removeCallbacks(appHealthCheckRunnable)
        if (!activityResumed || !inAppShell) return
        uiHandler.postDelayed(
            appHealthCheckRunnable,
            if (immediate) 0L else APP_HEALTH_INTERVAL_MS,
        )
    }

    private fun runAppHealthProbe() {
        if (!activityResumed || !inAppShell) return
        if (!appHealthProbeInFlight.compareAndSet(false, true)) return
        val appId = currentAppId
        val frameworkUrl = frameworkBaseUrl
        Thread {
            val health = probeRemoteAppHealth(frameworkUrl, appId)
            runOnUiThread {
                appHealthProbeInFlight.set(false)
                if (!activityResumed || !inAppShell || currentAppId != appId) {
                    return@runOnUiThread
                }
                val fallback = evaluateRemoteAppFallback(
                    health,
                    appHealthFailureCount,
                    APP_HEALTH_FAILURE_LIMIT,
                )
                appHealthFailureCount = fallback.consecutiveUnhealthyCount
                when (health) {
                    AndroidRemoteAppHealth.UNHEALTHY -> Log.w(
                        TAG,
                        "Remote app authoritative health failure " +
                            "$appHealthFailureCount/$APP_HEALTH_FAILURE_LIMIT app=$appId",
                    )
                    AndroidRemoteAppHealth.UNREACHABLE -> Log.w(
                        TAG,
                        "Remote app health transport unavailable; preserving app=$appId",
                    )
                    AndroidRemoteAppHealth.HEALTHY -> Unit
                }
                if (fallback.loadHome) loadLauncher() else updateAppHealthMonitoring()
            }
        }.start()
    }

    private fun nativeFrameworkUrl(path: String): String? {
        val runtime = clientRuntimeService ?: return null
        val url = runtime.frameworkUrl(path)
        return if (isAppPath(path)) {
            withAndroidNativePageIdentity(url, "cefrium", frameworkBaseUrl)
        } else {
            url
        }
    }

    private fun loadLauncher(preservePendingRestore: Boolean = false) {
        ++navigationGeneration
        if (clientRuntimeService == null || !::browser.isInitialized) return
        if (!preservePendingRestore) pendingColdRestorePath = null
        uiHandler.removeCallbacks(appHealthCheckRunnable)
        appHealthFailureCount = 0
        currentPath = LAUNCHER_PATH
        val wasInAppShell = inAppShell
        inAppShell = false
        if (wasInAppShell) endAppShellInspectorSession()
        nativeHeader.visibility = View.GONE
        if (!preservePendingRestore) {
            prefs().edit().putString(KEY_LAST_PATH, currentPath).apply()
        }
        updatePersistentNetworkService()
        browser.loadUrl(clientRuntimeService?.frameworkUrl(LAUNCHER_PATH) ?: return)
    }

    private fun loadApp(appId: String) {
        ++navigationGeneration
        currentAppId = appId
        isLocked = false
        findViewById<Button>(R.id.btnLock).text = "Lock"
        browser.loadUrl(
            withAndroidNativePageIdentity(
                clientRuntimeService?.frameworkUrl("/app/$appId") ?: return,
                "cefrium",
                frameworkBaseUrl,
            ),
        )
    }

    private fun handleNativeQuery(
        request: String,
        origin: String,
        callback: CefriumBrowser.QueryCallback,
    ): Boolean {
        if (!isRelayOrigin(origin)) {
            callback.failure(403, "Cefrium native bridge origin is not trusted")
            return true
        }
        val payload = try {
            JSONObject(request)
        } catch (_: Exception) {
            callback.failure(400, "Cefrium native bridge request is not valid JSON")
            return true
        }
        val role = if (
            payload.optJSONObject("params")?.optString("role") == "secondary"
        ) {
            "secondary"
        } else {
            "primary"
        }
        val result = when (payload.optString("method")) {
            "te2.clientIdentity.read" -> JSONObject()
                .put("ok", true)
                .put("clientInstanceId", androidClientInstanceId(applicationContext, role))
            "te2.clientIdentity.reset" -> {
                if (clientRuntimeService?.resetClientIdentity() == null) {
                    callback.failure(503, "Android runtime service is not connected")
                    return true
                }
                JSONObject()
                    .put("ok", true)
                    .put("clientInstanceId", androidClientInstanceId(applicationContext, role))
            }
            "te2.sidebarPresentation.read",
            "te2.sidebarPresentation.write" -> {
                try {
                    handleAndroidSidebarPresentationRequest(
                        applicationContext,
                        sidebarPresentationStore,
                        frameworkBaseUrl,
                        payload.optString("method").substringAfterLast('.'),
                        payload.optJSONObject("params") ?: JSONObject(),
                    )
                } catch (error: Exception) {
                    callback.failure(
                        400,
                        error.message ?: "Sidebar presentation request is invalid",
                    )
                    return true
                }
            }
            "te2.runTarget.register" -> {
                val runtimeService = clientRuntimeService
                if (runtimeService == null) {
                    callback.failure(503, "Android runtime service is not connected")
                    return true
                }
                val surface = try {
                    runtimeService.registerDevRuntimeSurface(
                        payload.optJSONObject("params") ?: JSONObject(),
                    )
                } catch (error: Exception) {
                    callback.failure(400, error.message ?: "Run Profile registration is invalid")
                    return true
                }
                runOnUiThread(::syncDevToolsRuntimePolicy)
                JSONObject()
                    .put("ok", true)
                    .put("surfaceId", surface.surfaceId)
                    .put("capabilities", JSONObject().apply {
                        put("cachePolicy", false)
                        put("consoleInjection", surface.devRuntime)
                        put("devToolsTarget", surface.devTools)
                    })
            }
            "te2.runTarget.release" -> {
                val surfaceId = payload.optJSONObject("params")
                    ?.optString("surfaceId")
                    ?.trim()
                    .orEmpty()
                if (surfaceId.isEmpty()) {
                    callback.failure(400, "Run Profile surface id is missing")
                    return true
                }
                clientRuntimeService?.releaseDevRuntimeSurface(surfaceId)
                runOnUiThread(::syncDevToolsRuntimePolicy)
                JSONObject().put("ok", true).put("surfaceId", surfaceId)
            }
            else -> {
                callback.failure(404, "Unsupported Cefrium native bridge method")
                return true
            }
        }
        callback.success(result.toString())
        return true
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
        browser.loadUrl(nativeFrameworkUrl(currentPath) ?: return)
    }

    private fun applySettings(settings: AndroidAppSettings) {
        val inspectorSettingChanged =
            devToolsRunProfilesEnabled != settings.devToolsRunProfilesEnabled ||
                devToolsDebugEnabled != settings.devToolsDebugEnabled
        frameworkBaseUrl = settings.frameworkBaseUrl
        persistentNetworkEnabled = settings.persistentNetworkNotification
        devToolsRunProfilesEnabled = settings.devToolsRunProfilesEnabled
        devToolsDebugEnabled = settings.devToolsDebugEnabled
        clientRuntimeService?.configure(settings)
        runOnUiThread {
            if (inspectorSettingChanged && ::browser.isInitialized) {
                configureDevToolsInspector()
            }
            updatePersistentNetworkService()
            updateAppHealthMonitoring(immediate = true)
            Toast.makeText(
                this,
                "Framework target updated",
                Toast.LENGTH_SHORT,
            ).show()
        }
        checkForAssetUpdate()
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

    private fun forceAssetUpdate(
        showFeedback: Boolean = true,
        completion: (Result<JSONObject>) -> Unit = {},
    ) {
        if (showFeedback) {
            Toast.makeText(this, "Force-updating assets…", Toast.LENGTH_SHORT).show()
        }
        Thread {
            val result = runCatching {
                check(assetManager.forceUpdateFromServer(frameworkBaseUrl)) {
                    "Asset update failed"
                }
                JSONObject().apply {
                    put("updated", true)
                    put("version", assetManager.getLocalVersion() ?: JSONObject.NULL)
                    put("renderer", "cefrium")
                }
            }
            runOnUiThread {
                if (result.isSuccess) {
                    val version = assetManager.getLocalVersion() ?: "?"
                    consoleTitle.text = "Tools · v$version"
                    if (showFeedback) {
                        Toast.makeText(
                            this,
                            "Assets updated to v$version",
                            Toast.LENGTH_SHORT,
                        ).show()
                    }
                    browser.clearCache()
                    browser.reload()
                    if (showFeedback) hideTools()
                } else if (showFeedback) {
                    Toast.makeText(this, "Asset update failed", Toast.LENGTH_SHORT).show()
                }
                completion(result)
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
        persistToolsState(overlayVisible = true)
        requestInitialInspectorTargetNudge()
        showToolsTab(toolsSelectedTab)
    }

    private fun hideTools() {
        consoleOverlay.visibility = View.GONE
        persistToolsState(overlayVisible = false)
        clientRuntimeService?.setConsoleDrawerEnabled(false)
        processesBrowser?.onPause()
    }

    private fun showConsoleTools() {
        showToolsTab(NativeToolsTab.CONSOLE)
    }

    private fun showInspectorTools() {
        showToolsTab(NativeToolsTab.INSPECTOR)
    }

    private fun showProcessesTools() {
        showToolsTab(NativeToolsTab.PROCESSES)
    }

    private fun showToolsTab(tab: NativeToolsTab) {
        toolsSelectedTab = tab
        persistToolsState(selectedTab = tab)
        val consoleSelected = tab == NativeToolsTab.CONSOLE
        val inspectorSelected = tab == NativeToolsTab.INSPECTOR
        val processesSelected = tab == NativeToolsTab.PROCESSES
        composeConsoleContainer.visibility = if (consoleSelected) View.VISIBLE else View.GONE
        inspectorPanel.visibility = if (inspectorSelected) View.VISIBLE else View.GONE
        processesPanel.visibility = if (processesSelected) View.VISIBLE else View.GONE
        btnToolsConsole.isEnabled = !consoleSelected
        btnToolsInspector.isEnabled = !inspectorSelected
        btnToolsProcesses.isEnabled = !processesSelected
        clientRuntimeService?.setConsoleDrawerEnabled(
            consoleOverlay.visibility == View.VISIBLE && consoleSelected,
            CONSOLE_TAIL_LINES,
        )
        if (
            consoleSelected &&
            consoleOverlay.visibility == View.VISIBLE &&
            !androidDiagnosticsLoadedForTools
        ) {
            androidDiagnosticsLoadedForTools = true
            loadAndroidDiagnostics()
        }
        if (inspectorSelected && consoleOverlay.visibility == View.VISIBLE) {
            ensureInspectorBrowser()
        }
        if (processesSelected && consoleOverlay.visibility == View.VISIBLE) {
            ensureProcessesBrowser()
        } else {
            processesBrowser?.onPause()
        }
    }

    private fun persistToolsState(
        overlayVisible: Boolean = toolsState.overlayVisible,
        selectedTab: NativeToolsTab = toolsState.selectedTab,
        inspectorTargetId: String? = toolsState.inspectorTargetId,
    ) {
        toolsState = AndroidToolsState(overlayVisible, selectedTab, inspectorTargetId)
        toolsStateStore.save(toolsState)
    }

    private fun restoreToolsSurfaceState() {
        toolsSelectedTab = toolsState.selectedTab
        consoleOverlay.visibility = View.GONE
        persistToolsState(overlayVisible = false)
        showToolsTab(toolsSelectedTab)
        clientRuntimeService?.setConsoleDrawerEnabled(false)
        processesBrowser?.onPause()
    }

    private fun configureDevToolsInspector() {
        if (!devToolsInspectorEnabled) {
            stopInspectorBrowser()
            syncDevToolsRuntimePolicy()
            devToolsStatus = "disabled"
            updateInspectorSurface()
            return
        }

        syncDevToolsRuntimePolicy()
        ensureInspectorBrowser()
        updateInspectorSurface()
    }

    private fun stopDevToolsInspector() {
        inspectorInitialTargetNudgeRequested = false
        inspectorInitialTargetNudgeCompleted = false
        stopDevToolsRuntime()
        stopInspectorBrowser()
        inspectorTargets = emptyList()
        inspectorActiveTargetId = null
        renderInspectorTargets()
    }

    private fun stopDevToolsRuntime() {
        devToolsRuntime?.close()
        devToolsRuntime = null
    }

    private fun stopInspectorBrowser() {
        inspectorInitialTargetNudgeRequested = false
        inspectorInitialTargetNudgeCompleted = false
        inspectorBrowser?.let { inspector ->
            if (::inspectorBrowserContainer.isInitialized) {
                inspectorBrowserContainer.removeView(inspector.surfaceContainer)
            }
            inspector.close()
        }
        inspectorBrowser = null
        inspectorClientReady = false
        inspectorPageLoaded = false
        inspectorDeliveredGeneration = 0L
    }

    private fun beginAppShellInspectorSession() {
        mainBrowserReady = false
        inspectorInitialTargetNudgeRequested = false
        inspectorInitialTargetNudgeCompleted = false
        consoleOverlay.visibility = View.GONE
        persistToolsState(overlayVisible = false)
        clientRuntimeService?.setConsoleDrawerEnabled(false)
        processesBrowser?.onPause()
    }

    private fun endAppShellInspectorSession() {
        consoleOverlay.visibility = View.GONE
        persistToolsState(overlayVisible = false)
        clientRuntimeService?.setConsoleDrawerEnabled(false)
        processesBrowser?.onPause()
        mainBrowserReady = false
        stopDevToolsInspector()
    }

    private fun requestInitialInspectorTargetNudge() {
        if (!inAppShell || inspectorInitialTargetNudgeCompleted) return
        inspectorInitialTargetNudgeRequested = true
        performInitialInspectorTargetNudge()
    }

    private fun performInitialInspectorTargetNudge() {
        if (
            !inAppShell ||
            !inspectorInitialTargetNudgeRequested ||
            inspectorInitialTargetNudgeCompleted
        ) return
        val target = inspectorTargets.firstOrNull() ?: return
        val runtime = devToolsRuntime ?: return

        // Mark the one-shot before reselecting because frame resets notify synchronously.
        inspectorInitialTargetNudgeRequested = false
        inspectorInitialTargetNudgeCompleted = true
        if (!runtime.reselectTarget(target.targetId)) {
            inspectorInitialTargetNudgeCompleted = false
            inspectorInitialTargetNudgeRequested = true
            return
        }
        persistToolsState(inspectorTargetId = target.targetId)
    }

    private fun syncDevToolsRuntimePolicy() {
        val surfaces = clientRuntimeService?.devRuntimeSurfaceSnapshot().orEmpty()
        if (
            !shouldStartCefriumDevToolsRuntime(
                inspectorEnabled = devToolsInspectorEnabled,
                hasDevRuntimeSurface = surfaces.any { it.devRuntime },
                mainBrowserReady = mainBrowserReady,
                appShellActive = inAppShell,
            )
        ) {
            stopDevToolsRuntime()
            return
        }
        val runtime = devToolsRuntime ?: CefriumDevToolsRuntime(
            httpClient = httpClient,
            listener = devToolsListener,
            chobitsuSource = assets.open("devtools_inspector/chobitsu.js")
                .bufferedReader()
                .use { it.readText() },
            targetRuntimeSource = assets.open(
                "devtools_inspector/cefrium-target-runtime.js",
            ).bufferedReader().use { it.readText() },
        ).also { devToolsRuntime = it }
        runtime.start(
            preferredTargetId = toolsState.inspectorTargetId,
            runProfilesEnabled = devToolsRunProfilesEnabled,
            debugTargetsEnabled = devToolsDebugEnabled,
            surfaces = surfaces,
        )
        runtime.updatePolicy(
            runProfilesEnabled = devToolsRunProfilesEnabled,
            debugTargetsEnabled = devToolsDebugEnabled,
            surfaces = surfaces,
        )
    }

    private fun ensureInspectorBrowser(resumeExisting: Boolean = false) {
        syncDevToolsRuntimePolicy()
        if (
            !shouldStartCefriumInspector(
                enabled = devToolsInspectorEnabled,
                mainBrowserReady = mainBrowserReady,
                appShellActive = inAppShell,
            )
        ) {
            updateInspectorSurface()
            return
        }
        if (devToolsRuntime == null) return
        val existingInspector = inspectorBrowser
        val inspector = existingInspector ?: CefriumBrowser.createWithSurface(this).also { next ->
            inspectorClientReady = false
            inspectorPageLoaded = false
            inspectorDeliveredGeneration = 0L
            next.setPullToRefreshEnabled(false)
            next.setQueryHandler { _, request, origin, callback ->
                handleInspectorQuery(request, origin, callback)
            }
            next.setOnLoadingStateChangedListener { isLoading, _, _ ->
                runOnUiThread {
                    if (
                        inspectorBrowser === next &&
                        shouldRequestCefriumInspectorClientReady(
                            isLoading = isLoading,
                            clientReady = inspectorClientReady,
                        )
                    ) {
                        next.evaluateJavaScript(
                            "window.__te2DevToolsInspector?.connectNative();",
                        )
                    }
                }
            }
            inspectorBrowserContainer.addView(
                next.surfaceContainer,
                0,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT,
                ),
            )
            inspectorBrowser = next
            next.loadUrl(
                clientRuntimeService?.frameworkUrl(CefriumInspectorAssetRoute.DOCUMENT_PATH)
                    ?: return@also,
            )
        }
        if (
            shouldResumeCefriumInspectorBrowser(
                activityResumed = activityResumed,
                browserCreated = existingInspector == null,
                resumeExisting = resumeExisting,
            )
        ) {
            inspector.onResume()
        }
        reconcileInspectorClient(forceTargetReplay = false)
        updateInspectorSurface()
    }

    private fun reconcileInspectorClient(forceTargetReplay: Boolean) {
        val inspector = inspectorBrowser ?: return
        inspector.surfaceContainer.post {
            if (inspectorBrowser !== inspector) return@post
            if (!inspectorClientReady) {
                inspector.evaluateJavaScript(
                    "window.__te2DevToolsInspector?.connectNative();",
                )
                return@post
            }
            syncInspectorPageFromRuntime(forceTargetReplay = forceTargetReplay)
        }
    }

    private fun handleInspectorQuery(
        request: String,
        origin: String,
        callback: CefriumBrowser.QueryCallback,
    ): Boolean {
        val inspector = inspectorBrowser
        if (
            inspector == null ||
            !isRelayOrigin(origin)
        ) {
            callback.failure(403, "Cefrium Inspector bridge is not on its trusted document")
            return true
        }
        val payload = try {
            JSONObject(request)
        } catch (_: Exception) {
            callback.failure(400, "Cefrium Inspector request is not valid JSON")
            return true
        }
        if (payload.optString("method") != "te2.devTools.message") {
            callback.failure(404, "Unsupported Cefrium Inspector bridge method")
            return true
        }
        val message = payload.optJSONObject("params") ?: JSONObject()
        when (message.optString("type")) {
            "client_ready" -> {
                inspectorClientReady = true
                inspectorPageLoaded = true
                inspectorDeliveredGeneration = 0L
                syncInspectorPageFromRuntime(forceTargetReplay = true)
                updateInspectorSurface()
            }
            "protocol" -> {
                val protocolPayload = message.optString("payload")
                val runtime = devToolsRuntime
                if (runtime == null || !runtime.sendProtocol(protocolPayload)) {
                    callback.failure(503, "Cefrium Inspector target is not connected")
                    return true
                }
            }
            "target_select" -> {
                val targetId = message.optString("targetId").trim()
                if (targetId.isNotEmpty()) {
                    persistToolsState(inspectorTargetId = targetId)
                    devToolsRuntime?.selectTarget(targetId)
                }
            }
            "client_state" -> {
                val targetId = message.optString("activeTargetId").trim()
                if (targetId.isNotEmpty() && inspectorTargets.any { it.targetId == targetId }) {
                    persistToolsState(inspectorTargetId = targetId)
                }
            }
            else -> {
                callback.failure(400, "Unsupported Cefrium Inspector message")
                return true
            }
        }
        callback.success(JSONObject().put("ok", true).toString())
        return true
    }

    private fun publishInspectorTargetsToPage() {
        if (!inspectorClientReady) return
        sendInspectorMessage(
            JSONObject()
                .put("type", "targets_changed")
                .put("activeTargetId", inspectorActiveTargetId ?: "")
                .put("targets", org.json.JSONArray().apply {
                    inspectorTargets.forEach { put(it.toJson()) }
                }),
        )
    }

    private fun syncInspectorPageFromRuntime(forceTargetReplay: Boolean = false) {
        if (!inspectorPageLoaded || !inspectorClientReady) return
        val snapshot = devToolsRuntime?.debugSnapshot()
        val generation = snapshot?.optLong("targetGeneration", 0L) ?: 0L
        val runtimeActiveTargetId = snapshot
            ?.optString("activeTargetId")
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
        if (runtimeActiveTargetId != null) {
            inspectorActiveTargetId = runtimeActiveTargetId
        }
        publishInspectorTargetsToPage()
        if (generation > 0L && runtimeActiveTargetId != null) {
            deliverInspectorTargetReset(generation, forceReplay = forceTargetReplay)
        } else {
            inspectorDeliveredGeneration = 0L
            sendInspectorMessage(JSONObject().put("type", "target_waiting"))
        }
    }

    private fun deliverInspectorTargetReset(
        generation: Long,
        forceReplay: Boolean = false,
    ) {
        if (
            !shouldDeliverCefriumInspectorGeneration(
                clientReady = inspectorPageLoaded && inspectorClientReady,
                generation = generation,
                deliveredGeneration = inspectorDeliveredGeneration,
                forceReplay = forceReplay,
            )
        ) return
        if (
            sendInspectorMessage(
                JSONObject()
                    .put("type", "target_reset")
                    .put("generation", generation),
            )
        ) {
            inspectorDeliveredGeneration = generation
        }
    }

    private fun sendInspectorMessage(message: JSONObject): Boolean {
        if (!inspectorPageLoaded || !inspectorClientReady) return false
        val inspector = inspectorBrowser ?: return false
        inspector.evaluateJavaScript(
            "window.__te2DevToolsInspector?.receiveNativeMessage(" +
                JSONObject.quote(message.toString()) +
                ");",
        )
        return true
    }

    private fun renderInspectorTargets() {
        if (!::inspectorTargetAdapter.isInitialized) return
        inspectorPickerUpdating = true
        try {
            inspectorTargetAdapter.clear()
            if (inspectorTargets.isEmpty()) {
                inspectorTargetAdapter.add("Waiting for inspected page...")
                inspectorTargetPicker.isEnabled = false
                return
            }
            inspectorTargetAdapter.addAll(
                inspectorTargets.map { target ->
                    val suffix = target.title.takeIf { it.isNotBlank() }
                    if (suffix == null) target.targetLabel()
                    else "${target.targetLabel()} - $suffix"
                },
            )
            inspectorTargetPicker.isEnabled = true
            val selectedTargetId = inspectorActiveTargetId ?: toolsState.inspectorTargetId
            val selectedIndex = inspectorTargets.indexOfFirst { it.targetId == selectedTargetId }
                .coerceAtLeast(0)
            inspectorTargetPicker.setSelection(selectedIndex, false)
        } finally {
            inspectorPickerUpdating = false
        }
    }

    private fun updateInspectorSurface() {
        if (!::inspectorStatus.isInitialized) return
        inspectorTargetPicker.visibility = if (devToolsInspectorEnabled) View.VISIBLE else View.GONE
        val statusText = when {
            !devToolsInspectorEnabled -> "Enable native developer tools in Android Settings."
            !mainBrowserReady -> "Waiting for the app page to load..."
            devToolsStatus.startsWith("error:") -> "Developer tools $devToolsStatus"
            !inspectorPageLoaded -> "Loading developer tools..."
            !inspectorClientReady -> "Connecting developer tools..."
            inspectorTargets.isEmpty() -> "Waiting for an inspectable Cefrium page..."
            inspectorActiveTargetId == null -> "Connecting developer tools..."
            else -> null
        }
        inspectorStatus.text = statusText.orEmpty()
        inspectorStatus.visibility = if (statusText == null) View.GONE else View.VISIBLE
    }

    private fun ensureProcessesBrowser() {
        val runtime = clientRuntimeService ?: return
        val processes = processesBrowser ?: CefriumBrowser.createWithSurface(this).also {
            it.setPullToRefreshEnabled(false)
            processesPanel.addView(
                it.surfaceContainer,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT,
                ),
            )
            processesBrowser = it
        }
        val url = runtime.frameworkUrl("/fws")
        if (processesLoadedUrl != url) {
            processesLoadedUrl = url
            processes.loadUrl(url)
        }
        if (activityResumed) processes.onResume()
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
        val remoteSessionActive = inAppShell || pendingColdRestorePath != null
        if (
            persistentNetworkEnabled &&
            remoteSessionActive &&
            android.os.Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED &&
            !notificationPermissionRequestInFlight &&
            !notificationPermissionDenied &&
            !prefs().getBoolean(KEY_NOTIFICATION_PERMISSION_REQUESTED, false)
        ) {
            notificationPermissionRequestInFlight = true
            prefs().edit()
                .putBoolean(KEY_NOTIFICATION_PERMISSION_REQUESTED, true)
                .apply()
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                NOTIFICATION_PERMISSION_REQUEST,
            )
        }
        val settings = settingsStore.load()
        clientRuntimeService?.configure(settings)
        clientRuntimeService?.setPersistentSessionActive(remoteSessionActive)
        val intent = PersistentNetworkService.runtimeIntent(this, remoteSessionActive)
        if (
            shouldKeepAndroidRendererActive(
                persistentNetworkEnabled,
                remoteSessionActive,
                frameworkBaseUrl,
            ) &&
            android.os.Build.VERSION.SDK_INT >= 26
        ) {
            ContextCompat.startForegroundService(this, intent)
        } else {
            startService(intent)
        }
    }

    private fun isRelayOrigin(rawUrl: String): Boolean {
        return try {
            val expected = URI(
                clientRuntimeService?.browserFrameworkBaseUrl() ?: return false,
            )
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
        if (inspectorBrowser?.onActivityResult(requestCode, resultCode, data) == true) {
            return
        }
        if (processesBrowser?.onActivityResult(requestCode, resultCode, data) == true) {
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
        imeDismissalReducer.reset()
        activityResumed = true
        if (
            android.os.Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionDenied = false
        }
        updatePersistentNetworkService()
        if (::browserContainer.isInitialized) {
            ViewCompat.requestApplyInsets(browserContainer)
        }
        if (::browser.isInitialized) browser.onResume()
        if (inAppShell) {
            ensureInspectorBrowser(resumeExisting = true)
        }
        if (
            consoleOverlay.visibility == View.VISIBLE &&
            toolsSelectedTab == NativeToolsTab.PROCESSES
        ) {
            ensureProcessesBrowser()
        }
        updateAppHealthMonitoring(immediate = true)
    }

    override fun onPause() {
        activityResumed = false
        imeDismissalReducer.reset()
        uiHandler.removeCallbacks(appHealthCheckRunnable)
        inspectorBrowser?.onPause()
        processesBrowser?.onPause()
        if (
            ::browser.isInitialized &&
            !shouldKeepAndroidRendererActive(
                persistentNetworkEnabled,
                inAppShell || pendingColdRestorePath != null,
                frameworkBaseUrl,
            )
        ) {
            browser.onPause()
        }
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
        ViewCompat.setWindowInsetsAnimationCallback(window.decorView, null)
        if (::browserContainer.isInitialized) {
            ViewCompat.setOnApplyWindowInsetsListener(browserContainer, null)
        }
        imeDismissalReducer.reset()
        uiHandler.removeCallbacks(appHealthCheckRunnable)
        clientRuntimeService?.clearLocalRelayRoutes()
        if (isFinishing && !isChangingConfigurations) {
            clientRuntimeService?.setPersistentSessionActive(false)
            stopService(PersistentNetworkService.runtimeIntent(this))
        }
        clientRuntimeService?.removeObserver(clientRuntimeObserver)
        if (clientRuntimeBound) {
            unbindService(clientRuntimeConnection)
            clientRuntimeBound = false
        }
        clientRuntimeService = null
        devToolsRuntime?.close()
        devToolsRuntime = null
        inspectorBrowser?.let { inspector ->
            inspectorBrowserContainer.removeView(inspector.surfaceContainer)
            inspector.close()
        }
        inspectorBrowser = null
        if (::browser.isInitialized) {
            selectionIntegration.close()
            browserContainer.removeView(browser.surfaceContainer)
            browser.close()
        }
        processesBrowser?.let { processes ->
            processesPanel.removeView(processes.surfaceContainer)
            processes.close()
        }
        processesBrowser = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "CefriumMainActivity"
        private const val LAUNCHER_PATH = "/android-shell/index.html"
        private const val DEFAULT_APP_ID = CODE_TE2_APP_ID
        private const val KEY_LAST_PATH = "last_path"
        private const val KEY_NOTIFICATION_PERMISSION_REQUESTED =
            "notification_permission_requested"
        private const val CONSOLE_TAIL_LINES = 500
        private const val CONTEXT_MENU_CANCEL = -1
        private const val NOTIFICATION_PERMISSION_REQUEST = 9301
        private const val APP_HEALTH_INTERVAL_MS = 2_000L
        private const val APP_HEALTH_FAILURE_LIMIT = 3
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()
    }
}
