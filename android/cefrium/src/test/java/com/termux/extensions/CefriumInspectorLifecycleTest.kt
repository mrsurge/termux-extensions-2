package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CefriumInspectorLifecycleTest {
    private val surface = AndroidDevRuntimeSurface(
        surfaceId = "run-profile:test",
        profileId = "test",
        targetId = "run-profile:test",
        targetLabel = "Run test",
        devRuntime = true,
        devTools = true,
        workerIdBase = "rp-test",
        workerLabel = "run-profile:test",
        frameworkOrigin = "http://127.0.0.1:8089",
        origins = setOf("http://127.0.0.1:8000"),
    )

    @Test
    fun inspectorLifetimeIsOwnedByTheLoadedAppShell() {
        assertFalse(shouldStartCefriumInspector(true, false, true))
        assertFalse(shouldStartCefriumInspector(true, true, false))
        assertFalse(shouldStartCefriumInspector(false, true, true))
        assertTrue(shouldStartCefriumInspector(true, true, true))
    }

    @Test
    fun devRuntimeInstrumentationDoesNotRequireInspectorSettings() {
        assertFalse(shouldStartCefriumDevToolsRuntime(false, true, false, true))
        assertFalse(shouldStartCefriumDevToolsRuntime(false, true, true, false))
        assertFalse(shouldStartCefriumDevToolsRuntime(false, false, true, true))
        assertTrue(shouldStartCefriumDevToolsRuntime(false, true, true, true))
        assertTrue(shouldStartCefriumDevToolsRuntime(true, false, true, true))
    }

    @Test
    fun retainedInspectorResumesOnlyForTheActivityLifecycle() {
        assertFalse(shouldResumeCefriumInspectorBrowser(false, true, true))
        assertTrue(shouldResumeCefriumInspectorBrowser(true, true, false))
        assertFalse(shouldResumeCefriumInspectorBrowser(true, false, false))
        assertTrue(shouldResumeCefriumInspectorBrowser(true, false, true))
    }

    @Test
    fun oneClientReceivesEachPositiveTargetGenerationOnce() {
        assertFalse(shouldDeliverCefriumInspectorGeneration(false, 1L, 0L))
        assertFalse(shouldDeliverCefriumInspectorGeneration(true, 0L, 0L))
        assertTrue(shouldDeliverCefriumInspectorGeneration(true, 1L, 0L))
        assertFalse(shouldDeliverCefriumInspectorGeneration(true, 1L, 1L))
        assertTrue(shouldDeliverCefriumInspectorGeneration(true, 2L, 1L))
    }

    @Test
    fun activationCanReplayTheCurrentGenerationWithoutInventingANewOne() {
        assertTrue(
            shouldDeliverCefriumInspectorGeneration(
                clientReady = true,
                generation = 3L,
                deliveredGeneration = 3L,
                forceReplay = true,
            ),
        )
        assertFalse(
            shouldDeliverCefriumInspectorGeneration(
                clientReady = false,
                generation = 3L,
                deliveredGeneration = 3L,
                forceReplay = true,
            ),
        )
    }

    @Test
    fun clientReadyIsRequestedOnlyAfterInitialLoadCompletes() {
        assertFalse(shouldRequestCefriumInspectorClientReady(true, false))
        assertTrue(shouldRequestCefriumInspectorClientReady(false, false))
    }

    @Test
    fun childFrameLoadsCannotRestartAnEstablishedClientHandshake() {
        assertFalse(shouldRequestCefriumInspectorClientReady(false, true))
    }

    @Test
    fun identicalRuntimePolicyDoesNotReconcileAgain() {
        val current = cefriumDevToolsPolicy(
            runProfilesEnabled = true,
            debugTargetsEnabled = false,
            surfaces = listOf(surface),
        )
        val next = cefriumDevToolsPolicy(
            runProfilesEnabled = true,
            debugTargetsEnabled = false,
            surfaces = listOf(surface.copy()),
        )

        assertFalse(shouldReconcileCefriumDevToolsPolicy(current, next))
    }

    @Test
    fun settingsOrSurfaceChangesStillReconcile() {
        val current = cefriumDevToolsPolicy(
            runProfilesEnabled = true,
            debugTargetsEnabled = false,
            surfaces = listOf(surface),
        )

        assertTrue(
            shouldReconcileCefriumDevToolsPolicy(
                current,
                current.copy(debugTargetsEnabled = true),
            ),
        )
        assertTrue(
            shouldReconcileCefriumDevToolsPolicy(
                current,
                cefriumDevToolsPolicy(
                    runProfilesEnabled = true,
                    debugTargetsEnabled = false,
                    surfaces = listOf(surface.copy(origins = setOf("http://127.0.0.1:9000"))),
                ),
            ),
        )
    }

    @Test
    fun disabledRunProfileInspectionRetainsOnlyDevRuntimePolicy() {
        val policy = cefriumDevToolsPolicy(
            runProfilesEnabled = false,
            debugTargetsEnabled = false,
            surfaces = listOf(surface.copy(devRuntime = false), surface.copy(surfaceId = "runtime")),
        )

        assertEquals(setOf("runtime"), policy.surfaces.keys)
    }
}
