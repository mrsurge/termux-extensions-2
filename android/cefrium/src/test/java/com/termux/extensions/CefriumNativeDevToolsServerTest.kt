package com.termux.extensions

import org.junit.Assert.*
import org.junit.Test

class CefriumNativeDevToolsServerTest {
    @Test fun preservesSecurityAndDestroysOwnedHandleOnce() {
        val calls = mutableListOf<String>()
        val native = object : CefriumDevToolsNativeApi {
            override fun initialize(prefix: String): Long { calls += prefix; return 42L }
            override fun enable(handle: Long, enabled: Boolean, allowDebugPermission: Boolean) {
                assertEquals(42L, handle)
                assertFalse(allowDebugPermission)
                calls += "enable:$enabled"
            }
            override fun destroy(handle: Long) { assertEquals(42L, handle); calls += "destroy" }
        }
        val server = CefriumNativeDevToolsServer("private-prefix", native)
        server.setRemoteDebuggingEnabled(true)
        server.setRemoteDebuggingEnabled(false)
        server.destroy(); server.destroy()
        try { server.setRemoteDebuggingEnabled(true); fail("Destroyed server enabled") } catch (_: IllegalStateException) { }
        assertEquals(listOf("private-prefix", "enable:true", "enable:false", "destroy"), calls)
    }
}
