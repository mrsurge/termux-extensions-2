package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Test

class GeckoRuntimeProviderTest {
    @Test
    fun runtimeConfigAllowsConfiguredIpv4Host() {
        assertEquals(
            """prefs:
  dom.securecontext.allowlist: "192.168.1.169"
""",
            renderGeckoRuntimeConfig("192.168.1.169"),
        )
    }

    @Test
    fun runtimeConfigAllowsConfiguredIpv6Host() {
        assertEquals(
            """prefs:
  dom.securecontext.allowlist: "2001:db8::1"
""",
            renderGeckoRuntimeConfig("2001:db8::1"),
        )
    }

    @Test
    fun runtimeConfigAllowsConfiguredHostname() {
        assertEquals(
            """prefs:
  dom.securecontext.allowlist: "te2.example.test"
""",
            renderGeckoRuntimeConfig("te2.example.test"),
        )
    }
}
