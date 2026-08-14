package com.termux.extensions

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.net.BindException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

internal data class AndroidRunTargetRoute(
    val ticket: String,
    val tunnelPath: String,
    val preferredPort: Int,
    val originalUrl: String,
    val label: String? = null,
)

internal data class AndroidRunTargetRouteSet(
    val ownerId: String,
    val shellId: String,
    val relayGroupId: String,
    val primary: AndroidRunTargetRoute,
    val additional: List<AndroidRunTargetRoute>,
)

internal fun normalizeAndroidRunTargetRoute(
    raw: JSONObject,
    requireLabel: Boolean = false,
): AndroidRunTargetRoute {
    val ticket = raw.optString("ticket").trim()
    val tunnelPath = raw.optString("tunnelPath").trim()
    val preferredPort = raw.optInt("preferredPort", -1)
    val originalUrl = raw.optString("originalUrl").trim()
    require(ticket.matches(Regex("^[0-9a-f]{64}$"))) { "Run target ticket is invalid" }
    require(tunnelPath == "/api/run-targets/$ticket/tunnel") {
        "Run target tunnel path is invalid"
    }
    require(preferredPort in 1..65535) { "Run target preferred port is invalid" }
    val uri = URI(originalUrl)
    require(uri.scheme.equals("http", ignoreCase = true) && uri.userInfo == null) {
        "Run target URL must be credential-free HTTP"
    }
    require(uri.host in setOf("127.0.0.1", "localhost", "::1")) {
        "Run target URL must address server loopback"
    }
    require((if (uri.port >= 0) uri.port else 80) == preferredPort) {
        "Run target URL port does not match preferredPort"
    }
    val label = raw.optString("label").trim().ifEmpty { null }
    require(!requireLabel || label != null) { "Run target auxiliary route label is required" }
    return AndroidRunTargetRoute(ticket, tunnelPath, preferredPort, originalUrl, label)
}

internal fun normalizeAndroidRunTargetRouteSet(raw: JSONObject): AndroidRunTargetRouteSet {
    if (!raw.has("primary")) {
        val primary = normalizeAndroidRunTargetRoute(raw)
        return AndroidRunTargetRouteSet("", "", primary.ticket, primary, emptyList())
    }
    val ownerId = raw.optString("ownerId").trim()
    val shellId = raw.optString("shellId").trim()
    require(ownerId.isNotEmpty()) { "Run target owner id is required" }
    require(shellId.isNotEmpty()) { "Run target shell id is required" }
    val relayGroupId = raw.optString("relayGroupId").trim()
    require(relayGroupId.matches(Regex("^[0-9a-f]{64}$"))) {
        "Run target relay group is invalid"
    }
    val primaryRaw = raw.optJSONObject("primary")
        ?: throw IllegalArgumentException("Run target primary route is required")
    val primary = normalizeAndroidRunTargetRoute(primaryRaw)
    val additionalRaw = raw.optJSONArray("additional")
        ?: throw IllegalArgumentException("Run target auxiliary routes are invalid")
    require(additionalRaw.length() <= 8) { "Run target supports at most 8 auxiliary routes" }
    val seenPorts = mutableSetOf(primary.preferredPort)
    val additional = buildList {
        for (index in 0 until additionalRaw.length()) {
            val routeRaw = additionalRaw.optJSONObject(index)
                ?: throw IllegalArgumentException("Run target auxiliary route is invalid")
            val route = normalizeAndroidRunTargetRoute(routeRaw, requireLabel = true)
            require(seenPorts.add(route.preferredPort)) {
                "Run target contains duplicate port ${route.preferredPort}"
            }
            add(route)
        }
    }
    require(relayGroupId == primary.ticket) { "Run target relay group is invalid" }
    return AndroidRunTargetRouteSet(ownerId, shellId, relayGroupId, primary, additional)
}

internal fun normalizeAndroidRunTargetProjection(raw: JSONObject): List<AndroidRunTargetRouteSet> {
    require(raw.optString("dto") == "RunTargetRouteProjection") {
        "Run target projection is invalid"
    }
    require(raw.optInt("version", -1) == 1) { "Run target projection version is invalid" }
    val groups = raw.optJSONArray("groups")
        ?: throw IllegalArgumentException("Run target projection groups are invalid")
    return buildList {
        for (index in 0 until groups.length()) {
            add(
                normalizeAndroidRunTargetRouteSet(
                    groups.optJSONObject(index)
                        ?: throw IllegalArgumentException("Run target projection group is invalid"),
                ),
            )
        }
    }
}

internal fun localAndroidRunTargetUrl(route: AndroidRunTargetRoute): String {
    val source = URI(route.originalUrl)
    return URI(
        "http",
        null,
        "127.0.0.1",
        route.preferredPort,
        source.rawPath,
        source.rawQuery,
        source.rawFragment,
    ).toASCIIString()
}

private fun tunnelWebSocketUrl(frameworkBaseUrl: String, tunnelPath: String): String {
    val base = URI(frameworkBaseUrl.trimEnd('/') + "/")
    val resolved = base.resolve(tunnelPath)
    val scheme = when (resolved.scheme.lowercase()) {
        "http" -> "ws"
        "https" -> "wss"
        else -> throw IllegalArgumentException(
            "Run target tunnel requires an HTTP or HTTPS framework origin",
        )
    }
    return URI(
        scheme,
        resolved.userInfo,
        resolved.host,
        resolved.port,
        resolved.rawPath,
        resolved.rawQuery,
        null,
    ).toASCIIString()
}

internal fun isAndroidConfiguredFrameworkLoopback(frameworkBaseUrl: String): Boolean {
    val host = runCatching {
        URI(frameworkBaseUrl.trimEnd('/') + "/").host
    }.getOrNull()?.removeSurrounding("[", "]")?.lowercase()
    return host in setOf("127.0.0.1", "localhost", "::1")
}

/** Owns native loopback listeners used to make remote Run Profile ports local. */
internal class RunTargetRelayManager(
    private val httpClient: OkHttpClient,
    private val executor: ExecutorService = Executors.newCachedThreadPool(),
    private val localityClassifier: (String) -> Boolean =
        ::isAndroidConfiguredFrameworkLoopback,
) {
    private data class GroupIdentity(
        val ownerId: String,
        val shellId: String,
    )

    private data class Entry(
        val groupId: String,
        val route: AndroidRunTargetRoute,
        val frameworkBaseUrl: String,
        val server: ServerSocket,
        val sockets: MutableSet<Socket> = ConcurrentHashMap.newKeySet(),
        val websockets: MutableSet<WebSocket> = ConcurrentHashMap.newKeySet(),
        val running: AtomicBoolean = AtomicBoolean(true),
        val acceptStopped: CountDownLatch = CountDownLatch(1),
    )

    private val lock = Any()
    private val mutationExecutor = Executors.newSingleThreadExecutor()
    private val entries = mutableMapOf<Int, Entry>()
    private val groupIdentities = mutableMapOf<String, GroupIdentity>()
    private var activeRoutesByShellId = emptyMap<String, AndroidRunTargetRouteSet>()
    private var hasAuthoritativeProjection = false
    private var projectionReady = false
    private var lastConfiguredLoopback: Boolean? = null
    private var lastError: String? = null
    private val projectionGeneration = AtomicLong(0)
    fun updateRouteProjection(
        rawProjection: JSONObject,
        frameworkBaseUrl: String,
        completion: (Result<Unit>) -> Unit = {},
    ) {
        val groups = normalizeAndroidRunTargetProjection(rawProjection)
        val next = groups.associateBy { it.shellId }
        val generation = projectionGeneration.incrementAndGet()
        synchronized(lock) {
            activeRoutesByShellId = next
            hasAuthoritativeProjection = true
            projectionReady = false
        }
        mutationExecutor.execute {
            val result = runCatching {
                val configuredLoopback = localityClassifier(frameworkBaseUrl)
                synchronized(lock) {
                    if (generation != projectionGeneration.get()) return@synchronized
                    require(hasAuthoritativeProjection) {
                        "Run target route authority is unavailable"
                    }
                    reconcileProjectionLocked(next, frameworkBaseUrl, configuredLoopback)
                    lastConfiguredLoopback = configuredLoopback
                    lastError = null
                    projectionReady = true
                }
            }
            result.exceptionOrNull()?.let { error ->
                synchronized(lock) {
                    if (generation == projectionGeneration.get()) {
                        lastError = error.message ?: error.javaClass.simpleName
                        projectionReady = false
                    }
                }
            }
            completion(result)
        }
    }

    fun suspendRouteProjection() {
        synchronized(lock) {
            hasAuthoritativeProjection = false
            projectionReady = false
            projectionGeneration.incrementAndGet()
        }
    }

    fun isProjectionReady(): Boolean = synchronized(lock) {
        hasAuthoritativeProjection && projectionReady
    }

    fun debugSnapshot(): JSONObject = synchronized(lock) {
        JSONObject().apply {
            put("authorityAvailable", hasAuthoritativeProjection)
            put("projectionReady", projectionReady)
            put("configuredLoopback", lastConfiguredLoopback ?: JSONObject.NULL)
            put("lastError", lastError ?: JSONObject.NULL)
            put("projectedGroups", activeRoutesByShellId.size)
            put("listenerPorts", org.json.JSONArray(entries.keys.sorted()))
        }
    }

    fun stopAll() {
        synchronized(lock) {
            hasAuthoritativeProjection = false
            projectionReady = false
            activeRoutesByShellId = emptyMap()
            projectionGeneration.incrementAndGet()
            groupIdentities.clear()
            entries.values.toList().forEach(::stopEntryLocked)
            entries.clear()
            lastConfiguredLoopback = null
            lastError = null
        }
    }

    fun close() {
        stopAll()
        mutationExecutor.shutdownNow()
        executor.shutdownNow()
    }

    private fun reconcileProjectionLocked(
        next: Map<String, AndroidRunTargetRouteSet>,
        frameworkBaseUrl: String,
        configuredLoopback: Boolean,
    ) {
        val staleGroupIds = groupIdentities.entries
            .filter { (groupId, identity) ->
                val active = next[identity.shellId]
                active == null ||
                    active.ownerId != identity.ownerId ||
                    active.relayGroupId != groupId ||
                    !groupMatchesLocked(active)
            }
            .map { it.key }
        staleGroupIds.forEach(::stopGroupLocked)
        if (configuredLoopback) {
            groupIdentities.keys.toList().forEach(::stopGroupLocked)
            return
        }
        next.values.forEach { routeSet ->
            startOrReuseGroupLocked(routeSet, frameworkBaseUrl)
        }
    }

    private fun startOrReuseGroupLocked(
        routeSet: AndroidRunTargetRouteSet,
        frameworkBaseUrl: String,
    ) {
        val routes = listOf(routeSet.primary) + routeSet.additional
        routes.forEach { route ->
            val occupied = entries[route.preferredPort]
            if (occupied != null && occupied.groupId != routeSet.relayGroupId) {
                val prefix = route.label?.let { "$it " }.orEmpty()
                throw IllegalStateException(
                    "${prefix}port ${route.preferredPort} is already in use",
                )
            }
        }
        if (groupMatchesLocked(routeSet)) return
        stopGroupLocked(routeSet.relayGroupId)
        try {
            routes.forEach { route ->
                try {
                    startEntryLocked(routeSet.relayGroupId, route, frameworkBaseUrl)
                } catch (error: BindException) {
                    val prefix = route.label?.let { "$it " }.orEmpty()
                    throw IllegalStateException(
                        "${prefix}port ${route.preferredPort} is already in use",
                        error,
                    )
                }
            }
            groupIdentities[routeSet.relayGroupId] = GroupIdentity(
                ownerId = routeSet.ownerId,
                shellId = routeSet.shellId,
            )
        } catch (error: Exception) {
            stopGroupLocked(routeSet.relayGroupId)
            throw error
        }
    }

    private fun acceptLoop(entry: Entry) {
        try {
            while (entry.running.get()) {
                val socket = try {
                    entry.server.accept()
                } catch (_: Exception) {
                    break
                }
                if (!entry.running.get()) {
                    socket.close()
                    break
                }
                entry.sockets.add(socket)
                executor.execute { bridge(entry, socket) }
            }
        } finally {
            entry.acceptStopped.countDown()
        }
    }

    private fun startEntryLocked(
        groupId: String,
        route: AndroidRunTargetRoute,
        frameworkBaseUrl: String,
    ) {
        val server = ServerSocket()
        // Exact Framework-Shell replacement must be able to reclaim the same
        // loopback port immediately after the prior owned listener closes.
        // SO_REUSEADDR does not permit a second simultaneous listener here;
        // an unrelated live owner still produces BindException.
        server.reuseAddress = true
        try {
            server.bind(
                InetSocketAddress(
                    InetAddress.getByName("127.0.0.1"),
                    route.preferredPort,
                ),
            )
        } catch (error: Exception) {
            server.close()
            throw error
        }
        val entry = Entry(groupId, route, frameworkBaseUrl, server)
        entries[route.preferredPort] = entry
        executor.execute { acceptLoop(entry) }
    }

    private fun groupMatchesLocked(routeSet: AndroidRunTargetRouteSet): Boolean {
        val expected = listOf(routeSet.primary) + routeSet.additional
        val current = entries.values.filter { it.groupId == routeSet.relayGroupId }
        return current.size == expected.size && expected.all { route ->
            entries[route.preferredPort]?.let { entry ->
                entry.groupId == routeSet.relayGroupId && entry.route.ticket == route.ticket
            } == true
        }
    }

    private fun stopGroupLocked(groupId: String) {
        groupIdentities.remove(groupId)
        entries.values.filter { it.groupId == groupId }.toList().forEach(::stopEntryLocked)
    }

    private fun bridge(entry: Entry, socket: Socket) {
        socket.tcpNoDelay = true
        val closed = AtomicBoolean(false)
        var websocket: WebSocket? = null

        fun closePair() {
            if (!closed.compareAndSet(false, true)) return
            entry.sockets.remove(socket)
            websocket?.let {
                entry.websockets.remove(it)
                it.cancel()
            }
            runCatching { socket.close() }
        }

        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                executor.execute {
                    val buffer = ByteArray(64 * 1024)
                    try {
                        val input = socket.getInputStream()
                        while (!closed.get()) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            if (read > 0 && !webSocket.send(buffer.toByteString(0, read))) break
                        }
                    } catch (_: Exception) {
                    } finally {
                        closePair()
                    }
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                try {
                    synchronized(socket) {
                        socket.getOutputStream().apply {
                            write(bytes.toByteArray())
                            flush()
                        }
                    }
                } catch (_: Exception) {
                    closePair()
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                closePair()
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                closePair()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                closePair()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                closePair()
            }
        }
        val request = Request.Builder()
            .url(tunnelWebSocketUrl(entry.frameworkBaseUrl, entry.route.tunnelPath))
            .build()
        val created = httpClient.newWebSocket(request, listener)
        websocket = created
        if (closed.get()) created.cancel() else entry.websockets.add(created)
    }

    private fun stopEntryLocked(entry: Entry) {
        if (entries[entry.route.preferredPort] === entry) {
            entries.remove(entry.route.preferredPort)
        }
        entry.running.set(false)
        runCatching { entry.server.close() }
        runCatching { entry.acceptStopped.await(1, TimeUnit.SECONDS) }
        entry.sockets.toList().forEach { runCatching { it.close() } }
        entry.sockets.clear()
        entry.websockets.toList().forEach { it.cancel() }
        entry.websockets.clear()
    }
}
