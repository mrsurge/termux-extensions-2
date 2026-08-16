package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidNativePageIdentityTest {
    @Test
    fun appendsRendererMarkersAndPreservesExistingState() {
        assertEquals(
            "http://127.0.0.1:41047/app/code_te2?foo=bar&gv_native=1&te2_renderer=cefrium#editor",
            withAndroidNativePageIdentity(
                "http://127.0.0.1:41047/app/code_te2?foo=bar#editor",
                "cefrium",
            ),
        )
    }

    @Test
    fun replacesStaleNativeMarkers() {
        assertEquals(
            "/app/code_te2?foo=bar&gv_native=1&te2_renderer=gecko",
            withAndroidNativePageIdentity(
                "/app/code_te2?gv_native=1&te2_renderer=cefrium&foo=bar",
                "gecko",
            ),
        )
    }
}
