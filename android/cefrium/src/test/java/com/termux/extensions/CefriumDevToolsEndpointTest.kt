package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class CefriumDevToolsEndpointTest {
    @Test
    fun serverPrefixAndRelayNameAgree() {
        val endpoint = CefriumDevToolsEndpoint(8695)
        assertEquals("te2_cefrium_8695", endpoint.prefix)
        assertEquals("${endpoint.prefix}_devtools_remote", endpoint.socketName)
        assertEquals(endpoint.socketName, CefriumDevToolsEndpoint(8695).socketName)
    }

    @Test
    fun siblingApksAndRestartedProcessesDoNotShareSockets() {
        val first = CefriumDevToolsEndpoint(8695)
        val second = CefriumDevToolsEndpoint(26910)
        assertNotEquals(first.prefix, second.prefix)
        assertNotEquals(first.socketName, second.socketName)
        assertNotEquals("te2_cefrium_devtools_remote", first.socketName)
    }

    @Test(expected = IllegalArgumentException::class)
    fun unknownProcessCannotSelectLegacySocket() {
        CefriumDevToolsEndpoint(0)
    }
}
