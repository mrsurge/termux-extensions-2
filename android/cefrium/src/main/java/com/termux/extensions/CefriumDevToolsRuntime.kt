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
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

internal data class CefriumDevToolsTarget(
    val targetId: String,
    val title: String,
    val url: String,
    val type: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("targetId", targetId)
        .put("targetLabel", targetLabel())
        .put("title", title)
        .put("url", url)

    fun targetLabel(): String = when {
        url.contains("/fws") -> "Processes"
        url.contains("/app/") -> "App"
        title.isNotBlank() -> "Page"
        else -> "Cefrium"
    }
}

internal fun chooseCefriumDevToolsTarget(
    targets: Collection<CefriumDevToolsTarget>,
    preferredTargetId: String?,
): CefriumDevToolsTarget? =
    targets.firstOrNull { it.targetId == preferredTargetId }
        ?: targets.firstOrNull { it.url.contains("/app/") }
        ?: targets.firstOrNull { !it.url.contains("/fws") }
        ?: targets.firstOrNull()

internal fun isInspectableCefriumDevToolsTarget(target: CefriumDevToolsTarget): Boolean =
    target.targetId.isNotBlank() &&
        target.url.isNotBlank() &&
        (target.type == "page" || target.type == "other") &&
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
) : Closeable {
    interface Listener {
        fun onStatusChanged(status: String)
        fun onTargetsChanged(targets: List<CefriumDevToolsTarget>, activeTargetId: String?)
        fun onTargetReset(generation: Long)
        fun onTargetWaiting()
        fun onProtocolMessage(payload: String)
    }

    private val lock = Any()
    private val scheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { task ->
        Thread(task, "cefrium-devtools-control").apply { isDaemon = true }
    }
    private val commandId = AtomicLong(CONTROL_COMMAND_START)
    private val targets = linkedMapOf<String, CefriumDevToolsTarget>()
    private val pendingAttachCommands = mutableMapOf<Long, String>()

    private var server: DevToolsServer? = null
    private var socketBridge: CefriumDevToolsSocketBridge? = null
    private var controlSocket: WebSocket? = null
    private var controlEpoch = 0L
    private var started = false
    private var reconnectAttempt = 0
    private var desiredTargetId: String? = null
    private var activeTargetId: String? = null
    private var activeSessionId: String? = null
    private var targetGeneration = 0L
    private var status = "disabled"

    fun start(preferredTargetId: String?) {
        synchronized(lock) {
            desiredTargetId = preferredTargetId
            if (started) return
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

    fun selectTarget(targetId: String) {
        val normalized = targetId.trim()
        if (normalized.isEmpty()) return
        synchronized(lock) { desiredTargetId = normalized }
        attachDesiredTarget()
    }

    fun sendProtocol(payload: String): Boolean {
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

    fun debugSnapshot(): JSONObject = synchronized(lock) {
        JSONObject()
            .put("available", true)
            .put("renderer", "cefrium")
            .put("enabled", started)
            .put("status", status)
            .put("controlConnected", controlSocket != null)
            .put("bridgePort", socketBridge?.port ?: JSONObject.NULL)
            .put("targetCount", targets.size)
            .put("activeTargetId", activeTargetId ?: JSONObject.NULL)
            .put("desiredTargetId", desiredTargetId ?: JSONObject.NULL)
            .put("targetGeneration", targetGeneration)
            .put("targets", org.json.JSONArray().apply {
                targets.values.forEach { put(it.toJson()) }
            })
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
                targets.clear()
                discoveredTargets
                    .filter(::isInspectableCefriumDevToolsTarget)
                    .forEach { targets[it.targetId] = it }
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
            sendControlCommand(
                "Target.setDiscoverTargets",
                JSONObject().put("discover", true),
            )
            publishTargetsAndAttachIfNeeded()
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

        val sessionId = message.optString("sessionId").takeIf { it.isNotBlank() }
        if (sessionId != null) {
            val rootSessionId = synchronized(lock) { activeSessionId }
            if (rootSessionId == null) return
            if (sessionId == rootSessionId) message.remove("sessionId")
            listener.onProtocolMessage(message.toString())
            return
        }

        when (message.optString("method")) {
            "Target.targetCreated",
            "Target.targetInfoChanged" -> {
                val info = message.optJSONObject("params")?.optJSONObject("targetInfo") ?: return
                updateTarget(info)
                return
            }
            "Target.targetDestroyed" -> {
                val targetId = message.optJSONObject("params")?.optString("targetId").orEmpty()
                removeTarget(targetId)
                return
            }
            "Target.detachedFromTarget" -> {
                val detachedSession = message.optJSONObject("params")
                    ?.optString("sessionId")
                    .orEmpty()
                val shouldAttach = synchronized(lock) {
                    if (detachedSession != activeSessionId) return@synchronized false
                    activeSessionId = null
                    activeTargetId = null
                    true
                }
                if (shouldAttach) attachDesiredTarget()
                return
            }
        }

        val responseId = message.optLong("id", Long.MIN_VALUE)
        if (responseId != Long.MIN_VALUE) handleControlResponse(responseId, message)
    }

    private fun updateTarget(info: JSONObject) {
        val target = CefriumDevToolsTarget(
            targetId = info.optString("targetId").trim(),
            title = info.optString("title").trim(),
            url = info.optString("url").trim(),
            type = info.optString("type").trim(),
        )
        if (!isInspectableCefriumDevToolsTarget(target)) {
            removeTarget(target.targetId)
            return
        }
        synchronized(lock) { targets[target.targetId] = target }
        publishTargetsAndAttachIfNeeded()
    }

    private fun removeTarget(targetId: String) {
        if (targetId.isBlank()) return
        synchronized(lock) {
            targets.remove(targetId)
            if (targetId == activeTargetId) {
                activeTargetId = null
                activeSessionId = null
            }
            if (targetId == desiredTargetId) desiredTargetId = null
        }
        publishTargetsAndAttachIfNeeded()
    }

    private fun publishTargetsAndAttachIfNeeded() {
        val snapshot: List<CefriumDevToolsTarget>
        val active: String?
        val needsAttach: Boolean
        synchronized(lock) {
            val selected = chooseCefriumDevToolsTarget(targets.values, desiredTargetId)
            desiredTargetId = selected?.targetId
            snapshot = targets.values.toList()
            active = activeTargetId
            needsAttach = selected != null && activeSessionId == null
        }
        listener.onTargetsChanged(snapshot, active)
        if (needsAttach) attachDesiredTarget()
        if (snapshot.isEmpty()) listener.onTargetWaiting()
    }

    private fun attachDesiredTarget() {
        val socket: WebSocket
        val targetId: String
        val previousSession: String?
        synchronized(lock) {
            socket = controlSocket ?: return
            targetId = chooseCefriumDevToolsTarget(targets.values, desiredTargetId)?.targetId
                ?: return
            if (targetId == activeTargetId && activeSessionId != null) return
            previousSession = activeSessionId
            activeSessionId = null
            activeTargetId = null
        }
        if (previousSession != null) {
            sendControlCommand(
                "Target.detachFromTarget",
                JSONObject().put("sessionId", previousSession),
            )
        }
        val id = commandId.incrementAndGet()
        synchronized(lock) { pendingAttachCommands[id] = targetId }
        socket.send(
            JSONObject()
                .put("id", id)
                .put("method", "Target.attachToTarget")
                .put(
                    "params",
                    JSONObject()
                        .put("targetId", targetId)
                        .put("flatten", true),
                )
                .toString(),
        )
    }

    private fun handleControlResponse(id: Long, message: JSONObject) {
        val targetId = synchronized(lock) { pendingAttachCommands.remove(id) } ?: return
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
            sendControlCommand(
                "Target.detachFromTarget",
                JSONObject().put("sessionId", sessionId),
            )
            return
        }
        listener.onTargetReset(generation)
        publishTargetsAndAttachIfNeeded()
    }

    private fun sendControlCommand(method: String, params: JSONObject): Boolean {
        val socket = synchronized(lock) { controlSocket } ?: return false
        return socket.send(
            JSONObject()
                .put("id", commandId.incrementAndGet())
                .put("method", method)
                .put("params", params)
                .toString(),
        )
    }

    private fun handleControlDisconnect(epoch: Long, reason: String) {
        val shouldReconnect = synchronized(lock) {
            if (epoch != controlEpoch) return@synchronized false
            controlSocket = null
            activeTargetId = null
            activeSessionId = null
            pendingAttachCommands.clear()
            targets.clear()
            status = reason
            started
        }
        listener.onStatusChanged(reason)
        listener.onTargetsChanged(emptyList(), null)
        listener.onTargetWaiting()
        if (shouldReconnect) scheduleReconnect(epoch)
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
            targets.clear()
            pendingAttachCommands.clear()
            activeTargetId = null
            activeSessionId = null
            status = "disabled"
        }
        activeSocket?.close(1000, "disabled")
        activeBridge?.close()
        runCatching { activeServer?.setRemoteDebuggingEnabled(false) }
        runCatching { activeServer?.destroy() }
        scheduler.shutdownNow()
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

    companion object {
        private const val TAG = "CefriumDevTools"
        private const val DEVTOOLS_SOCKET_PREFIX = "te2_cefrium"
        private const val DEVTOOLS_SOCKET_NAME = "${DEVTOOLS_SOCKET_PREFIX}_devtools_remote"
        private const val CONTROL_COMMAND_START = 1_000_000_000L
        private val RECONNECT_DELAYS_MS = longArrayOf(100L, 250L, 500L, 1_000L, 2_000L)
    }
}
