package com.termux.extensions

import org.junit.Assert.*
import org.junit.Test

class CefriumViewportPolicyTest {
    @Test fun nativePageScaleIsBounded() {
        assertEquals(60, CefriumViewportPolicy.normalizeScale(Int.MIN_VALUE))
        assertEquals(180, CefriumViewportPolicy.normalizeScale(Int.MAX_VALUE))
        assertEquals(100, CefriumViewportPolicy.normalizeScale(100))
        for (percent in 60..180 step 10) {
            val factor = Math.pow(1.2, CefriumViewportPolicy.zoomLevel(percent))
            assertEquals(percent / 100.0, factor, 1e-12)
        }
    }

    @Test fun resetUsesNeutralLayoutAndClampedValues() {
        assertEquals(0.0, CefriumViewportPolicy.zoomLevel(100), 0.0)
        assertEquals(CefriumViewportPolicy.zoomLevel(60), CefriumViewportPolicy.zoomLevel(0), 0.0)
        assertEquals(CefriumViewportPolicy.zoomLevel(180), CefriumViewportPolicy.zoomLevel(1000), 0.0)
    }
}
