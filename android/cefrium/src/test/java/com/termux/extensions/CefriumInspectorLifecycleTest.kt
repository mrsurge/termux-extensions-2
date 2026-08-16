package com.termux.extensions

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CefriumInspectorLifecycleTest {
    @Test
    fun inspectorWaitsForMainPageAndVisibleInspectorTab() {
        assertFalse(shouldStartCefriumInspector(true, false, true, true))
        assertFalse(shouldStartCefriumInspector(true, true, false, true))
        assertFalse(shouldStartCefriumInspector(true, true, true, false))
        assertFalse(shouldStartCefriumInspector(false, true, true, true))
        assertTrue(shouldStartCefriumInspector(true, true, true, true))
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
    fun clientReadyIsRequestedOnlyAfterInitialLoadCompletes() {
        assertFalse(shouldRequestCefriumInspectorClientReady(true, false))
        assertTrue(shouldRequestCefriumInspectorClientReady(false, false))
    }

    @Test
    fun childFrameLoadsCannotRestartAnEstablishedClientHandshake() {
        assertFalse(shouldRequestCefriumInspectorClientReady(false, true))
    }
}
