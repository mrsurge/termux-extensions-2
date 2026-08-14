package com.termux.extensions

import okhttp3.OkHttpClient
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.BindException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class RunTargetRelayTest {
    private val ticket = "a".repeat(64)

    private fun route(port: Int, routeTicket: String = ticket) = JSONObject().apply {
        put("ticket", routeTicket)
        put("tunnelPath", "/api/run-targets/$routeTicket/tunnel")
        put("preferredPort", port)
        put("originalUrl", "http://localhost:$port/health?full=1#status")
    }

    private fun routeSet(
        primaryPort: Int,
        additionalPort: Int,
        ownerId: String = "owner:first",
        shellId: String = "shell:first",
        primaryTicket: String = ticket,
        auxiliaryTicket: String = "b".repeat(64),
    ) = JSONObject().apply {
        put("dto", "RunTargetRouteSet")
        put("version", 1)
        put("ownerId", ownerId)
        put("shellId", shellId)
        put("relayGroupId", primaryTicket)
        put("primary", route(primaryPort, primaryTicket))
        put("additional", org.json.JSONArray().put(
            route(additionalPort, auxiliaryTicket).apply {
                put("label", "Vite / HMR")
            },
        ))
    }

    private fun projection(vararg groups: JSONObject) = JSONObject().apply {
        put("dto", "RunTargetRouteProjection")
        put("version", 1)
        put("groups", org.json.JSONArray().apply { groups.forEach(::put) })
    }

    private fun availablePorts(count: Int): List<Int> {
        val reservations = List(count) {
            ServerSocket().apply {
                reuseAddress = false
                bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
            }
        }
        return try {
            reservations.map { it.localPort }
        } finally {
            reservations.forEach { it.close() }
        }
    }

    private fun update(
        manager: RunTargetRelayManager,
        value: JSONObject,
        frameworkBaseUrl: String = "http://framework.example:8089",
    ): Result<Unit> {
        val latch = CountDownLatch(1)
        var result: Result<Unit>? = null
        manager.updateRouteProjection(value, frameworkBaseUrl) {
            result = it
            latch.countDown()
        }
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        return checkNotNull(result)
    }

    private fun assertPortFree(port: Int) {
        ServerSocket().use { free ->
            // Production listeners deliberately use SO_REUSEADDR so an exact
            // shell replacement can reclaim its loopback port immediately.
            // Exercise that same contract instead of depending on kernel
            // timing after the just-closed test listener.
            free.reuseAddress = true
            free.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port))
        }
    }

    private fun assertPortOwned(port: Int) {
        assertThrows(BindException::class.java) { assertPortFree(port) }
    }

    private fun listenerPorts(manager: RunTargetRelayManager): Set<Int> {
        val ports = manager.debugSnapshot().getJSONArray("listenerPorts")
        return buildSet {
            for (index in 0 until ports.length()) add(ports.getInt(index))
        }
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
    fun validatesLabeledRouteSetAndRejectsDuplicatePorts() {
        val normalized = normalizeAndroidRunTargetRouteSet(routeSet(43123, 43124))

        assertEquals(43123, normalized.primary.preferredPort)
        assertEquals("Vite / HMR", normalized.additional.single().label)
        assertThrows(IllegalArgumentException::class.java) {
            normalizeAndroidRunTargetRouteSet(routeSet(43123, 43123))
        }
    }

    @Test
    fun configuredFrameworkLocalityUsesOnlyTheConfiguredHost() {
        assertTrue(isAndroidConfiguredFrameworkLoopback("http://localhost:8089"))
        assertTrue(isAndroidConfiguredFrameworkLoopback("http://127.0.0.1:8089"))
        assertTrue(isAndroidConfiguredFrameworkLoopback("http://[::1]:8089"))
        assertFalse(isAndroidConfiguredFrameworkLoopback("http://100.91.80.45:8089"))
        assertFalse(isAndroidConfiguredFrameworkLoopback("http://framework.example:8089"))
    }

    @Test
    fun authoritativeRemoteProjectionCreatesAndReusesAllListeners() {
        val ports = availablePorts(2)
        val descriptor = routeSet(ports[0], ports[1])
        val manager = RunTargetRelayManager(OkHttpClient())
        try {
            update(manager, projection(descriptor)).getOrThrow()
            assertTrue(manager.isProjectionReady())
            ports.forEach(::assertPortOwned)

            update(manager, projection(descriptor)).getOrThrow()
            ports.forEach(::assertPortOwned)
        } finally {
            manager.close()
        }
    }

    @Test
    fun configuredLoopbackProjectionDoesNotCreateClientListeners() {
        val ports = availablePorts(2)
        val manager = RunTargetRelayManager(OkHttpClient())
        try {
            update(
                manager,
                projection(routeSet(ports[0], ports[1])),
                frameworkBaseUrl = "http://127.0.0.1:8089",
            ).getOrThrow()
            assertTrue(manager.isProjectionReady())
            ports.forEach(::assertPortFree)
        } finally {
            manager.close()
        }
    }

    @Test
    fun occupiedAuxiliaryPortFailsProjectionAndRollsBackPrimaryListener() {
        val ports = availablePorts(2)
        val primaryPort = ports[0]
        val occupied = ServerSocket().apply {
            reuseAddress = false
            bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), ports[1]))
        }
        val manager = RunTargetRelayManager(OkHttpClient())
        try {
            val result = update(manager, projection(routeSet(primaryPort, occupied.localPort)))
            assertTrue(result.isFailure)
            assertFalse(manager.isProjectionReady())
            assertPortFree(primaryPort)
        } finally {
            manager.close()
            occupied.close()
        }
    }

    @Test
    fun projectionRemovalClosesOnlyTheExitedShellGroup() {
        val ports = availablePorts(4)
        val first = routeSet(ports[0], ports[1])
        val second = routeSet(
            ports[2],
            ports[3],
            ownerId = "owner:second",
            shellId = "shell:second",
            primaryTicket = "c".repeat(64),
            auxiliaryTicket = "d".repeat(64),
        )
        val manager = RunTargetRelayManager(OkHttpClient())
        try {
            update(manager, projection(first, second)).getOrThrow()
            update(manager, projection(second)).getOrThrow()

            assertFalse(ports[0] in listenerPorts(manager))
            assertFalse(ports[1] in listenerPorts(manager))
            assertPortOwned(ports[2])
            assertPortOwned(ports[3])

            update(manager, projection()).getOrThrow()
            assertEquals(emptySet<Int>(), listenerPorts(manager))
        } finally {
            manager.close()
        }
    }

    @Test
    fun sequentialShellGenerationReplacesSameOwnerBeforeRebindingPorts() {
        val ports = availablePorts(2)
        val first = routeSet(ports[0], ports[1])
        val replacement = routeSet(
            ports[0],
            ports[1],
            shellId = "shell:replacement",
            primaryTicket = "e".repeat(64),
            auxiliaryTicket = "f".repeat(64),
        )
        val manager = RunTargetRelayManager(OkHttpClient())
        try {
            update(manager, projection(first)).getOrThrow()
            update(manager, projection(replacement)).getOrThrow()
            ports.forEach(::assertPortOwned)

            update(manager, projection()).getOrThrow()
            assertEquals(emptySet<Int>(), listenerPorts(manager))
        } finally {
            manager.close()
        }
    }

    @Test
    fun projectionInterruptionPreservesListenersUntilReconnectSnapshot() {
        val ports = availablePorts(2)
        val descriptor = routeSet(ports[0], ports[1])
        val manager = RunTargetRelayManager(OkHttpClient())
        try {
            update(manager, projection(descriptor)).getOrThrow()
            manager.suspendRouteProjection()
            assertFalse(manager.isProjectionReady())
            ports.forEach(::assertPortOwned)

            update(manager, projection()).getOrThrow()
            assertEquals(emptySet<Int>(), listenerPorts(manager))
        } finally {
            manager.close()
        }
    }

    @Test
    fun aFreshManagerReconstructsListenersFromOneProjectionEvent() {
        val ports = availablePorts(2)
        val descriptor = routeSet(ports[0], ports[1])
        val first = RunTargetRelayManager(OkHttpClient())
        update(first, projection(descriptor)).getOrThrow()
        ports.forEach(::assertPortOwned)
        first.close()

        val restarted = RunTargetRelayManager(OkHttpClient())
        try {
            update(restarted, projection(descriptor)).getOrThrow()
            ports.forEach(::assertPortOwned)
        } finally {
            restarted.close()
        }
    }

    @Test
    fun supersededProjectionCannotResurrectRemovedListeners() {
        val ports = availablePorts(2)
        val descriptor = routeSet(ports[0], ports[1])
        val firstProbeStarted = CountDownLatch(1)
        val releaseFirstProbe = CountDownLatch(1)
        val probeCount = AtomicInteger(0)
        val manager = RunTargetRelayManager(
            OkHttpClient(),
            localityClassifier = {
                if (probeCount.incrementAndGet() == 1) {
                    firstProbeStarted.countDown()
                    releaseFirstProbe.await(5, TimeUnit.SECONDS)
                }
                false
            },
        )
        val firstDone = CountDownLatch(1)
        val secondDone = CountDownLatch(1)
        try {
            manager.updateRouteProjection(
                projection(descriptor),
                "http://framework.example:8089",
            ) { firstDone.countDown() }
            assertTrue(firstProbeStarted.await(5, TimeUnit.SECONDS))
            manager.updateRouteProjection(
                projection(),
                "http://framework.example:8089",
            ) { secondDone.countDown() }
            releaseFirstProbe.countDown()

            assertTrue(firstDone.await(5, TimeUnit.SECONDS))
            assertTrue(secondDone.await(5, TimeUnit.SECONDS))
            assertTrue(manager.isProjectionReady())
            ports.forEach(::assertPortFree)
        } finally {
            releaseFirstProbe.countDown()
            manager.close()
        }
    }
}
