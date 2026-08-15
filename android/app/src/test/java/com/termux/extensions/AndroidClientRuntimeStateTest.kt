package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidClientRuntimeStateTest {
    @Test
    fun newRuntimeHasNoCachedProjectionAuthority() {
        val state = AndroidClientRuntimeState("http://remote.example:8089")

        val snapshot = state.snapshot()
        assertEquals(1L, snapshot.generation)
        assertFalse(snapshot.projectionReady)
        assertFalse(snapshot.projectionTransportAvailable)
        assertNull(snapshot.lastError)
    }

    @Test
    fun transientTransportLossPreservesReconciledProjection() {
        val state = AndroidClientRuntimeState("http://remote.example:8089")
        val generation = state.generation()
        assertTrue(state.projectionApplied(generation))

        assertTrue(
            state.transportUnavailable(
                generation,
                IllegalStateException("temporary outage"),
            ),
        )

        val snapshot = state.snapshot()
        assertTrue(snapshot.projectionReady)
        assertFalse(snapshot.projectionTransportAvailable)
        assertNull(snapshot.lastError)
    }

    @Test
    fun frameworkRetargetInvalidatesProjectionAndFencesLateCompletion() {
        val state = AndroidClientRuntimeState("http://first.example:8089")
        val firstGeneration = state.generation()
        assertTrue(state.projectionApplied(firstGeneration))

        assertTrue(state.configure("http://second.example:8081"))
        assertFalse(state.projectionApplied(firstGeneration))

        val retargeted = state.snapshot()
        assertEquals(firstGeneration + 1, retargeted.generation)
        assertEquals("http://second.example:8081", retargeted.frameworkBaseUrl)
        assertFalse(retargeted.projectionReady)
        assertFalse(retargeted.projectionTransportAvailable)

        assertTrue(state.projectionApplied(retargeted.generation))
        assertTrue(state.snapshot().projectionReady)
    }

    @Test
    fun failedCurrentProjectionIsReportedButStaleFailureIsIgnored() {
        val state = AndroidClientRuntimeState("http://first.example:8089")
        val firstGeneration = state.generation()
        assertTrue(state.configure("http://second.example:8089"))

        assertFalse(
            state.projectionFailed(
                firstGeneration,
                IllegalStateException("stale failure"),
            ),
        )
        assertNull(state.snapshot().lastError)

        assertTrue(
            state.projectionFailed(
                state.generation(),
                IllegalStateException("port collision"),
            ),
        )
        assertEquals("port collision", state.snapshot().lastError)
        assertFalse(state.snapshot().projectionReady)
    }

    @Test
    fun persistentRendererPolicyRequiresExplicitRemoteAppOptIn() {
        assertTrue(
            shouldKeepAndroidRendererActive(
                persistentModeEnabled = true,
                remoteAppActive = true,
                frameworkBaseUrl = "http://100.91.80.45:8089",
            ),
        )
        assertFalse(
            shouldKeepAndroidRendererActive(
                persistentModeEnabled = false,
                remoteAppActive = true,
                frameworkBaseUrl = "http://100.91.80.45:8089",
            ),
        )
        assertFalse(
            shouldKeepAndroidRendererActive(
                persistentModeEnabled = true,
                remoteAppActive = false,
                frameworkBaseUrl = "http://100.91.80.45:8089",
            ),
        )
        assertFalse(
            shouldKeepAndroidRendererActive(
                persistentModeEnabled = true,
                remoteAppActive = true,
                frameworkBaseUrl = "http://127.0.0.1:8089",
            ),
        )
    }

    @Test
    fun coldRemoteRestoreWaitsForFreshProjectionButLauncherDoesNot() {
        assertEquals(
            AndroidColdRestoreDecision.LOAD_LAUNCHER,
            androidColdRestoreDecision(
                hasSavedRemoteApp = false,
                projectionReady = false,
            ),
        )
        assertEquals(
            AndroidColdRestoreDecision.WAIT_FOR_FRESH_PROJECTION,
            androidColdRestoreDecision(
                hasSavedRemoteApp = true,
                projectionReady = false,
            ),
        )
        assertEquals(
            AndroidColdRestoreDecision.LOAD_SAVED_APP,
            androidColdRestoreDecision(
                hasSavedRemoteApp = true,
                projectionReady = true,
            ),
        )
    }
}
