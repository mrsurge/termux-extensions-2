package com.termux.extensions

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CefriumPagePolicyTest {
    @Test
    fun monacoFocusPolicyIsScopedAndPreventsNativeScroll() {
        val script = CefriumPagePolicy.installScript()

        assertTrue(script.contains("textarea.inputarea.android-ime-input"))
        assertTrue(script.contains("preventScroll: true"))
        assertTrue(script.contains("te2.cefrium.monaco-focus-policy"))
        assertTrue(script.contains("MutationObserver"))
        assertTrue(script.contains("HTMLIFrameElement"))
        assertTrue(script.contains("frame.contentWindow"))
        assertFalse(script.contains("touch-action"))
    }

    @Test
    fun imeDismissalTargetsTheDeepestFocusedSameOriginDocument() {
        val script = CefriumPagePolicy.imeDismissalScript()

        assertTrue(script.contains("te2:android-ime-dismissed"))
        assertTrue(script.contains("activeElement"))
        assertTrue(script.contains("contentWindow"))
        assertTrue(script.contains("location.origin"))
        assertFalse(script.contains("hideSoftInput"))
    }
}
