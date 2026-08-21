package com.termux.extensions

import android.util.Log
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLConnection
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

data class LocalHttpRequest(
    val method: String,
    val path: String,
    val body: ByteArray,
)

data class LocalHttpResponse(
    val status: Int,
    val contentType: String,
    val body: ByteArray,
    val cacheControl: String = "no-store",
) {
    companion object {
        fun text(
            status: Int,
            body: String,
            contentType: String = "text/plain; charset=utf-8",
        ): LocalHttpResponse = LocalHttpResponse(
            status = status,
            contentType = contentType,
            body = body.toByteArray(StandardCharsets.UTF_8),
        )
    }
}

/**
 * Loopback HTTP server for APK/OTA assets and the Android shell's narrow local API.
 * Dynamic handlers run on client worker threads and never on the activity UI thread.
 */
class LocalAssetServer(
    private val assetRoot: File,
    private val requestHandler: ((LocalHttpRequest) -> LocalHttpResponse?)? = null,
) {
    @Volatile
    var port: Int = 0
        private set

    @Volatile
    private var running = false
    private var serverThread: Thread? = null
    private var serverSocket: ServerSocket? = null
    private val workerIndex = AtomicInteger(0)
    private val workers = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "LocalAssetClient-${workerIndex.incrementAndGet()}").apply {
            isDaemon = true
        }
    }

    fun start() {
        if (running) return
        running = true

        serverThread = Thread({
            try {
                val server = ServerSocket().apply {
                    reuseAddress = true
                    bind(InetSocketAddress(LOOPBACK_ADDRESS, 0))
                }
                serverSocket = server
                port = server.localPort
                Log.i(TAG, "Asset server started on port $port, root=$assetRoot")

                while (running) {
                    try {
                        val client = server.accept()
                        workers.execute { handleClient(client) }
                    } catch (error: Exception) {
                        if (running) Log.w(TAG, "Accept error", error)
                    }
                }
            } catch (error: Exception) {
                if (running) Log.e(TAG, "Server failed to start", error)
            } finally {
                try {
                    serverSocket?.close()
                } catch (_: Exception) {
                }
                serverSocket = null
                port = 0
            }
        }, "LocalAssetServer").apply {
            isDaemon = true
            start()
        }

        val deadline = System.currentTimeMillis() + 3000
        while (port == 0 && running && System.currentTimeMillis() < deadline) {
            Thread.sleep(10)
        }

        val boundPort = port
        if (boundPort <= 0) {
            stop()
            throw IllegalStateException("Local asset server failed to bind $LOOPBACK_HOST")
        }
    }

    fun stop() {
        running = false
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        serverThread?.interrupt()
        serverThread = null
        workers.shutdownNow()
        port = 0
    }

    fun url(path: String): String {
        val normalized = if (path.startsWith('/')) path else "/$path"
        return "http://$LOOPBACK_HOST:$port$normalized"
    }

    private fun handleClient(client: Socket) {
        try {
            client.soTimeout = 15_000
            val input = BufferedInputStream(client.getInputStream())
            val requestLine = readLine(input) ?: return
            val parts = requestLine.split(' ', limit = 3)
            if (parts.size < 2) {
                sendResponse(client, LocalHttpResponse.text(400, "400 Bad Request"))
                return
            }

            val method = parts[0].uppercase(Locale.ROOT)
            val target = parts[1]
            val headers = mutableMapOf<String, String>()
            while (true) {
                val line = readLine(input) ?: break
                if (line.isEmpty()) break
                val separator = line.indexOf(':')
                if (separator <= 0) continue
                headers[line.substring(0, separator).trim().lowercase(Locale.ROOT)] =
                    line.substring(separator + 1).trim()
            }

            val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
            if (contentLength !in 0..MAX_REQUEST_BODY_BYTES) {
                sendResponse(client, LocalHttpResponse.text(413, "413 Payload Too Large"))
                return
            }
            val body = ByteArray(contentLength)
            var offset = 0
            while (offset < body.size) {
                val count = input.read(body, offset, body.size - offset)
                if (count < 0) break
                offset += count
            }
            if (offset != body.size) {
                sendResponse(client, LocalHttpResponse.text(400, "400 Bad Request"))
                return
            }

            val path = target.substringBefore('?')
            val request = LocalHttpRequest(method = method, path = path, body = body)
            requestHandler?.invoke(request)?.let { response ->
                sendResponse(client, response)
                return
            }

            if (method != "GET") {
                sendResponse(client, LocalHttpResponse.text(405, "405 Method Not Allowed"))
                return
            }
            serveStatic(client, path)
        } catch (_: Exception) {
            // Browser disconnects are expected when pages navigate or requests are canceled.
        } finally {
            try {
                client.close()
            } catch (_: Exception) {
            }
        }
    }

    private fun serveStatic(client: Socket, requestPath: String) {
        if (requestPath.contains("..")) {
            sendResponse(client, LocalHttpResponse.text(403, "403 Forbidden"))
            return
        }

        val relativePath = requestPath.removePrefix("/")
        val file = File(assetRoot, relativePath)
        val rootPath = assetRoot.canonicalPath.trimEnd(File.separatorChar) + File.separator
        val filePath = file.canonicalPath
        if (!file.isFile || !filePath.startsWith(rootPath)) {
            sendResponse(client, LocalHttpResponse.text(404, "404 Not Found"))
            return
        }

        Log.d(TAG, "Serving $requestPath -> $relativePath")
        val cacheControl = if (requestPath.startsWith("/android-shell/")) {
            "no-store"
        } else {
            "max-age=31536000, immutable"
        }
        sendFile(client, file, guessMimeType(file.name), cacheControl)
    }

    private fun sendFile(client: Socket, file: File, contentType: String, cacheControl: String) {
        val output = BufferedOutputStream(client.getOutputStream())
        output.write("HTTP/1.1 200 OK\r\n".toByteArray())
        output.write("Content-Type: $contentType\r\n".toByteArray())
        output.write("Content-Length: ${file.length()}\r\n".toByteArray())
        output.write("Cache-Control: $cacheControl\r\n".toByteArray())
        output.write("X-TE2-Android-Asset-Source: files-dir\r\n".toByteArray())
        output.write("Access-Control-Allow-Origin: *\r\n".toByteArray())
        output.write("Connection: close\r\n\r\n".toByteArray())
        FileInputStream(file).use { input -> input.copyTo(output) }
        output.flush()
    }

    private fun sendResponse(client: Socket, response: LocalHttpResponse) {
        val reason = when (response.status) {
            200 -> "OK"
            400 -> "Bad Request"
            403 -> "Forbidden"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            413 -> "Payload Too Large"
            502 -> "Bad Gateway"
            else -> "Error"
        }
        val output = BufferedOutputStream(client.getOutputStream())
        output.write("HTTP/1.1 ${response.status} $reason\r\n".toByteArray())
        output.write("Content-Type: ${response.contentType}\r\n".toByteArray())
        output.write("Content-Length: ${response.body.size}\r\n".toByteArray())
        output.write("Cache-Control: ${response.cacheControl}\r\n".toByteArray())
        output.write("Access-Control-Allow-Origin: *\r\n".toByteArray())
        output.write("Connection: close\r\n\r\n".toByteArray())
        output.write(response.body)
        output.flush()
    }

    private fun readLine(input: BufferedInputStream): String? {
        val bytes = ByteArrayOutputStream()
        while (bytes.size() <= MAX_HEADER_LINE_BYTES) {
            val next = input.read()
            if (next < 0) return if (bytes.size() == 0) null else bytes.toString("UTF-8")
            if (next == '\n'.code) break
            if (next != '\r'.code) bytes.write(next)
        }
        if (bytes.size() > MAX_HEADER_LINE_BYTES) return null
        return bytes.toString("UTF-8")
    }

    private fun guessMimeType(name: String): String {
        return when {
            name.endsWith(".js") || name.endsWith(".mjs") -> "application/javascript"
            name.endsWith(".css") -> "text/css"
            name.endsWith(".html") -> "text/html"
            name.endsWith(".json") -> "application/json"
            name.endsWith(".png") -> "image/png"
            name.endsWith(".svg") -> "image/svg+xml"
            name.endsWith(".ico") -> "image/x-icon"
            name.endsWith(".woff") -> "font/woff"
            name.endsWith(".woff2") -> "font/woff2"
            name.endsWith(".ttf") -> "font/ttf"
            name.endsWith(".webmanifest") -> "application/manifest+json"
            else -> URLConnection.guessContentTypeFromName(name) ?: "application/octet-stream"
        }
    }

    companion object {
        private const val TAG = "LocalAssetServer"
        private const val LOOPBACK_HOST = "127.0.0.1"
        private const val MAX_HEADER_LINE_BYTES = 16 * 1024
        private const val MAX_REQUEST_BODY_BYTES = 1024 * 1024
        private val LOOPBACK_ADDRESS = InetAddress.getByAddress(
            LOOPBACK_HOST,
            byteArrayOf(127, 0, 0, 1),
        )
    }
}
