package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GeckoDevToolsTargetSelectionTest {
    @Test
    fun soleRunProfileTargetActivatesWithoutDebugTarget() {
        assertTrue(
            shouldActivateRegisteredDevToolsTarget(
                replacingActive = false,
                activeTargetId = null,
                selectedTargetId = null,
                targetId = "run-profile:test",
            ),
        )
    }

    @Test
    fun explicitSelectionWinsWhenNoTargetIsActive() {
        assertTrue(
            shouldActivateRegisteredDevToolsTarget(
                replacingActive = false,
                activeTargetId = null,
                selectedTargetId = "run-profile:test",
                targetId = "run-profile:test",
            ),
        )
        assertFalse(
            shouldActivateRegisteredDevToolsTarget(
                replacingActive = false,
                activeTargetId = null,
                selectedTargetId = "run-profile:other",
                targetId = "run-profile:test",
            ),
        )
    }

    @Test
    fun newTargetDoesNotReplaceAnActiveTarget() {
        assertFalse(
            shouldActivateRegisteredDevToolsTarget(
                replacingActive = false,
                activeTargetId = "framework:main",
                selectedTargetId = null,
                targetId = "run-profile:test",
            ),
        )
    }

    @Test
    fun reconnectingActiveTargetIsReselected() {
        assertTrue(
            shouldActivateRegisteredDevToolsTarget(
                replacingActive = true,
                activeTargetId = "run-profile:test",
                selectedTargetId = "run-profile:test",
                targetId = "run-profile:test",
            ),
        )
    }

    @Test
    fun pruningDebugTargetFallsBackToSurvivingRunProfile() {
        assertEquals(
            "run-profile:test",
            chooseDevToolsTargetAfterPrune(
                activeTargetId = null,
                selectedTargetId = null,
                availableTargetIds = listOf("run-profile:test"),
            ),
        )
    }

    @Test
    fun pruningPreservesAnAvailableExplicitSelection() {
        assertEquals(
            "run-profile:selected",
            chooseDevToolsTargetAfterPrune(
                activeTargetId = null,
                selectedTargetId = "run-profile:selected",
                availableTargetIds = listOf("run-profile:first", "run-profile:selected"),
            ),
        )
    }

    @Test
    fun pruningDoesNotReplaceAnActiveAllowedTarget() {
        assertNull(
            chooseDevToolsTargetAfterPrune(
                activeTargetId = "run-profile:active",
                selectedTargetId = "run-profile:active",
                availableTargetIds = listOf("run-profile:active", "run-profile:other"),
            ),
        )
    }
}
