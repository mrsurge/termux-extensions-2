package com.termux.extensions

import android.util.Log
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.net.ServerSocket
import java.net.Socket
import java.net.URLConnection

/**
 * Lightweight HTTP file server that serves editor static assets from
 * a local directory on localhost. Used by the asset_intercept WebExtension
 * to redirect asset requests to locally bundled files.
 */
class LocalAssetServer(private val assetRoot: File) {

    @Volatile
    var port: Int = 0
        private set

    @Volatile
    private var running = false
    private var serverThread: Thread? = null

    fun start() {
        if (running) return
        running = true

        serverThread = Thread({
            try {
                val server = ServerSocket(0) // random available port
                port = server.localPort
                Log.i(TAG, "Asset server started on port $port, root=$assetRoot")

                while (running) {
                    try {
                        val client = server.accept()
                        Thread { handleClient(client) }.start()
                    } catch (e: Exception) {
                        if (running) Log.w(TAG, "Accept error", e)
                    }
                }
                server.close()
            } catch (e: Exception) {
                Log.e(TAG, "Server failed to start", e)
            }
        }, "LocalAssetServer").apply {
            isDaemon = true
            start()
        }

        // Wait for port assignment
        val deadline = System.currentTimeMillis() + 3000
        while (port == 0 && System.currentTimeMillis() < deadline) {
            Thread.sleep(10)
        }
    }

    fun stop() {
        running = false
        serverThread?.interrupt()
        serverThread = null
    }

    private fun handleClient(client: Socket) {
        try {
            client.soTimeout = 5000
            val reader = client.getInputStream().bufferedReader()
            val requestLine = reader.readLine() ?: return
            // e.g. "GET /static/vendor/codicons/codicon.css HTTP/1.1"
            val parts = requestLine.split(" ")
            if (parts.size < 2) {
                sendError(client, 400, "Bad Request")
                return
            }

            var path = parts[1]
            // Strip query string
            val qIdx = path.indexOf('?')
            if (qIdx >= 0) path = path.substring(0, qIdx)

            // Security: prevent path traversal
            if (path.contains("..")) {
                sendError(client, 403, "Forbidden")
                return
            }

            // Remove leading slash
            val relPath = path.removePrefix("/")
            val file = File(assetRoot, relPath)

            if (!file.exists() || !file.isFile || !file.canonicalPath.startsWith(assetRoot.canonicalPath)) {
                sendError(client, 404, "Not Found")
                return
            }

            val mime = guessMimeType(file.name)
            val length = file.length()

            val out = BufferedOutputStream(client.getOutputStream())
            out.write("HTTP/1.1 200 OK\r\n".toByteArray())
            out.write("Content-Type: $mime\r\n".toByteArray())
            out.write("Content-Length: $length\r\n".toByteArray())
            out.write("Cache-Control: max-age=31536000, immutable\r\n".toByteArray())
            out.write("Access-Control-Allow-Origin: *\r\n".toByteArray())
            out.write("Connection: close\r\n".toByteArray())
            out.write("\r\n".toByteArray())

            FileInputStream(file).use { fis ->
                fis.copyTo(out)
            }
            out.flush()
        } catch (e: Exception) {
            // Client likely disconnected
        } finally {
            try { client.close() } catch (_: Exception) {}
        }
    }

    private fun sendError(client: Socket, code: Int, message: String) {
        try {
            val body = "$code $message"
            val out = client.getOutputStream()
            out.write("HTTP/1.1 $code $message\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n$body".toByteArray())
            out.flush()
            client.close()
        } catch (_: Exception) {}
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
    }
}
