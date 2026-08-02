package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidRemoteAppHealthTest {
    @Test
    fun readyAndStartingAppsAreHealthy() {
        assertEquals(
            AndroidRemoteAppHealth.HEALTHY,
            evaluateRunningAppsPayload(
                """{"ok":true,"data":[{"app_id":"file_editor_cm6","readiness":{"status":"ready"}}]}""",
                "file_editor_cm6",
            ),
        )
        assertEquals(
            AndroidRemoteAppHealth.HEALTHY,
            evaluateRunningAppsPayload(
                """{"ok":true,"data":[{"app_id":"file_editor_cm6","readiness":{"status":"starting"}}]}""",
                "file_editor_cm6",
            ),
        )
    }

    @Test
    fun missingAndTerminalAppsAreUnhealthy() {
        assertEquals(
            AndroidRemoteAppHealth.UNHEALTHY,
            evaluateRunningAppsPayload("""{"ok":true,"data":[]}""", "file_editor_cm6"),
        )
        assertEquals(
            AndroidRemoteAppHealth.UNHEALTHY,
            evaluateRunningAppsPayload(
                """{"ok":true,"data":[{"app_id":"file_editor_cm6","readiness":{"status":"error"}}]}""",
                "file_editor_cm6",
            ),
        )
    }

    @Test
    fun invalidProjectionIsUnreachable() {
        assertEquals(
            AndroidRemoteAppHealth.UNREACHABLE,
            evaluateRunningAppsPayload("not-json", "file_editor_cm6"),
        )
        assertEquals(
            AndroidRemoteAppHealth.UNREACHABLE,
            evaluateRunningAppsPayload("""{"ok":false,"data":[]}""", "file_editor_cm6"),
        )
    }
}
