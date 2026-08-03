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
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal data class AndroidRunTargetRoute(
    val ticket: String,
    val tunnelPath: String,
    val preferredPort: Int,
    val originalUrl: String,
    val label: String? = null,
)

internal data class AndroidRunTargetRouteSet(
    val relayGroupId: String,
    val primary: AndroidRunTargetRoute,
    val additional: List<AndroidRunTargetRoute>,
)

internal data class AndroidRunTargetResolution(
    val mode: String,
    val url: String,
) {
    fun toJson(requestId: String): JSONObject = JSONObject().apply {
        put("type", "run_target_resolve_result")
        put("requestId", requestId)
        put("ok", true)
        put("mode", mode)
        put("url", url)
    }
}

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
        return AndroidRunTargetRouteSet(primary.ticket, primary, emptyList())
    }
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
    return AndroidRunTargetRouteSet(relayGroupId, primary, additional)
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

/** Owns native loopback listeners used to make remote Run Profile ports local. */
internal class RunTargetRelayManager(
    private val httpClient: OkHttpClient,
    private val executor: ExecutorService = Executors.newCachedThreadPool(),
) {
    private data class Entry(
        val groupId: String,
        val route: AndroidRunTargetRoute,
        val frameworkBaseUrl: String,
        val server: ServerSocket,
        val sockets: MutableSet<Socket> = ConcurrentHashMap.newKeySet(),
        val websockets: MutableSet<WebSocket> = ConcurrentHashMap.newKeySet(),
        val running: AtomicBoolean = AtomicBoolean(true),
    )

    private val lock = Any()
    private val entries = mutableMapOf<Int, Entry>()

    fun resolve(
        rawRoute: JSONObject,
        frameworkBaseUrl: String,
        completion: (Result<AndroidRunTargetResolution>) -> Unit,
    ) {
        executor.execute {
            val result = runCatching {
                val legacy = !rawRoute.has("primary")
                val routeSet = normalizeAndroidRunTargetRouteSet(rawRoute)
                synchronized(lock) {
                    val existing = entries[routeSet.primary.preferredPort]
                    if (existing != null && existing.groupId != routeSet.relayGroupId) {
                        if (legacy) {
                            stopGroupLocked(existing.groupId)
                        } else {
                            throw IllegalStateException(
                                "Run target port ${routeSet.primary.preferredPort} " +
                                    "is owned by another profile",
                            )
                        }
                    }
                    if (groupMatchesLocked(routeSet)) {
                        return@synchronized AndroidRunTargetResolution(
                            mode = "tunnel",
                            url = localAndroidRunTargetUrl(routeSet.primary),
                        )
                    }
                    stopGroupLocked(routeSet.relayGroupId)

                    try {
                        startEntryLocked(
                            routeSet.relayGroupId,
                            routeSet.primary,
                            frameworkBaseUrl,
                        )
                    } catch (error: BindException) {
                        return@synchronized AndroidRunTargetResolution(
                            mode = "direct",
                            url = routeSet.primary.originalUrl,
                        )
                    }
                    try {
                        routeSet.additional.forEach { route ->
                            val occupied = entries[route.preferredPort]
                            if (occupied != null && occupied.groupId != routeSet.relayGroupId) {
                                throw IllegalStateException(
                                    "${route.label} port ${route.preferredPort} " +
                                        "is owned by another run profile",
                                )
                            }
                            try {
                                startEntryLocked(
                                    routeSet.relayGroupId,
                                    route,
                                    frameworkBaseUrl,
                                )
                            } catch (error: BindException) {
                                throw IllegalStateException(
                                    "${route.label} port ${route.preferredPort} is already in use",
                                    error,
                                )
                            }
                        }
                    } catch (error: Exception) {
                        stopGroupLocked(routeSet.relayGroupId)
                        throw error
                    }
                    AndroidRunTargetResolution(
                        mode = "tunnel",
                        url = localAndroidRunTargetUrl(routeSet.primary),
                    )
                }
            }
            completion(result)
        }
    }

    fun stopAll() {
        synchronized(lock) {
            entries.values.toList().forEach(::stopEntryLocked)
            entries.clear()
        }
    }

    fun close() {
        stopAll()
        executor.shutdownNow()
    }

    private fun acceptLoop(entry: Entry) {
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
    }

    private fun startEntryLocked(
        groupId: String,
        route: AndroidRunTargetRoute,
        frameworkBaseUrl: String,
    ) {
        val server = ServerSocket()
        server.reuseAddress = false
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
        entry.sockets.toList().forEach { runCatching { it.close() } }
        entry.sockets.clear()
        entry.websockets.toList().forEach { it.cancel() }
        entry.websockets.clear()
    }
}
