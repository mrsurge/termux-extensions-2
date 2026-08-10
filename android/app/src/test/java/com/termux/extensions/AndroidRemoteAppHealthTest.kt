package com.termux.extensions

import org.junit.Assert.assertEquals
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
}
