package com.termux.extensions

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CopyOnWriteArraySet

internal data class AndroidClientRuntimeSnapshot(
    val generation: Long,
    val frameworkBaseUrl: String,
    val browserFrameworkBaseUrl: String,
    val projectionReady: Boolean,
    val projectionTransportAvailable: Boolean,
    val uiIpcConnected: Boolean,
    val nativeConsoleConnected: Boolean,
    val persistentSessionActive: Boolean,
    val foreground: Boolean,
    val cpuLockHeld: Boolean,
    val wifiLockHeld: Boolean,
    val batteryOptimizationExempt: Boolean,
    val notificationPermissionGranted: Boolean,
    val lastError: String?,
    val runTargets: JSONObject,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("generation", generation)
        put("frameworkBaseUrl", frameworkBaseUrl)
        put("browserFrameworkBaseUrl", browserFrameworkBaseUrl)
        put("projectionReady", projectionReady)
        put("projectionTransportAvailable", projectionTransportAvailable)
        put("uiIpcConnected", uiIpcConnected)
        put("nativeConsoleConnected", nativeConsoleConnected)
        put("persistentSessionActive", persistentSessionActive)
        put("foreground", foreground)
        put("cpuLockHeld", cpuLockHeld)
        put("wifiLockHeld", wifiLockHeld)
        put("batteryOptimizationExempt", batteryOptimizationExempt)
        put("notificationPermissionGranted", notificationPermissionGranted)
        put("lastError", lastError ?: JSONObject.NULL)
        put("runTargets", runTargets)
    }
}

internal interface AndroidClientRuntimeObserver {
    fun onRuntimeStateChanged(snapshot: AndroidClientRuntimeSnapshot) = Unit
    fun onImeContextChanged(active: Boolean) = Unit
    fun onImeContextChanged(active: Boolean, owner: String?) {
        onImeContextChanged(active)
    }
    fun onConsoleEvent(eventName: String, data: JSONObject) = Unit

    fun onNativeConsoleCommand(
        command: AndroidNativeConsoleCommand,
        completion: (Result<JSONObject>) -> Unit,
    ): Boolean = false
}

/**
 * Started-and-bound owner of Android's native TE2 control plane.
 *
 * Activities render pages and attach callbacks. They do not own the stable
 * framework relay, Run Target projection/listeners, UI IPC, or native console
 * sockets and therefore cannot tear those transports down during recreation or
 * ordinary backgrounding.
 */
class PersistentNetworkService : Service() {
    inner class LocalBinder : Binder() {
        val service: PersistentNetworkService
            get() = this@PersistentNetworkService
    }

    private val binder = LocalBinder()
    private val handler = Handler(Looper.getMainLooper())
    private val observers = CopyOnWriteArraySet<AndroidClientRuntimeObserver>()
    private val httpClient = OkHttpClient()
    private val frameworkRelay = AndroidFrameworkRelay()
    private val runTargetRelays = RunTargetRelayManager(httpClient)
    private val devRuntimeSurfaces = AndroidDevRuntimeSurfaceRegistry()
    private val runTargetProjectionClient = RunTargetProjectionClient(httpClient)
    private lateinit var settingsStore: AndroidAppSettingsStore

    @Volatile private var settings = AndroidAppSettings()
    private lateinit var runtimeState: AndroidClientRuntimeState
    private var uiIpcClient: UiIpcClient? = null
    private var nativeConsoleWorker: AndroidNativeConsoleWorker? = null
    @Volatile private var uiIpcConnected = false
    @Volatile private var nativeConsoleConnected = false
    @Volatile private var persistentSessionActive = false
    @Volatile private var foreground = false

    private var cpuWakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private val wifiNetworks = mutableSetOf<Network>()
    private var networkCallbackRegistered = false
    private val connectivityManager by lazy {
        getSystemService(ConnectivityManager::class.java)
    }

    private val wifiNetworkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            synchronized(wifiNetworks) { wifiNetworks += network }
            updatePowerPolicy()
        }

        override fun onLost(network: Network) {
            synchronized(wifiNetworks) { wifiNetworks -= network }
            updatePowerPolicy()
        }

        override fun onCapabilitiesChanged(
            network: Network,
            networkCapabilities: NetworkCapabilities,
        ) {
            synchronized(wifiNetworks) {
                if (
                    networkCapabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
                    networkCapabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                ) {
                    wifiNetworks += network
                } else {
                    wifiNetworks -= network
                }
            }
            updatePowerPolicy()
        }
    }

    override fun onCreate() {
        super.onCreate()
        settingsStore = AndroidAppSettingsStore(applicationContext)
        settings = settingsStore.load()
        runtimeState = AndroidClientRuntimeState(settings.frameworkBaseUrl)
        persistentSessionActive = runtimePreferences().getBoolean(
            KEY_PERSISTENT_SESSION_ACTIVE,
            false,
        )
        ensureChannel()
        registerWifiObserver()
        configureProjectionCallbacks()
        frameworkRelay.start(settings.frameworkBaseUrl)
        connectControlPlane()
        updateForegroundAndPowerPolicy()
        Log.i(TAG, "Android client runtime ready at ${frameworkRelay.browserOrigin}")
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val latestSettings = settingsStore.load()
        configure(latestSettings)
        if (intent?.hasExtra(EXTRA_REMOTE_APP_ACTIVE) == true) {
            setPersistentSessionActive(
                intent.getBooleanExtra(EXTRA_REMOTE_APP_ACTIVE, false),
            )
        } else {
            updateForegroundAndPowerPolicy()
        }
        return if (shouldRunForeground()) START_STICKY else START_NOT_STICKY
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        Log.w(TAG, "Foreground runtime timed out startId=$startId type=$fgsType")
        setPersistentSessionActive(false)
        stopSelf(startId)
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        setPersistentSessionActive(false)
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        releaseForegroundAndLocks()
        unregisterWifiObserver()
        runTargetProjectionClient.disconnect()
        uiIpcClient?.disconnect()
        uiIpcClient = null
        uiIpcConnected = false
        nativeConsoleWorker?.disconnect()
        nativeConsoleWorker = null
        nativeConsoleConnected = false
        runTargetRelays.close()
        devRuntimeSurfaces.clear()
        frameworkRelay.stop()
        observers.clear()
        super.onDestroy()
    }

    internal fun addObserver(observer: AndroidClientRuntimeObserver) {
        observers += observer
        observer.onRuntimeStateChanged(snapshot())
    }

    internal fun removeObserver(observer: AndroidClientRuntimeObserver) {
        observers -= observer
    }

    @Synchronized
    internal fun configure(next: AndroidAppSettings): AndroidClientRuntimeSnapshot {
        val frameworkChanged = runtimeState.configure(next.frameworkBaseUrl)
        val imeChanged = settings.imeContextSwitchingEnabled != next.imeContextSwitchingEnabled
        settings = next
        if (frameworkChanged) {
            runTargetProjectionClient.disconnect()
            runTargetRelays.stopAll()
            devRuntimeSurfaces.clear()
            frameworkRelay.retarget(next.frameworkBaseUrl)
            uiIpcClient?.disconnect()
            uiIpcClient = null
            uiIpcConnected = false
            nativeConsoleWorker?.disconnect()
            nativeConsoleWorker = null
            nativeConsoleConnected = false
            connectControlPlane()
        } else if (imeChanged) {
            uiIpcClient?.setImeContextSwitchingEnabled(next.imeContextSwitchingEnabled)
        }
        updateForegroundAndPowerPolicy()
        notifyStateChanged()
        return snapshot()
    }

    @Synchronized
    fun setPersistentSessionActive(active: Boolean) {
        if (persistentSessionActive == active) {
            updateForegroundAndPowerPolicy()
            return
        }
        persistentSessionActive = active
        runtimePreferences().edit()
            .putBoolean(KEY_PERSISTENT_SESSION_ACTIVE, active)
            .apply()
        updateForegroundAndPowerPolicy()
        notifyStateChanged()
    }

    fun browserFrameworkBaseUrl(): String = frameworkRelay.browserOrigin

    fun rewriteFrameworkUrl(url: String): String = frameworkRelay.rewriteFrameworkUrl(url)

    fun frameworkUrl(path: String): String = frameworkRelay.url(path)

    fun configureLocalRelayRoutes(
        assetRoot: File?,
        assetPathResolver: ((String) -> String?)?,
        requestHandler: ((LocalHttpRequest) -> LocalHttpResponse?)?,
    ) {
        frameworkRelay.configureLocalRouting(assetRoot, assetPathResolver, requestHandler)
    }

    fun clearLocalRelayRoutes() {
        frameworkRelay.configureLocalRouting(null, null, null)
    }

    fun setConsoleDrawerEnabled(enabled: Boolean, tailLines: Int = 500) {
        uiIpcClient?.setConsoleDrawerEnabled(enabled, tailLines)
    }

    fun sendConsoleEval(code: String, targetWorkerId: String = "main_page") {
        uiIpcClient?.sendConsoleEval(code, targetWorkerId)
    }

    fun sendConsoleClear() {
        uiIpcClient?.sendConsoleClear()
    }

    fun resetClientIdentity(): String {
        val next = resetAndroidInstallationId(applicationContext)
        uiIpcClient?.disconnect()
        uiIpcClient = null
        uiIpcConnected = false
        nativeConsoleWorker?.disconnect()
        nativeConsoleWorker = null
        nativeConsoleConnected = false
        connectUiIpc()
        connectNativeConsole()
        return next
    }

    internal fun registerDevRuntimeSurface(params: JSONObject): AndroidDevRuntimeSurface =
        devRuntimeSurfaces.register(params, frameworkRelay.browserOrigin)

    internal fun releaseDevRuntimeSurface(surfaceId: String): Boolean =
        devRuntimeSurfaces.release(surfaceId)

    internal fun devRuntimeSurfaceSnapshot(): List<AndroidDevRuntimeSurface> =
        devRuntimeSurfaces.snapshot()

    fun openBatteryOptimizationSettings() {
        val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
    }

    internal fun snapshot(): AndroidClientRuntimeSnapshot {
        val control = runtimeState.snapshot()
        return AndroidClientRuntimeSnapshot(
            generation = control.generation,
            frameworkBaseUrl = control.frameworkBaseUrl,
            browserFrameworkBaseUrl = frameworkRelay.browserOrigin,
            projectionReady = control.projectionReady && runTargetRelays.isProjectionReady(),
            projectionTransportAvailable = control.projectionTransportAvailable,
            uiIpcConnected = uiIpcConnected,
            nativeConsoleConnected = nativeConsoleConnected,
            persistentSessionActive = persistentSessionActive,
            foreground = foreground,
            cpuLockHeld = cpuWakeLock?.isHeld == true,
            wifiLockHeld = wifiLock?.isHeld == true,
            batteryOptimizationExempt = isBatteryOptimizationExempt(),
            notificationPermissionGranted =
                Build.VERSION.SDK_INT < 33 ||
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED,
            lastError = control.lastError,
            runTargets = runTargetRelays.debugSnapshot(),
        )
    }

    private fun configureProjectionCallbacks() {
        runTargetProjectionClient.onProjection = { projection ->
            val candidateGeneration = runtimeState.generation()
            val frameworkUrl = settings.frameworkBaseUrl
            runTargetRelays.updateRouteProjection(projection, frameworkUrl) { result ->
                result.fold(
                    onSuccess = {
                        runtimeState.projectionApplied(candidateGeneration)
                    },
                    onFailure = { error ->
                        runtimeState.projectionFailed(candidateGeneration, error)
                    },
                )
                notifyStateChanged()
            }
        }
        runTargetProjectionClient.onTransportUnavailable = { error ->
            runtimeState.transportUnavailable(runtimeState.generation(), error)
            notifyStateChanged()
        }
    }

    private fun connectControlPlane() {
        runTargetProjectionClient.connect(settings.frameworkBaseUrl)
        connectUiIpc()
        connectNativeConsole()
    }

    private fun connectUiIpc() {
        val client = UiIpcClient(
            clientId = androidNativeConsoleWorkerId(applicationContext, rendererName()),
            presentationClientId = androidClientInstanceId(applicationContext),
            imeContextSwitchingEnabled = settings.imeContextSwitchingEnabled,
            onImeContextChanged = { active, owner ->
                handler.post {
                    observers.forEach { observer ->
                        observer.onImeContextChanged(active, owner)
                    }
                }
            },
            onConnectionStateChanged = { connected ->
                uiIpcConnected = connected
                notifyStateChanged()
            },
        )
        client.onConsoleEvent = { eventName, data ->
            handler.post {
                observers.forEach { observer -> observer.onConsoleEvent(eventName, data) }
            }
        }
        uiIpcClient = client
        client.connect(settings.frameworkBaseUrl)
    }

    private fun connectNativeConsole() {
        val renderer = rendererName()
        val worker = AndroidNativeConsoleWorker(
            workerId = androidNativeConsoleWorkerId(applicationContext, renderer),
            workerLabel = "android-$renderer",
            onConnectionStateChanged = { connected ->
                nativeConsoleConnected = connected
                notifyStateChanged()
            },
        ) { command, completion ->
            handler.post {
                val handled = observers.any { observer ->
                    observer.onNativeConsoleCommand(command, completion)
                }
                if (!handled) {
                    completion(
                        Result.failure(
                            IllegalStateException("Android renderer is not attached"),
                        ),
                    )
                }
            }
        }
        nativeConsoleWorker = worker
        worker.connect(settings.frameworkBaseUrl)
    }

    private fun notifyStateChanged() {
        val current = snapshot()
        handler.post {
            observers.forEach { observer -> observer.onRuntimeStateChanged(current) }
        }
    }

    private fun shouldRunForeground(): Boolean =
        shouldKeepAndroidRendererActive(
            settings.persistentNetworkNotification,
            persistentSessionActive,
            settings.frameworkBaseUrl,
        )

    private fun updateForegroundAndPowerPolicy() {
        if (shouldRunForeground()) {
            if (!foreground) {
                val notification = buildNotification()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
                    )
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
                foreground = true
            }
            acquireCpuLock()
            updateWifiLock()
        } else {
            releaseForegroundAndLocks()
        }
    }

    private fun updatePowerPolicy() {
        handler.post {
            if (shouldRunForeground()) updateWifiLock() else releaseWifiLock()
            notifyStateChanged()
        }
    }

    private fun acquireCpuLock() {
        val lock = cpuWakeLock ?: run {
            val manager = getSystemService(PowerManager::class.java) ?: return
            manager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "$packageName:client-runtime",
            ).apply {
                setReferenceCounted(false)
                cpuWakeLock = this
            }
        }
        if (!lock.isHeld) lock.acquire()
    }

    private fun updateWifiLock() {
        val hasWifi = synchronized(wifiNetworks) { wifiNetworks.isNotEmpty() }
        if (!hasWifi) {
            releaseWifiLock()
            return
        }
        val lock = wifiLock ?: run {
            val manager = applicationContext.getSystemService(WifiManager::class.java) ?: return
            manager.createWifiLock(
                WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                "$packageName:client-runtime",
            ).apply {
                setReferenceCounted(false)
                wifiLock = this
            }
        }
        if (!lock.isHeld) lock.acquire()
    }

    private fun releaseForegroundAndLocks() {
        releaseWifiLock()
        cpuWakeLock?.let { lock ->
            if (lock.isHeld) runCatching { lock.release() }
        }
        if (foreground) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            foreground = false
        }
    }

    private fun releaseWifiLock() {
        wifiLock?.let { lock ->
            if (lock.isHeld) runCatching { lock.release() }
        }
    }

    private fun registerWifiObserver() {
        if (networkCallbackRegistered) return
        val manager = connectivityManager ?: return
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        runCatching { manager.registerNetworkCallback(request, wifiNetworkCallback) }
            .onSuccess { networkCallbackRegistered = true }
            .onFailure { Log.w(TAG, "Unable to observe Wi-Fi transport", it) }
    }

    private fun unregisterWifiObserver() {
        if (!networkCallbackRegistered) return
        runCatching { connectivityManager?.unregisterNetworkCallback(wifiNetworkCallback) }
        networkCallbackRegistered = false
        synchronized(wifiNetworks) { wifiNetworks.clear() }
    }

    private fun isBatteryOptimizationExempt(): Boolean {
        val manager = getSystemService(PowerManager::class.java) ?: return false
        return manager.isIgnoringBatteryOptimizations(packageName)
    }

    private fun rendererName(): String = when {
        packageName.endsWith(".cefrium") -> "cefrium"
        else -> "gecko"
    }

    private fun runtimePreferences() = getSharedPreferences(
        RUNTIME_PREFERENCES,
        Context.MODE_PRIVATE,
    )

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "TE2 Remote Runtime",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Keeps remote TE2 transports and Run Target routes active"
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_SECRET
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = launchIntent?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
        return builder
            .setContentTitle("TE2: Remote runtime active")
            .setContentText("Maintaining framework and Run Target connections")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    companion object {
        const val EXTRA_REMOTE_APP_ACTIVE = "remote_app_active"
        private const val TAG = "AndroidClientRuntime"
        private const val CHANNEL_ID = "te2_persistent_network"
        private const val NOTIFICATION_ID = 9001
        private const val RUNTIME_PREFERENCES = "android_client_runtime"
        private const val KEY_PERSISTENT_SESSION_ACTIVE = "persistent_session_active"

        fun runtimeIntent(
            context: Context,
            remoteAppActive: Boolean? = null,
        ): Intent = Intent(context, PersistentNetworkService::class.java).apply {
            remoteAppActive?.let { putExtra(EXTRA_REMOTE_APP_ACTIVE, it) }
        }
    }
}
