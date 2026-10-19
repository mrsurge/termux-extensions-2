package com.termux.extensions

import org.junit.Assert.*
import org.junit.Test

class CefriumViewportRestoreGateTest {
    @Test fun inactiveDoesNotAdmitRendererWork() {
        val gate = CefriumViewportRestoreGate()
        assertFalse(gate.accepts(gate.generation))
    }

    @Test fun successfulEarlyRestoreDoesNotConsumeLaterRendererEvent() {
        val gate = CefriumViewportRestoreGate()
        assertTrue(gate.activate())
        val ticket = gate.generation
        assertTrue(gate.accepts(ticket)) // Activity restore succeeds.
        assertTrue(gate.accepts(ticket)) // Surface restore is still admitted.
    }

    @Test fun surfaceLossInvalidatesQueuedWorkButAllowsReattachment() {
        val gate = CefriumViewportRestoreGate()
        gate.activate()
        val oldSurface = gate.generation
        gate.invalidate()
        assertFalse(gate.accepts(oldSurface))
        assertTrue(gate.accepts(gate.generation))
    }

    @Test fun pauseAndResumeFenceThePreviousIncarnation() {
        val gate = CefriumViewportRestoreGate()
        gate.activate()
        val beforePause = gate.generation
        gate.suspend()
        assertFalse(gate.active)
        assertFalse(gate.accepts(beforePause))
        assertFalse(gate.accepts(gate.generation))
        gate.activate()
        assertFalse(gate.accepts(beforePause))
        assertTrue(gate.accepts(gate.generation))
    }

    @Test fun closeCannotBeResurrectedByFocusOrRendererEvents() {
        val gate = CefriumViewportRestoreGate()
        gate.activate()
        gate.close()
        assertFalse(gate.activate())
        assertFalse(gate.active)
        assertFalse(gate.accepts(gate.generation))
    }
}
