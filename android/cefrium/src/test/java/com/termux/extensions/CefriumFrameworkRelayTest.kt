package com.termux.extensions

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class AndroidFrameworkRelayTest {
    private val closeables = mutableListOf<AutoCloseable>()

    @After
    fun tearDown() {
        closeables.reversed().forEach {
            try {
                it.close()
            } catch (_: Exception) {
            }
        }
    }

    @Test
    fun servesLauncherAndGatewayFromTheLoopbackOrigin() {
        val root = Files.createTempDirectory("cefrium-relay-assets").toFile()
        closeables += AutoCloseable { root.deleteRecursively() }
        File(root, "android-shell").mkdirs()
        File(root, "android-shell/index.html").writeText("launcher")

        val relay = AndroidFrameworkRelay(root, CefriumAssetRoutes::localPath) { request ->
            if (request.path == "/android-api/settings") {
                LocalHttpResponse.text(200, """{"ok":true}""", "application/json")
            } else {
                null
            }
        }
        relay.start("http://127.0.0.1:65534")
        closeables += AutoCloseable(relay::stop)

        val launcher = request(
            relay.port,
            "GET /android-shell/index.html HTTP/1.1\r\nHost: local\r\n\r\n",
        )
        assertEquals("launcher", launcher.body)
        assertTrue(
            launcher.head.contains(
                "X-TE2-Android-Asset-Source: files-dir",
                ignoreCase = true,
            ),
        )
        assertEquals(
            """{"ok":true}""",
            request(relay.port, "GET /android-api/settings HTTP/1.1\r\nHost: local\r\n\r\n")
                .body,
        )
    }

    @Test
    fun blocksOnlyTheTe2RootServiceWorkerBeforeUpstreamProxying() {
        val upstream = OneShotServer { socket ->
            val request = readHead(BufferedInputStream(socket.getInputStream()))
            assertTrue(request.startsWith("GET /apps/example/sw.js "))
            socket.getOutputStream().write(
                (
                    "HTTP/1.1 200 OK\r\n" +
                        "Content-Length: 12\r\n" +
                        "Connection: close\r\n\r\n" +
                        "other-worker"
                    ).toByteArray(),
            )
        }
        closeables += upstream
        val root = Files.createTempDirectory("cefrium-relay-assets").toFile()
        closeables += AutoCloseable { root.deleteRecursively() }
        val relay = AndroidFrameworkRelay(root, CefriumAssetRoutes::localPath)
        relay.start(upstream.origin)
        closeables += AutoCloseable(relay::stop)

        val blocked = request(
            relay.port,
            "GET /sw.js?v=stale HTTP/1.1\r\nHost: local\r\n\r\n",
        )
        assertTrue(blocked.head.startsWith("HTTP/1.1 404 Not Found"))
        assertEquals("404 Not Found", blocked.body)

        assertEquals(
            "other-worker",
            request(
                relay.port,
                "GET /apps/example/sw.js HTTP/1.1\r\nHost: local\r\n\r\n",
            ).body,
        )
    }

    @Test
    fun missingDeclaredAssetsFailClosedInsteadOfReachingUpstream() {
        val upstream = OneShotServer { socket ->
            val request = readHead(BufferedInputStream(socket.getInputStream()))
            assertTrue(request.startsWith("GET /api/health "))
            socket.getOutputStream().write(
                (
                    "HTTP/1.1 200 OK\r\n" +
                        "Content-Length: 7\r\n" +
                        "Connection: close\r\n\r\n" +
                        "healthy"
                    ).toByteArray(),
            )
        }
        closeables += upstream
        val root = Files.createTempDirectory("cefrium-relay-assets").toFile()
        closeables += AutoCloseable { root.deleteRecursively() }
        val relay = AndroidFrameworkRelay(root, CefriumAssetRoutes::localPath)
        relay.start(upstream.origin)
        closeables += AutoCloseable(relay::stop)

        val missingAsset = request(
            relay.port,
            "GET /static/js/missing.js HTTP/1.1\r\nHost: local\r\n\r\n",
        )
        assertTrue(missingAsset.head.startsWith("HTTP/1.1 404 Not Found"))

        assertEquals(
            "healthy",
            request(relay.port, "GET /api/health HTTP/1.1\r\nHost: local\r\n\r\n").body,
        )
    }

    @Test
    fun proxiesBodiesAndRewritesSameTargetRedirects() {
        val upstream = OneShotServer { socket ->
            val input = BufferedInputStream(socket.getInputStream())
            val head = readHead(input)
            val contentLength = Regex("(?i)Content-Length:\\s*(\\d+)")
                .find(head)
                ?.groupValues
                ?.get(1)
                ?.toInt()
                ?: 0
            val body = ByteArray(contentLength)
            input.readFully(body)
            val responseBody = String(body, StandardCharsets.UTF_8)
            socket.getOutputStream().write(
                (
                    "HTTP/1.1 302 Found\r\n" +
                        "Location: http://127.0.0.1:${upstreamPort(socket)}/next?q=1\r\n" +
                        "Content-Length: ${responseBody.length}\r\n" +
                        "Connection: close\r\n\r\n" +
                        responseBody
                    ).toByteArray(),
            )
        }
        closeables += upstream
        val root = Files.createTempDirectory("cefrium-relay-assets").toFile()
        closeables += AutoCloseable { root.deleteRecursively() }
        val relay = AndroidFrameworkRelay(root, CefriumAssetRoutes::localPath)
        relay.start(upstream.origin)
        closeables += AutoCloseable(relay::stop)

        val response = request(
            relay.port,
            "POST /submit HTTP/1.1\r\n" +
                "Host: local\r\n" +
                "Content-Length: 7\r\n\r\n" +
                "payload",
        )

        assertEquals("payload", response.body)
        assertTrue(
            response.head.contains(
                "Location: ${relay.browserOrigin}/next?q=1",
                ignoreCase = true,
            ),
        )
    }

    @Test
    fun tunnelsWebSocketBytesAfterTheUpgrade() {
        val upstream = OneShotServer { socket ->
            val input = BufferedInputStream(socket.getInputStream())
            readHead(input)
            socket.getOutputStream().apply {
                write(
                    (
                        "HTTP/1.1 101 Switching Protocols\r\n" +
                            "Connection: Upgrade\r\n" +
                            "Upgrade: websocket\r\n\r\n"
                        ).toByteArray(),
                )
                flush()
                val payload = ByteArray(4)
                input.readFully(payload)
                write(payload)
                flush()
            }
        }
        closeables += upstream
        val root = Files.createTempDirectory("cefrium-relay-assets").toFile()
        closeables += AutoCloseable { root.deleteRecursively() }
        val relay = AndroidFrameworkRelay(root, CefriumAssetRoutes::localPath)
        relay.start(upstream.origin)
        closeables += AutoCloseable(relay::stop)

        Socket(InetAddress.getLoopbackAddress(), relay.port).use { socket ->
            socket.soTimeout = 3_000
            socket.getOutputStream().apply {
                write(
                    (
                        "GET /socket.io HTTP/1.1\r\n" +
                            "Host: local\r\n" +
                            "Connection: Upgrade\r\n" +
                            "Upgrade: websocket\r\n\r\n"
                        ).toByteArray(),
                )
                flush()
            }
            val input = BufferedInputStream(socket.getInputStream())
            assertTrue(readHead(input).startsWith("HTTP/1.1 101"))
            socket.getOutputStream().apply {
                write("PING".toByteArray())
                flush()
            }
            val echoed = ByteArray(4)
            input.readFully(echoed)
            assertEquals("PING", String(echoed))
        }
    }

    @Test
    fun retargetsWithoutChangingTheBrowserOrigin() {
        fun responseServer(body: String) = OneShotServer { socket ->
            readHead(BufferedInputStream(socket.getInputStream()))
            socket.getOutputStream().write(
                (
                    "HTTP/1.1 200 OK\r\n" +
                        "Content-Length: ${body.length}\r\n" +
                        "Connection: close\r\n\r\n" +
                        body
                    ).toByteArray(),
            )
        }

        val first = responseServer("first")
        val second = responseServer("second")
        closeables += first
        closeables += second
        val root = Files.createTempDirectory("cefrium-relay-assets").toFile()
        closeables += AutoCloseable { root.deleteRecursively() }
        val relay = AndroidFrameworkRelay(root, CefriumAssetRoutes::localPath)
        relay.start(first.origin)
        closeables += AutoCloseable(relay::stop)
        val browserOrigin = relay.browserOrigin

        assertEquals(
            "first",
            request(relay.port, "GET /value HTTP/1.1\r\nHost: local\r\n\r\n").body,
        )
        relay.retarget(second.origin)
        assertEquals(browserOrigin, relay.browserOrigin)
        assertEquals(
            "second",
            request(relay.port, "GET /value HTTP/1.1\r\nHost: local\r\n\r\n").body,
        )
    }

    @Test
    fun localSettingsResponseSurvivesItsOwnRetarget() {
        val next = OneShotServer { socket ->
            readHead(BufferedInputStream(socket.getInputStream()))
            socket.getOutputStream().write(
                (
                    "HTTP/1.1 200 OK\r\n" +
                        "Content-Length: 4\r\n" +
                        "Connection: close\r\n\r\n" +
                        "next"
                    ).toByteArray(),
            )
        }
        closeables += next
        val root = Files.createTempDirectory("cefrium-relay-assets").toFile()
        closeables += AutoCloseable { root.deleteRecursively() }
        lateinit var relay: AndroidFrameworkRelay
        relay = AndroidFrameworkRelay(root, CefriumAssetRoutes::localPath) { request ->
            if (request.path == "/android-api/settings") {
                relay.retarget(next.origin)
                LocalHttpResponse.text(200, "saved")
            } else {
                null
            }
        }
        relay.start("http://127.0.0.1:65534")
        closeables += AutoCloseable(relay::stop)

        assertEquals(
            "saved",
            request(
                relay.port,
                "PUT /android-api/settings HTTP/1.1\r\n" +
                    "Host: local\r\n" +
                    "Content-Length: 0\r\n\r\n",
            ).body,
        )
        assertEquals(
            "next",
            request(relay.port, "GET /value HTTP/1.1\r\nHost: local\r\n\r\n").body,
        )
    }

    private fun request(port: Int, rawRequest: String): RawResponse {
        Socket(InetAddress.getLoopbackAddress(), port).use { socket ->
            socket.soTimeout = 3_000
            socket.getOutputStream().apply {
                write(rawRequest.toByteArray(StandardCharsets.ISO_8859_1))
                flush()
            }
            val bytes = socket.getInputStream().readBytes()
            val split = bytes.indexOfSequence("\r\n\r\n".toByteArray())
            check(split >= 0)
            return RawResponse(
                head = String(bytes, 0, split, StandardCharsets.ISO_8859_1),
                body = String(
                    bytes,
                    split + 4,
                    bytes.size - split - 4,
                    StandardCharsets.UTF_8,
                ),
            )
        }
    }

    private fun readHead(input: BufferedInputStream): String {
        val output = ByteArrayOutputStream()
        var matched = 0
        while (matched < 4) {
            val next = input.read()
            check(next >= 0)
            output.write(next)
            matched = when {
                matched == 0 && next == '\r'.code -> 1
                matched == 1 && next == '\n'.code -> 2
                matched == 2 && next == '\r'.code -> 3
                matched == 3 && next == '\n'.code -> 4
                next == '\r'.code -> 1
                else -> 0
            }
        }
        return output.toString(StandardCharsets.ISO_8859_1.name())
    }

    private fun BufferedInputStream.readFully(target: ByteArray) {
        var offset = 0
        while (offset < target.size) {
            val count = read(target, offset, target.size - offset)
            check(count >= 0)
            offset += count
        }
    }

    private fun ByteArray.indexOfSequence(sequence: ByteArray): Int {
        for (start in 0..size - sequence.size) {
            if (sequence.indices.all { this[start + it] == sequence[it] }) return start
        }
        return -1
    }

    private fun upstreamPort(socket: Socket): Int = socket.localPort

    private data class RawResponse(val head: String, val body: String)

    private class OneShotServer(
        private val handler: (Socket) -> Unit,
    ) : AutoCloseable {
        private val server = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
        private val finished = CountDownLatch(1)
        private val thread = Thread({
            try {
                server.accept().use(handler)
            } finally {
                finished.countDown()
            }
        }, "CefriumRelayTestUpstream").apply {
            isDaemon = true
            start()
        }

        val origin = "http://127.0.0.1:${server.localPort}"

        override fun close() {
            server.close()
            finished.await(1, TimeUnit.SECONDS)
            thread.interrupt()
        }
    }
}
