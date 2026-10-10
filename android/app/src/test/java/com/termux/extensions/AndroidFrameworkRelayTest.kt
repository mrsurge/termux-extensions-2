package com.termux.extensions

import org.junit.Assert.*
import org.junit.Test

class AndroidFrameworkRelayTest {
    @Test
    fun preferredPortReusesAndCollisionFallsBackWithoutAdoptingListener() {
        val initial = AndroidFrameworkRelay()
        initial.start("http://127.0.0.1:8089")
        val preferred = initial.port
        initial.stop()
        val reused = AndroidFrameworkRelay()
        val fallback = AndroidFrameworkRelay()
        try {
            reused.start("http://127.0.0.1:8089", preferred)
            fallback.start("http://127.0.0.1:8089", preferred)
            assertEquals(preferred, reused.port)
            assertNull(reused.fallbackReason)
            assertNotEquals(preferred, fallback.port)
            assertEquals(preferred, fallback.preferredPort)
            assertEquals("BindException", fallback.fallbackReason)
            val origin = fallback.browserOrigin
            fallback.retarget("http://127.0.0.1:8090")
            assertEquals(origin, fallback.browserOrigin)
            assertEquals("http://127.0.0.1:8090", fallback.configuredOrigin)
        } finally { fallback.stop(); reused.stop() }
    }
}
