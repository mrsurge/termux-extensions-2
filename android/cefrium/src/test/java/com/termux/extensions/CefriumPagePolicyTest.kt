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
        assertFalse(script.contains("touch-action"))
    }
}
