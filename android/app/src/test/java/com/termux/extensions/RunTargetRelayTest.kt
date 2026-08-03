package com.termux.extensions

import okhttp3.OkHttpClient
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class RunTargetRelayTest {
    private val ticket = "a".repeat(64)

    private fun route(port: Int) = JSONObject().apply {
        put("ticket", ticket)
        put("tunnelPath", "/api/run-targets/$ticket/tunnel")
        put("preferredPort", port)
        put("originalUrl", "http://localhost:$port/health?full=1#status")
    }

    private fun routeSet(primaryPort: Int, additionalPort: Int) = JSONObject().apply {
        put("dto", "RunTargetRouteSet")
        put("version", 1)
        put("relayGroupId", "d".repeat(64))
        put("primary", route(primaryPort))
        put("additional", org.json.JSONArray().put(
            route(additionalPort).apply {
                val auxiliaryTicket = "b".repeat(64)
                put("ticket", auxiliaryTicket)
                put("tunnelPath", "/api/run-targets/$auxiliaryTicket/tunnel")
                put("label", "Vite / HMR")
            },
        ))
    }

    @Test
    fun validatesTicketBoundLoopbackRouteAndBuildsLocalUrl() {
        val normalized = normalizeAndroidRunTargetRoute(route(43123))

        assertEquals(43123, normalized.preferredPort)
        assertEquals(
            "http://127.0.0.1:43123/health?full=1#status",
            localAndroidRunTargetUrl(normalized),
        )
        assertThrows(IllegalArgumentException::class.java) {
            normalizeAndroidRunTargetRoute(route(43123).put("tunnelPath", "/wrong"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            normalizeAndroidRunTargetRoute(
                route(43123).put("originalUrl", "http://example.com:43123/"),
            )
        }
    }

    @Test
    fun occupiedPreferredPortSelectsSameDeviceDirectMode() {
        val occupied = ServerSocket().apply {
            reuseAddress = false
            bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
        }
        val manager = RunTargetRelayManager(OkHttpClient())
        val latch = CountDownLatch(1)
        var result: Result<AndroidRunTargetResolution>? = null
        try {
            manager.resolve(route(occupied.localPort), "http://framework.example:8089") {
                result = it
                latch.countDown()
            }
            assertEquals(true, latch.await(5, TimeUnit.SECONDS))
            assertEquals("direct", result?.getOrThrow()?.mode)
            assertEquals(
                "http://localhost:${occupied.localPort}/health?full=1#status",
                result?.getOrThrow()?.url,
            )
        } finally {
            manager.close()
            occupied.close()
        }
    }

    @Test
    fun validatesLabeledRouteSetAndRejectsDuplicatePorts() {
        val normalized = normalizeAndroidRunTargetRouteSet(routeSet(43123, 43124))

        assertEquals(43123, normalized.primary.preferredPort)
        assertEquals("Vite / HMR", normalized.additional.single().label)
        assertThrows(IllegalArgumentException::class.java) {
            normalizeAndroidRunTargetRouteSet(routeSet(43123, 43123))
        }
    }

    @Test
    fun occupiedAuxiliaryPortRollsBackPrimaryListener() {
        val primaryReservation = ServerSocket().apply {
            reuseAddress = false
            bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
        }
        val primaryPort = primaryReservation.localPort
        primaryReservation.close()
        val occupied = ServerSocket().apply {
            reuseAddress = false
            bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
        }
        val manager = RunTargetRelayManager(OkHttpClient())
        val latch = CountDownLatch(1)
        var result: Result<AndroidRunTargetResolution>? = null
        try {
            manager.resolve(
                routeSet(primaryPort, occupied.localPort),
                "http://framework.example:8089",
            ) {
                result = it
                latch.countDown()
            }
            assertEquals(true, latch.await(5, TimeUnit.SECONDS))
            assertEquals(true, result?.isFailure)
            ServerSocket().use { rebound ->
                rebound.reuseAddress = false
                rebound.bind(
                    InetSocketAddress(InetAddress.getByName("127.0.0.1"), primaryPort),
                )
            }
        } finally {
            manager.close()
            occupied.close()
        }
    }
}
