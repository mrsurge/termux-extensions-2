package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidClientStartupStateTest {
    @Test
    fun coldRestoreWaitsForFrameworkProjectionAndNativeRelayReconciliation() {
        val state = AndroidClientStartupState()
        val generation = state.begin(restoreSavedSession = true)

        assertEquals("FRAMEWORK_RELAY_PENDING", state.phaseName())
        assertTrue(state.markFrameworkRelayReady(generation))
        assertNull(state.recordRestoreHealth(generation, AndroidRemoteAppHealth.HEALTHY))
        assertTrue(state.markProjectionReceived(generation))

        assertEquals(
            AndroidClientStartupAction.RestoreSession(AndroidRemoteAppHealth.HEALTHY),
            state.markProjectionReady(generation),
        )
        assertTrue(state.isReady())
    }

    @Test
    fun projectionMayFinishBeforeHealthWithoutRestoringEarly() {
        val state = AndroidClientStartupState()
        val generation = state.begin(restoreSavedSession = true)
        state.markFrameworkRelayReady(generation)
        state.markProjectionReceived(generation)

        assertNull(state.markProjectionReady(generation))
        assertEquals(
            AndroidClientStartupAction.RestoreSession(AndroidRemoteAppHealth.HEALTHY),
            state.recordRestoreHealth(generation, AndroidRemoteAppHealth.HEALTHY),
        )
    }

    @Test
    fun bufferedSnapshotMayArriveBeforeSocketConnectCallbackWithoutResettingReconcile() {
        val state = AndroidClientStartupState()
        val generation = state.begin(restoreSavedSession = true)
        state.markFrameworkRelayReady(generation)

        assertTrue(state.markProjectionReceived(generation))
        assertEquals("RUN_TARGETS_RECONCILING", state.phaseName())
        assertNull(state.markProjectionReady(generation))

        assertTrue(state.markProjectionReceived(generation))
        assertEquals("RUN_TARGETS_RECONCILING", state.phaseName())
    }

    @Test
    fun explicitAppNavigationSupersedesPendingColdRestore() {
        val state = AndroidClientStartupState()
        val generation = state.begin(restoreSavedSession = true)
        state.markFrameworkRelayReady(generation)
        state.recordRestoreHealth(generation, AndroidRemoteAppHealth.HEALTHY)

        val url = "http://127.0.0.1:41047/app/file_editor_cm6?gv_native=1"
        assertTrue(state.gateAppNavigation(url))
        state.markProjectionReceived(generation)
        assertEquals(AndroidClientStartupAction.Navigate(url), state.markProjectionReady(generation))
    }

    @Test
    fun launcherNavigationDoesNotWaitForFrameworkProjectionReconnect() {
        val state = AndroidClientStartupState()
        val generation = state.begin(restoreSavedSession = false)
        state.markFrameworkRelayReady(generation)

        assertEquals("ROUTE_SNAPSHOT_PENDING", state.phaseName())
        assertFalse(
            state.gateAppNavigation(
                "http://127.0.0.1:41047/app/file_editor_cm6?gv_native=1",
            ),
        )
    }

    @Test
    fun projectionDisconnectDoesNotBlockInteractiveNavigationWithoutAColdRestore() {
        val state = AndroidClientStartupState()
        val generation = state.begin(restoreSavedSession = false)
        state.markFrameworkRelayReady(generation)
        state.markProjectionReceived(generation)
        assertNull(state.markProjectionReady(generation))
        assertFalse(state.gateAppNavigation("http://127.0.0.1:41047/app/one"))

        state.markAuthorityUnavailable(generation)
        val queued = "http://127.0.0.1:41047/app/two?gv_native=1"
        assertFalse(state.gateAppNavigation(queued))
        state.markProjectionReceived(generation)
        assertNull(state.markProjectionReady(generation))
    }

    @Test
    fun launcherWaitsForFreshRemoteProjectionBeforeLoading() {
        val state = AndroidClientStartupState()
        val generation = state.begin(
            restoreSavedSession = false,
            loadHomeWhenReady = true,
        )
        state.markFrameworkRelayReady(generation)

        assertTrue(state.markProjectionReceived(generation))
        assertEquals(AndroidClientStartupAction.LoadHome, state.markProjectionReady(generation))
    }

    @Test
    fun staleBootstrapEventsCannotReleaseTheCurrentGate() {
        val state = AndroidClientStartupState()
        val stale = state.begin(restoreSavedSession = true)
        val current = state.begin(restoreSavedSession = true)

        assertFalse(state.markFrameworkRelayReady(stale))
        assertNull(state.markProjectionReady(stale))
        assertTrue(state.markFrameworkRelayReady(current))
        assertFalse(state.isReady())
    }

    @Test
    fun savedSessionOriginsAreRebasedOntoTheNewColdStartRelays() {
        val serialized = """{
            "history":[
                {"url":"http:\/\/127.0.0.1:37821\/android-shell\/index.html"},
                {"url":"http:\/\/127.0.0.1:41047\/app\/file_editor_cm6?gv_native=1"}
            ]
        }""".trimIndent()

        assertEquals(
            "http://127.0.0.1:41047",
            androidSavedAppOrigin("http://127.0.0.1:41047/app/file_editor_cm6?gv_native=1"),
        )
        assertEquals("http://127.0.0.1:37821", androidSavedLauncherOrigin(serialized))
        val rewritten = rewriteAndroidSavedSessionPayload(
            serializedState = serialized,
            previousFrameworkOrigin = "http://127.0.0.1:41047",
            currentFrameworkOrigin = "http://127.0.0.1:42000",
            previousLauncherOrigin = "http://127.0.0.1:37821",
            currentLauncherOrigin = "http://127.0.0.1:43000",
        )
        assertTrue(rewritten.contains("""http:\/\/127.0.0.1:42000\/app\/file_editor_cm6"""))
        assertTrue(rewritten.contains("""http:\/\/127.0.0.1:43000\/android-shell\/index.html"""))
    }

    @Test
    fun serializedSessionStateIsNotRestoredAcrossRandomRelayOrigins() {
        assertFalse(
            androidSavedSessionOriginsMatch(
                previousFrameworkOrigin = "http://127.0.0.1:41047",
                currentFrameworkOrigin = "http://127.0.0.1:42000",
                previousLauncherOrigin = "http://127.0.0.1:37821",
                currentLauncherOrigin = "http://127.0.0.1:43000",
            ),
        )
        assertTrue(
            androidSavedSessionOriginsMatch(
                previousFrameworkOrigin = "http://127.0.0.1:41047",
                currentFrameworkOrigin = "http://127.0.0.1:41047",
                previousLauncherOrigin = "http://127.0.0.1:37821",
                currentLauncherOrigin = "http://127.0.0.1:37821",
            ),
        )
    }
}
