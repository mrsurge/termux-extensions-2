package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidRemoteAppHealthTest {
    @Test
    fun readyAndStartingAppsAreHealthy() {
        assertEquals(
            AndroidRemoteAppHealth.HEALTHY,
            evaluateRunningAppsPayload(
                """{"ok":true,"data":[{"app_id":"code_te2","readiness":{"status":"ready"}}]}""",
                "code_te2",
            ),
        )
        assertEquals(
            AndroidRemoteAppHealth.HEALTHY,
            evaluateRunningAppsPayload(
                """{"ok":true,"data":[{"app_id":"code_te2","readiness":{"status":"starting"}}]}""",
                "code_te2",
            ),
        )
    }

    @Test
    fun missingAndTerminalAppsAreUnhealthy() {
        assertEquals(
            AndroidRemoteAppHealth.UNHEALTHY,
            evaluateRunningAppsPayload("""{"ok":true,"data":[]}""", "code_te2"),
        )
        assertEquals(
            AndroidRemoteAppHealth.UNHEALTHY,
            evaluateRunningAppsPayload(
                """{"ok":true,"data":[{"app_id":"code_te2","readiness":{"status":"error"}}]}""",
                "code_te2",
            ),
        )
    }

    @Test
    fun invalidProjectionIsUnreachable() {
        assertEquals(
            AndroidRemoteAppHealth.UNREACHABLE,
            evaluateRunningAppsPayload("not-json", "code_te2"),
        )
        assertEquals(
            AndroidRemoteAppHealth.UNREACHABLE,
            evaluateRunningAppsPayload("""{"ok":false,"data":[]}""", "code_te2"),
        )
    }

    @Test
    fun unreachableTransportPreservesTheAppAndBreaksTheFailureSequence() {
        assertEquals(
            AndroidRemoteAppFallbackDecision(
                consecutiveUnhealthyCount = 0,
                loadHome = false,
            ),
            evaluateRemoteAppFallback(
                AndroidRemoteAppHealth.UNREACHABLE,
                consecutiveUnhealthyCount = 2,
                failureLimit = 3,
            ),
        )
    }

    @Test
    fun onlyConsecutiveAuthoritativeFailuresReachLauncherFallback() {
        val first = evaluateRemoteAppFallback(
            AndroidRemoteAppHealth.UNHEALTHY,
            consecutiveUnhealthyCount = 0,
            failureLimit = 3,
        )
        val second = evaluateRemoteAppFallback(
            AndroidRemoteAppHealth.UNHEALTHY,
            consecutiveUnhealthyCount = first.consecutiveUnhealthyCount,
            failureLimit = 3,
        )
        val third = evaluateRemoteAppFallback(
            AndroidRemoteAppHealth.UNHEALTHY,
            consecutiveUnhealthyCount = second.consecutiveUnhealthyCount,
            failureLimit = 3,
        )

        assertFalse(first.loadHome)
        assertFalse(second.loadHome)
        assertTrue(third.loadHome)
    }

    @Test
    fun healthyProjectionClearsAuthoritativeFailures() {
        assertEquals(
            AndroidRemoteAppFallbackDecision(
                consecutiveUnhealthyCount = 0,
                loadHome = false,
            ),
            evaluateRemoteAppFallback(
                AndroidRemoteAppHealth.HEALTHY,
                consecutiveUnhealthyCount = 2,
                failureLimit = 3,
            ),
        )
    }
}
