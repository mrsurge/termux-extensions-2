package com.termux.extensions

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UiIpcClientTest {
    @Test
    fun imeContextNotificationsRequireEnabledSetting() {
        assertTrue(shouldApplyImeContextNotification(true, "ui.editor.focus"))
        assertTrue(shouldApplyImeContextNotification(true, "ui.ime.blur"))
        assertFalse(shouldApplyImeContextNotification(false, "ui.editor.focus"))
        assertFalse(shouldApplyImeContextNotification(false, "ui.ime.blur"))
    }

    @Test
    fun unrelatedNotificationsNeverDriveImeContext() {
        assertFalse(shouldApplyImeContextNotification(true, "console.log"))
    }
}
