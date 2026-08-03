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

internal fun normalizeAndroidRunTargetRoute(raw: JSONObject): AndroidRunTargetRoute {
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
    return AndroidRunTargetRoute(ticket, tunnelPath, preferredPort, originalUrl)
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
                val route = normalizeAndroidRunTargetRoute(rawRoute)
                synchronized(lock) {
                    val existing = entries[route.preferredPort]
                    if (existing?.route?.ticket == route.ticket) {
                        return@synchronized AndroidRunTargetResolution(
                            mode = "tunnel",
                            url = localAndroidRunTargetUrl(route),
                        )
                    }
                    if (existing != null) stopEntryLocked(existing)

                    val server = ServerSocket()
                    server.reuseAddress = false
                    try {
                        server.bind(
                            InetSocketAddress(
                                InetAddress.getByName("127.0.0.1"),
                                route.preferredPort,
                            ),
                        )
                    } catch (error: BindException) {
                        server.close()
                        return@synchronized AndroidRunTargetResolution(
                            mode = "direct",
                            url = route.originalUrl,
                        )
                    } catch (error: Exception) {
                        server.close()
                        throw error
                    }
                    val entry = Entry(route, frameworkBaseUrl, server)
                    entries[route.preferredPort] = entry
                    executor.execute { acceptLoop(entry) }
                    AndroidRunTargetResolution(
                        mode = "tunnel",
                        url = localAndroidRunTargetUrl(route),
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
