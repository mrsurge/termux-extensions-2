package com.termux.extensions

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.net.URLConnection
import java.nio.charset.StandardCharsets
import java.util.Collections
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * Stable loopback origin shared by Android browser clients.
 *
 * Android-owned launcher/API routes and inventory-approved editor assets
 * terminate here. All other HTTP, SSE, Socket.IO, and raw WebSocket traffic is
 * streamed byte-for-byte to the configured TE2 origin.
 */
class AndroidFrameworkRelay(
    assetRoot: File? = null,
    assetPathResolver: ((String) -> String?)? = null,
    requestHandler: ((LocalHttpRequest) -> LocalHttpResponse?)? = null,
) {
    private data class LocalRouting(
        val assetRoot: File?,
        val assetPathResolver: ((String) -> String?)?,
        val requestHandler: ((LocalHttpRequest) -> LocalHttpResponse?)?,
    )

    @Volatile
    private var localRouting = LocalRouting(assetRoot, assetPathResolver, requestHandler)

    @Volatile
    var port: Int = 0
        private set

    @Volatile
    private var target = RelayTarget.parse(AndroidAppSettings().frameworkBaseUrl)

    @Volatile
    private var running = false

    private var serverSocket: ServerSocket? = null
    private var serverThread: Thread? = null
    private val workerIndex = AtomicInteger(0)
    private val workers = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "AndroidFrameworkRelay-${workerIndex.incrementAndGet()}").apply {
            isDaemon = true
        }
    }
    private val activeSockets = Collections.synchronizedSet(mutableSetOf<Socket>())
    private val requestSocket = ThreadLocal<Socket?>()

    val browserOrigin: String
        get() {
            check(port > 0) { "Android framework relay has not started" }
            return "http://$LOOPBACK_HOST:$port"
        }

    val configuredOrigin: String
        get() = target.origin

    fun start(configuredOrigin: String) {
        if (running) {
            retarget(configuredOrigin)
            return
        }
        target = RelayTarget.parse(configuredOrigin)
        running = true
        val started = CountDownLatch(1)
        val startupError = AtomicReference<Throwable?>(null)
        serverThread = Thread({
            try {
                val server = ServerSocket().apply {
                    reuseAddress = true
                    bind(InetSocketAddress(LOOPBACK_ADDRESS, 0))
                }
                serverSocket = server
                port = server.localPort
                started.countDown()
                while (running) {
                    try {
                        val socket = server.accept()
                        socket.tcpNoDelay = true
                        track(socket)
                        workers.execute { handleClient(socket) }
                    } catch (error: Exception) {
                        if (running) {
                            System.err.println("[android-framework-relay] accept failed: ${error.message}")
                        }
                    }
                }
            } catch (error: Throwable) {
                startupError.set(error)
            } finally {
                started.countDown()
                closeQuietly(serverSocket)
                serverSocket = null
                port = 0
            }
        }, "AndroidFrameworkRelayServer").apply {
            isDaemon = true
            start()
        }

        val signaled = started.await(START_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        if (!signaled || port <= 0) {
            stop()
            throw IllegalStateException(
                "Android framework relay failed to bind $LOOPBACK_HOST",
                startupError.get(),
            )
        }
        System.out.println("[android-framework-relay] $browserOrigin -> ${target.origin}")
    }

    fun retarget(configuredOrigin: String) {
        val next = RelayTarget.parse(configuredOrigin)
        if (next == target) return
        val previous = target
        target = next
        // A Settings PUT can retarget from inside its relay worker. Preserve
        // that one client long enough to receive the successful local response.
        closeActiveSockets(except = requestSocket.get())
        System.out.println(
            "[android-framework-relay] retargeted $browserOrigin: ${previous.origin} -> ${next.origin}",
        )
    }

    fun url(path: String): String {
        val normalized = if (path.startsWith('/')) path else "/$path"
        return "$browserOrigin$normalized"
    }

    fun rewriteFrameworkUrl(url: String): String {
        val currentTarget = target
        return try {
            val parsed = URI(url)
            if (!currentTarget.matches(parsed)) {
                url
            } else {
                val rawPath = parsed.rawPath?.takeIf { it.isNotEmpty() } ?: "/"
                buildString {
                    append(browserOrigin)
                    append(rawPath)
                    parsed.rawQuery?.let { append('?').append(it) }
                    parsed.rawFragment?.let { append('#').append(it) }
                }
            }
        } catch (_: Exception) {
            url
        }
    }

    fun configureLocalRouting(
        assetRoot: File?,
        assetPathResolver: ((String) -> String?)?,
        requestHandler: ((LocalHttpRequest) -> LocalHttpResponse?)?,
    ) {
        localRouting = LocalRouting(assetRoot, assetPathResolver, requestHandler)
    }

    fun stop() {
        if (!running) return
        running = false
        closeQuietly(serverSocket)
        closeActiveSockets()
        workers.shutdownNow()
        serverThread?.interrupt()
        serverThread = null
        serverSocket = null
        port = 0
    }

    private fun handleClient(client: Socket) {
        requestSocket.set(client)
        try {
            client.soTimeout = HEADER_TIMEOUT_MS
            val input = BufferedInputStream(client.getInputStream())
            val request = readRequest(input) ?: return
            val path = request.target.substringBefore('?')
            val routing = localRouting
            if (request.isChunked && (
                    (routing.requestHandler != null && (
                        path.startsWith(ANDROID_SHELL_PREFIX) ||
                            path.startsWith(ANDROID_API_PREFIX)
                        )) ||
                        routing.assetPathResolver?.invoke(path) != null
                    )
            ) {
                sendLocalResponse(
                    client,
                    request.method,
                    LocalHttpResponse.text(400, "Chunked local requests are not supported"),
                )
                return
            }
            val localBody = if (request.contentLength > 0) {
                readExactly(input, request.contentLength)
            } else {
                ByteArray(0)
            }

            routing.requestHandler?.invoke(
                LocalHttpRequest(
                    method = request.method,
                    path = path,
                    body = localBody,
                ),
            )?.let { response ->
                sendLocalResponse(client, request.method, response)
                return
            }

            val localPath = when {
                routing.assetRoot != null && path.startsWith(ANDROID_SHELL_PREFIX) -> path
                else -> routing.assetPathResolver?.invoke(path)
            }
            if (localPath != null) {
                serveLocalAsset(client, request.method, localPath, routing.assetRoot)
                return
            }

            proxy(client, input, request, localBody)
        } catch (_: Exception) {
            // Browser disconnects and retarget teardown are expected.
        } finally {
            requestSocket.remove()
            untrack(client)
            closeQuietly(client)
        }
    }

    private fun proxy(
        client: Socket,
        clientInput: BufferedInputStream,
        request: HttpRequestHead,
        bodyPrefix: ByteArray,
    ) {
        val currentTarget = target
        val upstream = Socket()
        var responseStarted = false
        track(upstream)
        try {
            upstream.connect(
                InetSocketAddress(currentTarget.host, currentTarget.port),
                CONNECT_TIMEOUT_MS,
            )
            upstream.tcpNoDelay = true
            upstream.soTimeout = 0
            client.soTimeout = 0

            val upstreamOutput = BufferedOutputStream(upstream.getOutputStream())
            writeProxyRequest(upstreamOutput, request, currentTarget)
            if (bodyPrefix.isNotEmpty()) upstreamOutput.write(bodyPrefix)
            upstreamOutput.flush()

            var requestPump: Thread? = null
            if (request.isChunked) {
                requestPump = startRequestPump(clientInput, upstream, upstreamOutput)
            }

            val upstreamInput = BufferedInputStream(upstream.getInputStream())
            val response = readResponse(upstreamInput)
                ?: throw IllegalStateException("Framework relay received no response")
            val clientOutput = BufferedOutputStream(client.getOutputStream())
            writeProxyResponse(clientOutput, response, currentTarget)
            clientOutput.flush()
            responseStarted = true

            if (request.isWebSocketUpgrade && requestPump == null) {
                requestPump = startRequestPump(clientInput, upstream, upstreamOutput)
            }

            try {
                copyStreaming(upstreamInput, clientOutput)
            } finally {
                closeQuietly(upstream)
                closeQuietly(client)
                requestPump?.interrupt()
            }
        } catch (error: Exception) {
            if (!responseStarted) {
                sendBadGateway(client, error.message ?: "Framework connection failed")
            }
        } finally {
            untrack(upstream)
            closeQuietly(upstream)
        }
    }

    private fun startRequestPump(
        clientInput: BufferedInputStream,
        upstream: Socket,
        upstreamOutput: BufferedOutputStream,
    ): Thread = Thread({
        try {
            copyStreaming(clientInput, upstreamOutput)
        } catch (_: Exception) {
        } finally {
            try {
                upstream.shutdownOutput()
            } catch (_: Exception) {
            }
        }
    }, "CefriumRelayBrowserToFramework").apply {
        isDaemon = true
        start()
    }

    private fun copyStreaming(
        input: BufferedInputStream,
        output: BufferedOutputStream,
    ) {
        val buffer = ByteArray(STREAM_BUFFER_BYTES)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count == 0) continue
            output.write(buffer, 0, count)
            output.flush()
        }
    }

    private fun writeProxyRequest(
        output: BufferedOutputStream,
        request: HttpRequestHead,
        currentTarget: RelayTarget,
    ) {
        output.write("${request.method} ${request.target} ${request.version}\r\n".bytes())
        var hasConnectionHeader = false
        request.headers.forEach { (name, value) ->
            when {
                name.equals("host", ignoreCase = true) -> Unit
                name.equals("proxy-connection", ignoreCase = true) -> Unit
                name.equals("connection", ignoreCase = true) -> {
                    hasConnectionHeader = true
                    if (request.isWebSocketUpgrade) {
                        output.write("$name: $value\r\n".bytes())
                    }
                }
                else -> output.write("$name: $value\r\n".bytes())
            }
        }
        output.write("Host: ${currentTarget.authority}\r\n".bytes())
        if (!request.isWebSocketUpgrade || !hasConnectionHeader) {
            output.write(
                "Connection: ${if (request.isWebSocketUpgrade) "Upgrade" else "close"}\r\n".bytes(),
            )
        }
        output.write("\r\n".bytes())
    }

    private fun writeProxyResponse(
        output: BufferedOutputStream,
        response: HttpResponseHead,
        currentTarget: RelayTarget,
    ) {
        output.write("${response.statusLine}\r\n".bytes())
        response.headers.forEach { (name, rawValue) ->
            val value = if (name.equals("location", ignoreCase = true)) {
                rewriteLocation(rawValue, currentTarget)
            } else {
                rawValue
            }
            output.write("$name: $value\r\n".bytes())
        }
        output.write("\r\n".bytes())
    }

    private fun rewriteLocation(location: String, currentTarget: RelayTarget): String {
        return try {
            val resolved = currentTarget.uri.resolve(location)
            if (!currentTarget.matches(resolved)) {
                location
            } else {
                val rawPath = resolved.rawPath?.takeIf { it.isNotEmpty() } ?: "/"
                buildString {
                    append(browserOrigin)
                    append(rawPath)
                    resolved.rawQuery?.let { append('?').append(it) }
                    resolved.rawFragment?.let { append('#').append(it) }
                }
            }
        } catch (_: Exception) {
            location
        }
    }

    private fun serveLocalAsset(
        client: Socket,
        method: String,
        requestPath: String,
        assetRoot: File?,
    ) {
        if (method != "GET" && method != "HEAD") {
            sendLocalResponse(
                client,
                method,
                LocalHttpResponse.text(405, "405 Method Not Allowed"),
            )
            return
        }
        if (requestPath.contains("..")) {
            sendLocalResponse(client, method, LocalHttpResponse.text(403, "403 Forbidden"))
            return
        }

        val root = assetRoot
            ?: throw IllegalStateException("Local asset root is unavailable")
        val relativePath = requestPath.removePrefix("/")
        val file = File(root, relativePath)
        val rootPath = root.canonicalPath.trimEnd(File.separatorChar) + File.separator
        val filePath = file.canonicalPath
        if (!file.isFile || !filePath.startsWith(rootPath)) {
            sendLocalResponse(client, method, LocalHttpResponse.text(404, "404 Not Found"))
            return
        }

        val cacheControl = if (requestPath.startsWith(ANDROID_SHELL_PREFIX)) {
            "no-store"
        } else {
            "max-age=31536000, immutable"
        }
        val output = BufferedOutputStream(client.getOutputStream())
        output.write("HTTP/1.1 200 OK\r\n".bytes())
        output.write("Content-Type: ${contentType(file.name)}\r\n".bytes())
        output.write("Content-Length: ${file.length()}\r\n".bytes())
        output.write("Cache-Control: $cacheControl\r\n".bytes())
        output.write("Access-Control-Allow-Origin: *\r\n".bytes())
        output.write("Connection: close\r\n\r\n".bytes())
        if (method != "HEAD") {
            FileInputStream(file).use { it.copyTo(output) }
        }
        output.flush()
    }

    private fun sendLocalResponse(
        client: Socket,
        method: String,
        response: LocalHttpResponse,
    ) {
        val reason = when (response.status) {
            200 -> "OK"
            400 -> "Bad Request"
            403 -> "Forbidden"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            413 -> "Payload Too Large"
            500 -> "Internal Server Error"
            502 -> "Bad Gateway"
            else -> "Error"
        }
        val output = BufferedOutputStream(client.getOutputStream())
        output.write("HTTP/1.1 ${response.status} $reason\r\n".bytes())
        output.write("Content-Type: ${response.contentType}\r\n".bytes())
        output.write("Content-Length: ${response.body.size}\r\n".bytes())
        output.write("Cache-Control: ${response.cacheControl}\r\n".bytes())
        output.write("Access-Control-Allow-Origin: *\r\n".bytes())
        output.write("Connection: close\r\n\r\n".bytes())
        if (method != "HEAD") output.write(response.body)
        output.flush()
    }

    private fun sendBadGateway(client: Socket, detail: String) {
        try {
            sendLocalResponse(
                client,
                "GET",
                LocalHttpResponse.text(502, "Framework relay failed: $detail"),
            )
        } catch (_: Exception) {
        }
    }

    private fun readRequest(input: BufferedInputStream): HttpRequestHead? {
        val requestLine = readLine(input) ?: return null
        val parts = requestLine.split(' ', limit = 3)
        if (parts.size != 3) return null
        val headers = readHeaders(input)
        val contentLength = headers.firstOrNull {
            it.first.equals("content-length", ignoreCase = true)
        }?.second?.toIntOrNull() ?: 0
        require(contentLength in 0..MAX_REQUEST_BODY_BYTES) {
            "Request body exceeds relay limit"
        }
        val connection = headers.firstOrNull {
            it.first.equals("connection", ignoreCase = true)
        }?.second.orEmpty()
        val upgrade = headers.firstOrNull {
            it.first.equals("upgrade", ignoreCase = true)
        }?.second.orEmpty()
        val transferEncoding = headers.firstOrNull {
            it.first.equals("transfer-encoding", ignoreCase = true)
        }?.second.orEmpty()
        return HttpRequestHead(
            method = parts[0].uppercase(Locale.ROOT),
            target = parts[1],
            version = parts[2],
            headers = headers,
            contentLength = contentLength,
            isChunked = transferEncoding
                .split(',')
                .any { it.trim().equals("chunked", ignoreCase = true) },
            isWebSocketUpgrade =
                connection.contains("upgrade", ignoreCase = true) &&
                    upgrade.equals("websocket", ignoreCase = true),
        )
    }

    private fun readResponse(input: BufferedInputStream): HttpResponseHead? {
        val statusLine = readLine(input) ?: return null
        return HttpResponseHead(statusLine, readHeaders(input))
    }

    private fun readHeaders(input: BufferedInputStream): List<Pair<String, String>> {
        val headers = mutableListOf<Pair<String, String>>()
        var totalBytes = 0
        while (true) {
            val line = readLine(input) ?: break
            totalBytes += line.length
            require(totalBytes <= MAX_HEADER_BYTES) { "HTTP headers exceed relay limit" }
            if (line.isEmpty()) break
            val separator = line.indexOf(':')
            if (separator <= 0) continue
            headers += line.substring(0, separator).trim() to
                line.substring(separator + 1).trim()
        }
        return headers
    }

    private fun readLine(input: BufferedInputStream): String? {
        val bytes = ByteArrayOutputStream()
        while (bytes.size() <= MAX_HEADER_LINE_BYTES) {
            val next = input.read()
            if (next < 0) {
                return if (bytes.size() == 0) null else bytes.toString("UTF-8")
            }
            if (next == '\n'.code) break
            if (next != '\r'.code) bytes.write(next)
        }
        require(bytes.size() <= MAX_HEADER_LINE_BYTES) { "HTTP header line is too long" }
        return bytes.toString("UTF-8")
    }

    private fun readExactly(input: BufferedInputStream, length: Int): ByteArray {
        val body = ByteArray(length)
        var offset = 0
        while (offset < body.size) {
            val count = input.read(body, offset, body.size - offset)
            if (count < 0) break
            offset += count
        }
        require(offset == body.size) { "Incomplete HTTP request body" }
        return body
    }

    private fun track(socket: Socket) {
        activeSockets.add(socket)
    }

    private fun untrack(socket: Socket) {
        activeSockets.remove(socket)
    }

    private fun closeActiveSockets(except: Socket? = null) {
        val snapshot = synchronized(activeSockets) { activeSockets.toList() }
        snapshot.filter { it !== except }.forEach { socket ->
            closeQuietly(socket)
            activeSockets.remove(socket)
        }
    }

    private fun closeQuietly(closeable: AutoCloseable?) {
        try {
            closeable?.close()
        } catch (_: Exception) {
        }
    }

    private fun contentType(name: String): String = when {
        name.endsWith(".js") || name.endsWith(".mjs") -> "application/javascript"
        name.endsWith(".css") -> "text/css"
        name.endsWith(".html") -> "text/html"
        name.endsWith(".json") -> "application/json"
        name.endsWith(".wasm") -> "application/wasm"
        name.endsWith(".png") -> "image/png"
        name.endsWith(".svg") -> "image/svg+xml"
        name.endsWith(".ico") -> "image/x-icon"
        name.endsWith(".woff") -> "font/woff"
        name.endsWith(".woff2") -> "font/woff2"
        name.endsWith(".ttf") -> "font/ttf"
        name.endsWith(".webmanifest") -> "application/manifest+json"
        else -> URLConnection.guessContentTypeFromName(name) ?: "application/octet-stream"
    }

    private fun String.bytes(): ByteArray = toByteArray(StandardCharsets.ISO_8859_1)

    private data class HttpRequestHead(
        val method: String,
        val target: String,
        val version: String,
        val headers: List<Pair<String, String>>,
        val contentLength: Int,
        val isChunked: Boolean,
        val isWebSocketUpgrade: Boolean,
    )

    private data class HttpResponseHead(
        val statusLine: String,
        val headers: List<Pair<String, String>>,
    )

    private data class RelayTarget(
        val uri: URI,
        val host: String,
        val port: Int,
        val authority: String,
        val origin: String,
    ) {
        fun matches(candidate: URI): Boolean {
            val candidatePort = when {
                candidate.port > 0 -> candidate.port
                candidate.scheme.equals("http", ignoreCase = true) -> 80
                else -> -1
            }
            return candidate.scheme.equals("http", ignoreCase = true) &&
                candidate.host.equals(host, ignoreCase = true) &&
                candidatePort == port
        }

        companion object {
            fun parse(raw: String): RelayTarget {
                val parsed = URI(raw.trim())
                require(parsed.scheme.equals("http", ignoreCase = true)) {
                    "Android framework target must use HTTP"
                }
                val host = parsed.host?.takeIf { it.isNotBlank() }
                    ?: throw IllegalArgumentException("Android framework target is missing a host")
                val port = if (parsed.port > 0) parsed.port else 80
                val authorityHost = if (host.contains(':')) "[$host]" else host
                val authority = if (port == 80) authorityHost else "$authorityHost:$port"
                return RelayTarget(
                    uri = URI("http://$authority/"),
                    host = host,
                    port = port,
                    authority = authority,
                    origin = "http://$authority",
                )
            }
        }
    }

    companion object {
        private const val LOOPBACK_HOST = "127.0.0.1"
        private const val ANDROID_SHELL_PREFIX = "/android-shell/"
        private const val ANDROID_API_PREFIX = "/android-api"
        private const val START_TIMEOUT_MS = 3_000L
        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val HEADER_TIMEOUT_MS = 15_000
        private const val MAX_HEADER_LINE_BYTES = 16 * 1024
        private const val MAX_HEADER_BYTES = 128 * 1024
        private const val MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024
        private const val STREAM_BUFFER_BYTES = 32 * 1024
        private val LOOPBACK_ADDRESS = InetAddress.getByAddress(
            LOOPBACK_HOST,
            byteArrayOf(127, 0, 0, 1),
        )
    }
}
