package com.termux.extensions

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.chromium.chrome.browser.DevToolsServer
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

private const val DEVTOOLS_TARGET_WINDOW_NAME_PREFIX = "te2-devtools:"
private const val RUN_PROFILE_RUNTIME_WINDOW_NAME_PREFIX = "te2-run-profile:"

internal data class CefriumDevToolsTarget(
    val targetId: String,
    val title: String,
    val url: String,
    val type: String,
    val label: String = "",
    val sessionId: String? = null,
    val executionContextId: Long? = null,
    val frameId: String? = null,
    val surfaceId: String? = null,
) {
    val isFrameTarget: Boolean
        get() = executionContextId != null && sessionId != null && surfaceId != null

    fun toJson(): JSONObject = JSONObject()
        .put("targetId", targetId)
        .put("targetLabel", targetLabel())
        .put("title", title)
        .put("url", url)
        .put("type", type)
        .put("frameId", frameId ?: JSONObject.NULL)
        .put("surfaceId", surfaceId ?: JSONObject.NULL)

    fun targetLabel(): String = label.ifBlank {
        when {
            isFrameTarget -> title.ifBlank { "Run Profile" }
            url.contains("/fws") -> "Processes"
            url.contains("/app/") -> "App"
            title.isNotBlank() -> "Page"
            else -> "Cefrium"
        }
    }
}

internal data class CefriumDevToolsMarker(
    val surfaceId: String,
    val targetId: String,
    val targetLabel: String,
)

internal data class CefriumRunProfileMarker(
    val surfaceId: String,
    val targetId: String,
    val targetLabel: String,
    val devRuntime: Boolean,
    val devTools: Boolean,
    val frameworkOrigin: String,
)

internal fun parseCefriumRunProfileMarker(windowName: String): CefriumRunProfileMarker? {
    val prefix = when {
        windowName.startsWith(DEVTOOLS_TARGET_WINDOW_NAME_PREFIX) ->
            DEVTOOLS_TARGET_WINDOW_NAME_PREFIX
        windowName.startsWith(RUN_PROFILE_RUNTIME_WINDOW_NAME_PREFIX) ->
            RUN_PROFILE_RUNTIME_WINDOW_NAME_PREFIX
        else -> return null
    }
    return try {
        val encoded = windowName.substring(prefix.length)
        val payload = JSONObject(
            URLDecoder.decode(encoded, StandardCharsets.UTF_8.name()),
        )
        val devRuntime = payload.optBoolean("devRuntime", false)
        val devTools = payload.optBoolean("devTools", false)
        if (!devRuntime && !devTools) return null
        if (prefix == DEVTOOLS_TARGET_WINDOW_NAME_PREFIX && !devTools) return null
        if (prefix == RUN_PROFILE_RUNTIME_WINDOW_NAME_PREFIX && (!devRuntime || devTools)) {
            return null
        }
        val surfaceId = payload.optString("surfaceId").trim()
        val targetId = payload.optString("targetId").trim().ifEmpty { surfaceId }
        if (
            surfaceId.isEmpty() || surfaceId.length > 256 ||
            targetId.isEmpty() || targetId.length > 256
        ) return null
        CefriumRunProfileMarker(
            surfaceId = surfaceId,
            targetId = targetId,
            targetLabel = payload.optString("targetLabel").trim().take(256)
                .ifEmpty { targetId },
            devRuntime = devRuntime,
            devTools = devTools,
            frameworkOrigin = payload.optString("frameworkOrigin").trim(),
        )
    } catch (_: Exception) {
        null
    }
}

internal fun parseCefriumDevToolsMarker(windowName: String): CefriumDevToolsMarker? {
    val marker = parseCefriumRunProfileMarker(windowName)?.takeIf { it.devTools } ?: return null
    return CefriumDevToolsMarker(
        surfaceId = marker.surfaceId,
        targetId = marker.targetId,
        targetLabel = marker.targetLabel,
    )
}

internal fun cefriumConsoleWorkerPrefix(workerIdBase: String): String =
    "${workerIdBase.trim().ifEmpty { "rp-prof" }}-cfrm"

internal fun chooseCefriumDevToolsTarget(
    targets: Collection<CefriumDevToolsTarget>,
    preferredTargetId: String?,
): CefriumDevToolsTarget? =
    targets.firstOrNull { it.targetId == preferredTargetId }
        ?: targets.firstOrNull { it.isFrameTarget }
        ?: targets.firstOrNull { it.url.contains("/app/") }
        ?: targets.firstOrNull { !it.url.contains("/fws") }
        ?: targets.firstOrNull()

internal fun isInspectableCefriumDevToolsTarget(target: CefriumDevToolsTarget): Boolean =
    target.targetId.isNotBlank() &&
        target.url.isNotBlank() &&
        (target.isFrameTarget || target.type == "page" || target.type == "other") &&
        !isCefriumInspectorTargetUrl(target.url)

private fun isCefriumInspectorTargetUrl(rawUrl: String): Boolean {
    if (rawUrl.startsWith("file:///android_asset/devtools_inspector/")) return true
    return try {
        URI(rawUrl).path?.startsWith(CefriumInspectorAssetRoute.PATH_PREFIX) == true
    } catch (_: Exception) {
        false
    }
}

internal class CefriumDevToolsRuntime(
    private val httpClient: OkHttpClient,
    private val listener: Listener,
    private val chobitsuSource: String,
    private val targetRuntimeSource: String,
) : Closeable {
    interface Listener {
        fun onStatusChanged(status: String)
        fun onTargetsChanged(targets: List<CefriumDevToolsTarget>, activeTargetId: String?)
        fun onTargetReset(generation: Long)
        fun onTargetWaiting()
        fun onProtocolMessage(payload: String)
    }

    private data class MonitorSession(
        val sessionId: String,
        val browserTargetId: String,
        val parentSessionId: String? = null,
    )

    private data class FrameContext(
        val sessionId: String,
        val executionContextId: Long,
        val uniqueContextId: String,
        val frameId: String,
    ) {
        val key: String
            get() = "$sessionId:$executionContextId"
    }

    private data class FrameCandidate(
        val context: FrameContext,
        val surface: AndroidDevRuntimeSurface,
        val marker: CefriumRunProfileMarker,
        val url: String,
        val title: String,
        val bindingName: String,
    )

    private data class ConsoleSources(
        val socketIo: String,
        val consoleBridge: String,
    )

    private sealed interface PendingCommand {
        data class DirectAttach(val targetId: String) : PendingCommand
        data class MonitorAttach(val targetId: String) : PendingCommand
        data class MarkerProbe(val context: FrameContext) : PendingCommand
        data class BindingInstall(val candidate: FrameCandidate) : PendingCommand
        data class RuntimeInstall(val candidate: FrameCandidate) : PendingCommand
        data class ConsoleInstall(val candidate: FrameCandidate) : PendingCommand
    }

    private val lock = Any()
    private val scheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { task ->
        Thread(task, "cefrium-devtools-control").apply { isDaemon = true }
    }
    private val sourceExecutor: ExecutorService = Executors.newSingleThreadExecutor { task ->
        Thread(task, "cefrium-console-source").apply { isDaemon = true }
    }
    private val commandId = AtomicLong(CONTROL_COMMAND_START)
    private val targets = linkedMapOf<String, CefriumDevToolsTarget>()
    private val browserTargets = linkedMapOf<String, CefriumDevToolsTarget>()
    private val monitorSessions = mutableMapOf<String, MonitorSession>()
    private val monitorAttachTargets = mutableSetOf<String>()
    private val contexts = mutableMapOf<String, FrameContext>()
    private val contextTargets = mutableMapOf<String, String>()
    private val consoleContexts = mutableMapOf<String, String>()
    private val pendingConsoleContexts = mutableSetOf<String>()
    private val consoleSourceCache = mutableMapOf<String, ConsoleSources>()
    private val pendingCommands = mutableMapOf<Long, PendingCommand>()
    private val surfaces = mutableMapOf<String, AndroidDevRuntimeSurface>()

    private var server: DevToolsServer? = null
    private var socketBridge: CefriumDevToolsSocketBridge? = null
    private var controlSocket: WebSocket? = null
    private var controlEpoch = 0L
    private var started = false
    private var reconnectAttempt = 0
    private var runProfilesEnabled = false
    private var debugTargetsEnabled = false
    private var desiredTargetId: String? = null
    private var activeTargetId: String? = null
    private var activeSessionId: String? = null
    private var targetGeneration = 0L
    private var consoleInjectionCount = 0L
    private var lastConsoleInjectionError: String? = null
    private var status = "disabled"

    fun start(
        preferredTargetId: String?,
        runProfilesEnabled: Boolean,
        debugTargetsEnabled: Boolean,
        surfaces: List<AndroidDevRuntimeSurface>,
    ) {
        val policy = cefriumDevToolsPolicy(
            runProfilesEnabled = runProfilesEnabled,
            debugTargetsEnabled = debugTargetsEnabled,
            surfaces = surfaces,
        )
        synchronized(lock) {
            if (started) return
            desiredTargetId = preferredTargetId
            applyPolicyLocked(policy)
            started = true
            status = "starting"
        }
        listener.onStatusChanged("starting")

        try {
            val nextServer = DevToolsServer(DEVTOOLS_SOCKET_PREFIX)
            val nextBridge = CefriumDevToolsSocketBridge(DEVTOOLS_SOCKET_NAME)
            nextServer.setRemoteDebuggingEnabled(true)
            nextBridge.start()
            synchronized(lock) {
                if (!started) {
                    nextBridge.close()
                    nextServer.setRemoteDebuggingEnabled(false)
                    nextServer.destroy()
                    return
                }
                server = nextServer
                socketBridge = nextBridge
            }
            scheduleControlConnect(0L)
        } catch (error: Exception) {
            Log.e(TAG, "Could not start Cefrium DevTools", error)
            setStatus("error: ${error.message ?: error.javaClass.simpleName}")
        }
    }

    fun updatePolicy(
        runProfilesEnabled: Boolean,
        debugTargetsEnabled: Boolean,
        surfaces: List<AndroidDevRuntimeSurface>,
    ) {
        val nextPolicy = cefriumDevToolsPolicy(
            runProfilesEnabled = runProfilesEnabled,
            debugTargetsEnabled = debugTargetsEnabled,
            surfaces = surfaces,
        )
        val changed = synchronized(lock) {
            val currentPolicy = CefriumDevToolsPolicy(
                runProfilesEnabled = this.runProfilesEnabled,
                debugTargetsEnabled = this.debugTargetsEnabled,
                surfaces = this.surfaces.toMap(),
            )
            if (!shouldReconcileCefriumDevToolsPolicy(currentPolicy, nextPolicy)) {
                false
            } else {
                applyPolicyLocked(nextPolicy)
                true
            }
        }
        if (!changed) return
        reconcilePolicy()
    }

    private fun applyPolicyLocked(policy: CefriumDevToolsPolicy) {
        runProfilesEnabled = policy.runProfilesEnabled
        debugTargetsEnabled = policy.debugTargetsEnabled
        surfaces.clear()
        surfaces.putAll(policy.surfaces)
    }

    fun selectTarget(targetId: String) {
        val normalized = targetId.trim()
        if (normalized.isEmpty()) return
        synchronized(lock) { desiredTargetId = normalized }
        activateDesiredTarget()
    }

    fun reselectTarget(targetId: String): Boolean {
        val normalized = targetId.trim()
        if (normalized.isEmpty()) return false
        val available = synchronized(lock) {
            if (!targets.containsKey(normalized)) return@synchronized false
            desiredTargetId = normalized
            true
        }
        if (!available) return false
        activateDesiredTarget(force = true)
        return true
    }

    fun sendProtocol(payload: String): Boolean {
        val target = synchronized(lock) {
            activeTargetId?.let(targets::get)
        } ?: return false
        if (target.isFrameTarget) return sendFrameProtocol(target, payload)

        val socket: WebSocket
        val sessionId: String
        synchronized(lock) {
            socket = controlSocket ?: return false
            sessionId = activeSessionId ?: return false
        }
        val message = try {
            JSONObject(payload).apply {
                if (!has("sessionId")) put("sessionId", sessionId)
            }.toString()
        } catch (_: Exception) {
            return false
        }
        return socket.send(message)
    }

    private fun sendFrameProtocol(target: CefriumDevToolsTarget, payload: String): Boolean {
        val sessionId = target.sessionId ?: return false
        val contextId = target.executionContextId ?: return false
        val expression = "globalThis.__te2CefriumDevToolsTarget?.receive(" +
            JSONObject.quote(payload) + ")"
        return sendInternal(
            method = "Runtime.evaluate",
            params = JSONObject()
                .put("expression", expression)
                .put("contextId", contextId)
                .put("awaitPromise", false)
                .put("returnByValue", false),
            sessionId = sessionId,
        )
    }

    fun debugSnapshot(): JSONObject = synchronized(lock) {
        JSONObject()
            .put("available", true)
            .put("renderer", "cefrium")
            .put("enabled", started)
            .put("runProfilesEnabled", runProfilesEnabled)
            .put("debugTargetsEnabled", debugTargetsEnabled)
            .put("status", status)
            .put("controlConnected", controlSocket != null)
            .put("bridgePort", socketBridge?.port ?: JSONObject.NULL)
            .put("targetCount", targets.size)
            .put("browserTargetCount", browserTargets.size)
            .put("monitorSessionCount", monitorSessions.size)
            .put("executionContextCount", contexts.size)
            .put("registeredSurfaceCount", surfaces.size)
            .put("consoleInjectedContextCount", consoleContexts.size)
            .put("consoleInjectionPendingCount", pendingConsoleContexts.size)
            .put("consoleInjectionCount", consoleInjectionCount)
            .put("lastConsoleInjectionError", lastConsoleInjectionError ?: JSONObject.NULL)
            .put("activeTargetId", activeTargetId ?: JSONObject.NULL)
            .put("desiredTargetId", desiredTargetId ?: JSONObject.NULL)
            .put("targetGeneration", targetGeneration)
            .put("targets", JSONArray().apply {
                targets.values.forEach { put(it.toJson()) }
            })
    }

    private fun reconcilePolicy() {
        val staleConsoleContexts = synchronized(lock) {
            consoleContexts.filter { (contextKey, surfaceId) ->
                contexts[contextKey] == null || surfaces[surfaceId]?.devRuntime != true
            }.keys.toList()
        }
        staleConsoleContexts.forEach(::removeConsoleContext)

        val removeTargetIds = synchronized(lock) {
            targets.values.filter { target ->
                if (target.isFrameTarget) {
                    !runProfilesEnabled || surfaces[target.surfaceId]?.devTools != true
                } else {
                    !debugTargetsEnabled
                }
            }.map(CefriumDevToolsTarget::targetId)
        }
        removeTargetIds.forEach(::removeExposedTarget)

        val browserSnapshot = synchronized(lock) { browserTargets.values.toList() }
        if (synchronized(lock) { debugTargetsEnabled }) {
            synchronized(lock) {
                browserSnapshot.forEach { targets[it.targetId] = it }
            }
        }
        val shouldMonitor = synchronized(lock) {
            surfaces.isNotEmpty()
        }
        if (shouldMonitor) {
            browserSnapshot.forEach { ensureMonitorAttached(it.targetId) }
            synchronized(lock) { contexts.values.toList() }.forEach(::probeFrameContext)
        } else {
            val rootMonitorSessions = synchronized(lock) {
                monitorSessions.values
                    .filter { it.parentSessionId == null }
                    .map(MonitorSession::sessionId)
            }
            rootMonitorSessions.forEach { sessionId ->
                sendInternal(
                    "Target.detachFromTarget",
                    JSONObject().put("sessionId", sessionId),
                )
                removeMonitorSession(sessionId)
            }
        }
        publishTargetsAndActivateIfNeeded()
    }

    private fun scheduleControlConnect(delayMs: Long) {
        val shouldSchedule = synchronized(lock) { started && socketBridge != null }
        if (!shouldSchedule) return
        scheduler.schedule(::connectControlChannel, delayMs, TimeUnit.MILLISECONDS)
    }

    private fun connectControlChannel() {
        val bridgePort: Int
        val epoch: Long
        synchronized(lock) {
            if (!started || controlSocket != null) return
            bridgePort = socketBridge?.port ?: return
            controlEpoch += 1
            epoch = controlEpoch
        }

        try {
            val discoveredTargets = fetchDiscoveryTargets(bridgePort)
            val request = Request.Builder()
                .url("http://127.0.0.1:$bridgePort/json/version")
                .header("Host", "localhost")
                .get()
                .build()
            val debuggerUrl = httpClient.newCall(request).execute().use { response ->
                check(response.isSuccessful) { "DevTools discovery returned HTTP ${response.code}" }
                JSONObject(response.body?.string().orEmpty()).getString("webSocketDebuggerUrl")
            }
            val socketUrl = loopbackWebSocketUrl(debuggerUrl, bridgePort)
            synchronized(lock) {
                if (!started || epoch != controlEpoch) return
                clearConnectionStateLocked()
                discoveredTargets
                    .filter(::isInspectableCefriumDevToolsTarget)
                    .forEach { browserTargets[it.targetId] = it }
                if (debugTargetsEnabled) {
                    browserTargets.values.forEach { targets[it.targetId] = it }
                }
            }
            val webSocket = httpClient.newWebSocket(
                Request.Builder().url(socketUrl).header("Host", "localhost").build(),
                ControlSocketListener(epoch),
            )
            synchronized(lock) {
                if (!started || epoch != controlEpoch) webSocket.cancel()
            }
        } catch (error: Exception) {
            Log.w(TAG, "Cefrium DevTools discovery connection failed", error)
            scheduleReconnect(epoch)
        }
    }

    private inner class ControlSocketListener(
        private val epoch: Long,
    ) : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            val accepted = synchronized(lock) {
                if (!started || epoch != controlEpoch) {
                    false
                } else {
                    controlSocket = webSocket
                    reconnectAttempt = 0
                    status = "connected"
                    true
                }
            }
            if (!accepted) {
                webSocket.close(1000, "stale")
                return
            }
            listener.onStatusChanged("connected")
            sendInternal("Target.setDiscoverTargets", JSONObject().put("discover", true))
            reconcilePolicy()
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            handleControlMessage(epoch, text)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            handleControlDisconnect(epoch, "closed: $code $reason")
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            handleControlDisconnect(
                epoch,
                "disconnected: ${t.message ?: t.javaClass.simpleName}",
            )
        }
    }

    private fun handleControlMessage(epoch: Long, payload: String) {
        val message = try {
            JSONObject(payload)
        } catch (_: Exception) {
            return
        }
        synchronized(lock) {
            if (!started || epoch != controlEpoch) return
        }

        val responseId = message.optLong("id", Long.MIN_VALUE)
        if (responseId != Long.MIN_VALUE && handlePendingResponse(responseId, message)) return

        val method = message.optString("method")
        val sessionId = message.optString("sessionId").takeIf(String::isNotBlank)
        when (method) {
            "Target.targetCreated",
            "Target.targetInfoChanged" -> {
                val info = message.optJSONObject("params")?.optJSONObject("targetInfo") ?: return
                updateBrowserTarget(info)
                return
            }
            "Target.targetDestroyed" -> {
                removeBrowserTarget(
                    message.optJSONObject("params")?.optString("targetId").orEmpty(),
                )
                return
            }
            "Target.attachedToTarget" -> {
                handleAutoAttachedTarget(sessionId, message.optJSONObject("params") ?: return)
                return
            }
            "Target.detachedFromTarget" -> {
                handleDetachedSession(
                    message.optJSONObject("params")?.optString("sessionId").orEmpty(),
                )
                return
            }
            "Runtime.executionContextCreated" -> {
                handleExecutionContextCreated(sessionId, message.optJSONObject("params"))
                return
            }
            "Runtime.executionContextDestroyed" -> {
                val contextId = message.optJSONObject("params")
                    ?.optLong("executionContextId", -1L) ?: -1L
                if (sessionId != null && contextId >= 0) removeContext("$sessionId:$contextId")
                return
            }
            "Runtime.executionContextsCleared" -> {
                if (sessionId != null) removeContextsForSession(sessionId)
                return
            }
            "Runtime.bindingCalled" -> {
                handleBindingCalled(sessionId, message.optJSONObject("params"))
                return
            }
            "Page.frameNavigated" -> {
                val frameId = message.optJSONObject("params")
                    ?.optJSONObject("frame")
                    ?.optString("id")
                    .orEmpty()
                if (sessionId != null && frameId.isNotBlank()) {
                    removeContextsForFrame(sessionId, frameId)
                }
                return
            }
        }

        val directSession = synchronized(lock) { activeSessionId }
        if (sessionId != null && sessionId == directSession) {
            message.remove("sessionId")
            listener.onProtocolMessage(message.toString())
        }
    }

    private fun updateBrowserTarget(info: JSONObject) {
        val target = CefriumDevToolsTarget(
            targetId = info.optString("targetId").trim(),
            title = info.optString("title").trim(),
            url = info.optString("url").trim(),
            type = info.optString("type").trim(),
        )
        if (!isInspectableCefriumDevToolsTarget(target)) {
            removeBrowserTarget(target.targetId)
            return
        }
        val shouldMonitor: Boolean
            synchronized(lock) {
                browserTargets[target.targetId] = target
            if (debugTargetsEnabled) targets[target.targetId] = target
            else if (targets[target.targetId]?.isFrameTarget != true) targets.remove(target.targetId)
            shouldMonitor = surfaces.isNotEmpty()
        }
        if (shouldMonitor) ensureMonitorAttached(target.targetId)
        publishTargetsAndActivateIfNeeded()
    }

    private fun removeBrowserTarget(targetId: String) {
        if (targetId.isBlank()) return
        val sessions = synchronized(lock) {
            browserTargets.remove(targetId)
            if (targets[targetId]?.isFrameTarget != true) targets.remove(targetId)
            monitorSessions.values
                .filter { it.browserTargetId == targetId }
                .map(MonitorSession::sessionId)
        }
        sessions.forEach(::removeMonitorSession)
        if (synchronized(lock) { activeTargetId == targetId }) clearActiveTarget()
        publishTargetsAndActivateIfNeeded()
    }

    private fun ensureMonitorAttached(targetId: String) {
        val shouldAttach = synchronized(lock) {
            if (
                !started || surfaces.isEmpty() || controlSocket == null ||
                !browserTargets.containsKey(targetId) ||
                monitorSessions.values.any { it.browserTargetId == targetId } ||
                !monitorAttachTargets.add(targetId)
            ) false else true
        }
        if (!shouldAttach) return
        sendInternal(
            method = "Target.attachToTarget",
            params = JSONObject().put("targetId", targetId).put("flatten", true),
            pending = PendingCommand.MonitorAttach(targetId),
        )
    }

    private fun configureMonitorSession(session: MonitorSession) {
        synchronized(lock) { monitorSessions[session.sessionId] = session }
        sendInternal(
            "Target.setAutoAttach",
            JSONObject()
                .put("autoAttach", true)
                .put("waitForDebuggerOnStart", false)
                .put("flatten", true),
            session.sessionId,
        )
        sendInternal("Page.enable", JSONObject(), session.sessionId)
        sendInternal("Runtime.enable", JSONObject(), session.sessionId)
    }

    private fun handleAutoAttachedTarget(parentSessionId: String?, params: JSONObject) {
        val childSessionId = params.optString("sessionId").trim()
        val parent = synchronized(lock) { parentSessionId?.let(monitorSessions::get) }
        if (childSessionId.isEmpty() || parent == null) return
        configureMonitorSession(
            MonitorSession(
                sessionId = childSessionId,
                browserTargetId = parent.browserTargetId,
                parentSessionId = parent.sessionId,
            ),
        )
    }

    private fun handleDetachedSession(sessionId: String) {
        if (sessionId.isBlank()) return
        val wasDirect = synchronized(lock) {
            if (sessionId != activeSessionId) false else {
                activeSessionId = null
                activeTargetId = null
                true
            }
        }
        if (wasDirect) {
            publishTargetsAndActivateIfNeeded()
            return
        }
        val browserTargetId = synchronized(lock) { monitorSessions[sessionId]?.browserTargetId }
        removeMonitorSession(sessionId)
        if (
            browserTargetId != null &&
            synchronized(lock) { surfaces.isNotEmpty() }
        ) {
            ensureMonitorAttached(browserTargetId)
        }
    }

    private fun removeMonitorSession(sessionId: String) {
        val childSessions = synchronized(lock) {
            monitorSessions.remove(sessionId)
            monitorSessions.values
                .filter { it.parentSessionId == sessionId }
                .map(MonitorSession::sessionId)
        }
        removeContextsForSession(sessionId)
        childSessions.forEach(::removeMonitorSession)
    }

    private fun handleExecutionContextCreated(sessionId: String?, params: JSONObject?) {
        if (sessionId == null || params == null) return
        if (synchronized(lock) { !monitorSessions.containsKey(sessionId) }) {
            return
        }
        val contextPayload = params.optJSONObject("context") ?: return
        val auxData = contextPayload.optJSONObject("auxData") ?: return
        if (!auxData.optBoolean("isDefault", false)) return
        val contextId = contextPayload.optLong("id", -1L)
        val frameId = auxData.optString("frameId").trim()
        if (contextId < 0 || frameId.isEmpty()) return
        val context = FrameContext(
            sessionId = sessionId,
            executionContextId = contextId,
            uniqueContextId = contextPayload.optString("uniqueId").trim(),
            frameId = frameId,
        )
        synchronized(lock) { contexts[context.key] = context }
        probeFrameContext(context)
    }

    private fun probeFrameContext(context: FrameContext) {
        if (synchronized(lock) {
                surfaces.isEmpty() || contexts[context.key] != context
            }
        ) return
        sendInternal(
            method = "Runtime.evaluate",
            params = JSONObject()
                .put("expression", FRAME_PROBE_EXPRESSION)
                .put("contextId", context.executionContextId)
                .put("returnByValue", true)
                .put("silent", true),
            sessionId = context.sessionId,
            pending = PendingCommand.MarkerProbe(context),
        )
    }

    private fun handlePendingResponse(id: Long, message: JSONObject): Boolean {
        val pending = synchronized(lock) { pendingCommands.remove(id) } ?: return false
        when (pending) {
            is PendingCommand.DirectAttach -> completeDirectAttach(pending.targetId, message)
            is PendingCommand.MonitorAttach -> completeMonitorAttach(pending.targetId, message)
            is PendingCommand.MarkerProbe -> completeMarkerProbe(pending.context, message)
            is PendingCommand.BindingInstall -> completeBindingInstall(pending.candidate, message)
            is PendingCommand.RuntimeInstall -> completeRuntimeInstall(pending.candidate, message)
            is PendingCommand.ConsoleInstall -> completeConsoleInstall(pending.candidate, message)
        }
        return true
    }

    private fun completeMonitorAttach(targetId: String, message: JSONObject) {
        val sessionId = message.optJSONObject("result")?.optString("sessionId").orEmpty()
        synchronized(lock) { monitorAttachTargets.remove(targetId) }
        if (sessionId.isBlank()) return
        val accepted = synchronized(lock) {
            started && surfaces.isNotEmpty() &&
                browserTargets.containsKey(targetId)
        }
        if (!accepted) {
            sendInternal("Target.detachFromTarget", JSONObject().put("sessionId", sessionId))
            return
        }
        configureMonitorSession(MonitorSession(sessionId, targetId))
    }

    private fun completeMarkerProbe(context: FrameContext, message: JSONObject) {
        if (synchronized(lock) { contexts[context.key] != context }) return
        val rawValue = message.optJSONObject("result")
            ?.optJSONObject("result")
            ?.opt("value") as? String ?: return
        val probe = try {
            JSONObject(rawValue)
        } catch (_: Exception) {
            return
        }
        val marker = parseCefriumRunProfileMarker(probe.optString("windowName")) ?: return
        val surface = synchronized(lock) { surfaces[marker.surfaceId] } ?: return
        if (
            surface.targetId != marker.targetId ||
            normalizedHttpOrigin(marker.frameworkOrigin) != surface.frameworkOrigin ||
            normalizedHttpOrigin(probe.optString("url")) !in surface.origins
        ) return
        val candidate = FrameCandidate(
            context = context,
            surface = surface,
            marker = marker,
            url = probe.optString("url").trim(),
            title = probe.optString("title").trim(),
            bindingName = frameBindingName(context, surface),
        )
        if (surface.devRuntime && marker.devRuntime) installConsoleBridge(candidate)
        if (synchronized(lock) { runProfilesEnabled } && surface.devTools && marker.devTools) {
            sendInternal(
                method = "Runtime.addBinding",
                params = JSONObject()
                    .put("name", candidate.bindingName)
                    .put("executionContextId", context.executionContextId),
                sessionId = context.sessionId,
                pending = PendingCommand.BindingInstall(candidate),
            )
        }
    }

    private fun completeBindingInstall(candidate: FrameCandidate, message: JSONObject) {
        if (message.has("error") || !isInspectorCandidateCurrent(candidate)) return
        val expression = buildString(
            chobitsuSource.length + targetRuntimeSource.length + 128,
        ) {
            append(chobitsuSource)
            append("\n;\n")
            append(targetRuntimeSource)
            append("\n;globalThis.__te2InstallCefriumDevToolsTarget(")
            append(JSONObject.quote(candidate.bindingName))
            append(");")
        }
        sendInternal(
            method = "Runtime.evaluate",
            params = JSONObject()
                .put("expression", expression)
                .put("contextId", candidate.context.executionContextId)
                .put("returnByValue", true)
                .put("awaitPromise", false),
            sessionId = candidate.context.sessionId,
            pending = PendingCommand.RuntimeInstall(candidate),
        )
    }

    private fun completeRuntimeInstall(candidate: FrameCandidate, message: JSONObject) {
        if (message.has("error") || !isInspectorCandidateCurrent(candidate)) return
        val installed = message.optJSONObject("result")
            ?.optJSONObject("result")
            ?.optBoolean("value", false) == true
        if (!installed) return
        registerFrameTarget(candidate)
    }

    private fun isCandidateCurrent(candidate: FrameCandidate): Boolean = synchronized(lock) {
        started &&
            contexts[candidate.context.key] == candidate.context &&
            surfaces[candidate.surface.surfaceId] == candidate.surface
    }

    private fun isInspectorCandidateCurrent(candidate: FrameCandidate): Boolean =
        isCandidateCurrent(candidate) && synchronized(lock) {
            runProfilesEnabled && candidate.surface.devTools && candidate.marker.devTools
        }

    private fun isConsoleCandidateCurrent(candidate: FrameCandidate): Boolean =
        isCandidateCurrent(candidate) && candidate.surface.devRuntime && candidate.marker.devRuntime

    private fun installConsoleBridge(candidate: FrameCandidate) {
        val accepted = synchronized(lock) {
            if (
                !isConsoleCandidateCurrent(candidate) ||
                consoleContexts[candidate.context.key] == candidate.surface.surfaceId ||
                !pendingConsoleContexts.add(candidate.context.key)
            ) false else true
        }
        if (!accepted) return

        sourceExecutor.execute {
            val sources = try {
                loadConsoleSources(candidate.surface.frameworkOrigin)
            } catch (error: Exception) {
                failConsoleInjection(candidate, error.message ?: error.javaClass.simpleName)
                return@execute
            }
            if (!isConsoleCandidateCurrent(candidate)) {
                synchronized(lock) { pendingConsoleContexts.remove(candidate.context.key) }
                return@execute
            }
            val init = JSONObject()
                .put("appId", "code_te2")
                .put("baseUrl", candidate.surface.frameworkOrigin)
                .put("workerLabel", candidate.surface.workerLabel)
                .put(
                    "workerIdPrefix",
                    cefriumConsoleWorkerPrefix(candidate.surface.workerIdBase),
                )
                .put("workerOwnerLength", 4)
                .put("uniquePerWindow", true)
            val expression = buildString(
                sources.socketIo.length + sources.consoleBridge.length + 512,
            ) {
                append("(()=>{if(globalThis.__te2RunProfileConsoleBridge)return true;\n")
                append(sources.socketIo)
                append("\n;\n")
                append(sources.consoleBridge)
                append("\n;globalThis.__te2RunProfileConsoleBridge=initConsoleBridge(")
                append(init.toString())
                append(");return !!globalThis.__te2RunProfileConsoleBridge;})()")
            }
            val sent = sendInternal(
                method = "Runtime.evaluate",
                params = JSONObject()
                    .put("expression", expression)
                    .put("contextId", candidate.context.executionContextId)
                    .put("returnByValue", true)
                    .put("awaitPromise", false),
                sessionId = candidate.context.sessionId,
                pending = PendingCommand.ConsoleInstall(candidate),
            )
            if (!sent) failConsoleInjection(candidate, "CDP console injection send failed")
        }
    }

    private fun completeConsoleInstall(candidate: FrameCandidate, message: JSONObject) {
        synchronized(lock) { pendingConsoleContexts.remove(candidate.context.key) }
        if (!isConsoleCandidateCurrent(candidate)) return
        val installed = !message.has("error") &&
            message.optJSONObject("result")
                ?.optJSONObject("result")
                ?.optBoolean("value", false) == true
        if (!installed) {
            val error = message.optJSONObject("error")?.optString("message")
                ?.takeIf(String::isNotBlank)
                ?: message.optJSONObject("result")
                    ?.optJSONObject("exceptionDetails")
                    ?.optString("text")
                    ?.takeIf(String::isNotBlank)
                ?: "CDP console injection was rejected"
            failConsoleInjection(candidate, error)
            return
        }
        synchronized(lock) {
            consoleContexts[candidate.context.key] = candidate.surface.surfaceId
            consoleInjectionCount += 1
            lastConsoleInjectionError = null
        }
    }

    private fun failConsoleInjection(candidate: FrameCandidate, reason: String) {
        synchronized(lock) {
            pendingConsoleContexts.remove(candidate.context.key)
            lastConsoleInjectionError = reason.take(512)
        }
        Log.w(TAG, "Run Profile console injection failed for ${candidate.surface.surfaceId}: $reason")
    }

    private fun loadConsoleSources(origin: String): ConsoleSources {
        synchronized(lock) { consoleSourceCache[origin] }?.let { return it }
        val socketIo = fetchSource("$origin/static/vendor/socket.io.min.js")
        val consoleBridge = stripModuleExports(
            fetchSource("$origin/static/js/te2_console_bridge.js"),
        )
        return ConsoleSources(socketIo, consoleBridge).also { sources ->
            synchronized(lock) {
                if (started) consoleSourceCache[origin] = sources
            }
        }
    }

    private fun fetchSource(url: String): String {
        val request = Request.Builder().url(url).get().build()
        return httpClient.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "HTTP ${response.code} while loading $url" }
            response.body?.string()?.takeIf(String::isNotEmpty)
                ?: throw IllegalStateException("$url is empty")
        }
    }

    private fun stripModuleExports(source: String): String = source.replace(
        Regex("\\bexport\\s+(?=(?:async\\s+)?(?:function|class|const|let|var))"),
        "",
    )

    private fun registerFrameTarget(candidate: FrameCandidate) {
        val target = CefriumDevToolsTarget(
            targetId = candidate.surface.targetId,
            title = candidate.title,
            url = candidate.url,
            type = "frame",
            label = candidate.surface.targetLabel,
            sessionId = candidate.context.sessionId,
            executionContextId = candidate.context.executionContextId,
            frameId = candidate.context.frameId,
            surfaceId = candidate.surface.surfaceId,
        )
        val wasActive: Boolean
        synchronized(lock) {
            val previous = targets[target.targetId]
            previous?.takeIf { it.isFrameTarget }?.let {
                contextTargets.entries.removeAll { entry -> entry.value == target.targetId }
            }
            targets[target.targetId] = target
            contextTargets[candidate.context.key] = target.targetId
            wasActive = activeTargetId == target.targetId
            if (wasActive) {
                activeSessionId = null
                targetGeneration += 1
            }
        }
        if (wasActive) listener.onTargetReset(synchronized(lock) { targetGeneration })
        publishTargetsAndActivateIfNeeded()
    }

    private fun handleBindingCalled(sessionId: String?, params: JSONObject?) {
        if (sessionId == null || params == null) return
        val contextId = params.optLong("executionContextId", -1L)
        val bindingName = params.optString("name")
        val payload = params.optString("payload")
        if (contextId < 0 || payload.isEmpty()) return
        val target = synchronized(lock) {
            val targetId = contextTargets["$sessionId:$contextId"] ?: return@synchronized null
            targets[targetId]
        } ?: return
        if (
            target.targetId == synchronized(lock) { activeTargetId } &&
            bindingName == frameBindingName(
                FrameContext(sessionId, contextId, "", target.frameId.orEmpty()),
                synchronized(lock) { surfaces[target.surfaceId] } ?: return,
            )
        ) {
            listener.onProtocolMessage(payload)
        }
    }

    private fun frameBindingName(
        context: FrameContext,
        surface: AndroidDevRuntimeSurface,
    ): String = "__te2Cdp_${surface.surfaceId.hashCode().toUInt().toString(16)}_" +
        context.executionContextId

    private fun removeContext(contextKey: String) {
        val targetId = synchronized(lock) {
            contexts.remove(contextKey)
            consoleContexts.remove(contextKey)
            pendingConsoleContexts.remove(contextKey)
            contextTargets.remove(contextKey)
        }
        if (targetId != null) removeExposedTarget(targetId)
    }

    private fun removeConsoleContext(contextKey: String) {
        val context = synchronized(lock) {
            consoleContexts.remove(contextKey) ?: return
            pendingConsoleContexts.remove(contextKey)
            contexts[contextKey]
        } ?: return
        sendInternal(
            method = "Runtime.evaluate",
            params = JSONObject()
                .put(
                    "expression",
                    "globalThis.__te2RunProfileConsoleBridge?.destroy?.();" +
                        "delete globalThis.__te2RunProfileConsoleBridge;",
                )
                .put("contextId", context.executionContextId)
                .put("returnByValue", false)
                .put("awaitPromise", false),
            sessionId = context.sessionId,
        )
    }

    private fun removeContextsForSession(sessionId: String) {
        val keys = synchronized(lock) {
            contexts.values.filter { it.sessionId == sessionId }.map(FrameContext::key)
        }
        keys.forEach(::removeContext)
    }

    private fun removeContextsForFrame(sessionId: String, frameId: String) {
        val keys = synchronized(lock) {
            contexts.values
                .filter { it.sessionId == sessionId && it.frameId == frameId }
                .map(FrameContext::key)
        }
        keys.forEach(::removeContext)
    }

    private fun removeExposedTarget(targetId: String) {
        val wasActive = synchronized(lock) {
            targets.remove(targetId) ?: return
            contextTargets.entries.removeAll { it.value == targetId }
            if (activeTargetId != targetId) false else {
                activeTargetId = null
                activeSessionId = null
                true
            }
        }
        if (wasActive) listener.onTargetWaiting()
        publishTargetsAndActivateIfNeeded()
    }

    private fun publishTargetsAndActivateIfNeeded() {
        val snapshot: List<CefriumDevToolsTarget>
        val active: String?
        synchronized(lock) {
            if (desiredTargetId == null) {
                desiredTargetId = chooseCefriumDevToolsTarget(targets.values, null)?.targetId
            }
            snapshot = targets.values.toList()
            active = activeTargetId
        }
        listener.onTargetsChanged(snapshot, active)
        if (snapshot.isEmpty()) listener.onTargetWaiting()
        activateDesiredTarget()
    }

    private fun activateDesiredTarget(force: Boolean = false) {
        val target = synchronized(lock) {
            desiredTargetId?.let(targets::get)
        } ?: return
        if (target.isFrameTarget) {
            val previousSession: String?
            val generation: Long
            synchronized(lock) {
                if (!force && activeTargetId == target.targetId && activeSessionId == null) return
                previousSession = activeSessionId
                activeSessionId = null
                activeTargetId = target.targetId
                targetGeneration += 1
                generation = targetGeneration
            }
            if (previousSession != null) {
                sendInternal(
                    "Target.detachFromTarget",
                    JSONObject().put("sessionId", previousSession),
                )
            }
            listener.onTargetReset(generation)
            listener.onTargetsChanged(synchronized(lock) { targets.values.toList() }, target.targetId)
            return
        }
        attachDirectTarget(target.targetId, force = force)
    }

    private fun attachDirectTarget(targetId: String, force: Boolean = false) {
        val previousSession: String?
        synchronized(lock) {
            if (controlSocket == null || !targets.containsKey(targetId)) return
            if (!force && activeTargetId == targetId && activeSessionId != null) return
            if (pendingCommands.values.any {
                    it is PendingCommand.DirectAttach && it.targetId == targetId
                }
            ) return
            previousSession = activeSessionId
            activeSessionId = null
            activeTargetId = null
        }
        if (previousSession != null) {
            sendInternal(
                "Target.detachFromTarget",
                JSONObject().put("sessionId", previousSession),
            )
        }
        sendInternal(
            method = "Target.attachToTarget",
            params = JSONObject().put("targetId", targetId).put("flatten", true),
            pending = PendingCommand.DirectAttach(targetId),
        )
    }

    private fun completeDirectAttach(targetId: String, message: JSONObject) {
        val sessionId = message.optJSONObject("result")?.optString("sessionId").orEmpty()
        if (sessionId.isBlank()) {
            setStatus("error: target attach failed")
            return
        }
        val accepted: Boolean
        val generation: Long
        synchronized(lock) {
            accepted = started && desiredTargetId == targetId && targets.containsKey(targetId)
            if (accepted) {
                activeTargetId = targetId
                activeSessionId = sessionId
                targetGeneration += 1
            }
            generation = targetGeneration
        }
        if (!accepted) {
            sendInternal("Target.detachFromTarget", JSONObject().put("sessionId", sessionId))
            return
        }
        listener.onTargetReset(generation)
        listener.onTargetsChanged(synchronized(lock) { targets.values.toList() }, targetId)
    }

    private fun clearActiveTarget() {
        synchronized(lock) {
            activeTargetId = null
            activeSessionId = null
        }
        listener.onTargetWaiting()
    }

    private fun sendInternal(
        method: String,
        params: JSONObject,
        sessionId: String? = null,
        pending: PendingCommand? = null,
    ): Boolean {
        val socket = synchronized(lock) { controlSocket } ?: return false
        val id = commandId.incrementAndGet()
        if (pending != null) synchronized(lock) { pendingCommands[id] = pending }
        val message = JSONObject()
            .put("id", id)
            .put("method", method)
            .put("params", params)
        if (sessionId != null) message.put("sessionId", sessionId)
        val sent = socket.send(message.toString())
        if (!sent && pending != null) synchronized(lock) { pendingCommands.remove(id) }
        return sent
    }

    private fun handleControlDisconnect(epoch: Long, reason: String) {
        val shouldReconnect = synchronized(lock) {
            if (epoch != controlEpoch) return@synchronized false
            controlSocket = null
            clearConnectionStateLocked()
            status = reason
            started
        }
        listener.onStatusChanged(reason)
        listener.onTargetsChanged(emptyList(), null)
        listener.onTargetWaiting()
        if (shouldReconnect) scheduleReconnect(epoch)
    }

    private fun clearConnectionStateLocked() {
        activeTargetId = null
        activeSessionId = null
        pendingCommands.clear()
        targets.clear()
        browserTargets.clear()
        monitorSessions.clear()
        monitorAttachTargets.clear()
        contexts.clear()
        contextTargets.clear()
        consoleContexts.clear()
        pendingConsoleContexts.clear()
    }

    private fun scheduleReconnect(epoch: Long) {
        val delay = synchronized(lock) {
            if (!started || epoch != controlEpoch) return
            reconnectAttempt += 1
            RECONNECT_DELAYS_MS[(reconnectAttempt - 1).coerceAtMost(RECONNECT_DELAYS_MS.lastIndex)]
        }
        scheduleControlConnect(delay)
    }

    private fun setStatus(next: String) {
        synchronized(lock) { status = next }
        listener.onStatusChanged(next)
    }

    override fun close() {
        val activeServer: DevToolsServer?
        val activeBridge: CefriumDevToolsSocketBridge?
        val activeSocket: WebSocket?
        synchronized(lock) {
            if (!started && server == null && socketBridge == null) return
            started = false
            controlEpoch += 1
            activeServer = server
            activeBridge = socketBridge
            activeSocket = controlSocket
            server = null
            socketBridge = null
            controlSocket = null
            clearConnectionStateLocked()
            status = "disabled"
        }
        activeSocket?.close(1000, "disabled")
        activeBridge?.close()
        runCatching { activeServer?.setRemoteDebuggingEnabled(false) }
        runCatching { activeServer?.destroy() }
        scheduler.shutdownNow()
        sourceExecutor.shutdownNow()
        listener.onStatusChanged("disabled")
        listener.onTargetsChanged(emptyList(), null)
        listener.onTargetWaiting()
    }

    private fun loopbackWebSocketUrl(rawUrl: String, bridgePort: Int): String {
        val uri = URI(rawUrl)
        val path = buildString {
            append(uri.rawPath?.takeIf { it.isNotBlank() } ?: "/")
            uri.rawQuery?.let { append('?').append(it) }
        }
        return "ws://127.0.0.1:$bridgePort$path"
    }

    private fun fetchDiscoveryTargets(bridgePort: Int): List<CefriumDevToolsTarget> {
        val request = Request.Builder()
            .url("http://127.0.0.1:$bridgePort/json/list")
            .header("Host", "localhost")
            .get()
            .build()
        return httpClient.newCall(request).execute().use { response ->
            check(response.isSuccessful) {
                "DevTools target discovery returned HTTP ${response.code}"
            }
            val payload = JSONArray(response.body?.string().orEmpty())
            buildList(payload.length()) {
                for (index in 0 until payload.length()) {
                    val target = payload.optJSONObject(index) ?: continue
                    add(
                        CefriumDevToolsTarget(
                            targetId = target.optString("id").trim(),
                            title = target.optString("title").trim(),
                            url = target.optString("url").trim(),
                            type = target.optString("type").trim(),
                        ),
                    )
                }
            }
        }
    }

    private fun normalizedHttpOrigin(rawUrl: String): String? {
        return try {
            val uri = URI(rawUrl)
            if (!uri.scheme.equals("http", ignoreCase = true) || uri.userInfo != null) {
                return null
            }
            val host = uri.host ?: return null
            val port = if (uri.port >= 0) uri.port else 80
            URI("http", null, host.lowercase(), port, null, null, null).toASCIIString()
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        private const val TAG = "CefriumDevTools"
        private const val DEVTOOLS_SOCKET_PREFIX = "te2_cefrium"
        private const val DEVTOOLS_SOCKET_NAME = "${DEVTOOLS_SOCKET_PREFIX}_devtools_remote"
        private const val CONTROL_COMMAND_START = 1_000_000_000L
        private const val FRAME_PROBE_EXPRESSION =
            "JSON.stringify({windowName:String(window.name||''),url:String(location.href)," +
                "title:String(document.title||'')})"
        private val RECONNECT_DELAYS_MS = longArrayOf(100L, 250L, 500L, 1_000L, 2_000L)
    }
}
