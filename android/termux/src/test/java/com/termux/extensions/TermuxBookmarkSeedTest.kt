package com.termux.extensions

import org.junit.Assert.*
import org.junit.Test

class TermuxBookmarkSeedTest {
    @Test fun presetIsAppendedWithoutReplacingManualBookmarks() {
        val remote = AndroidFrameworkEndpointBookmark("Remote", "remote.test", 8090)
        val seeded = withTermuxLocalhostBookmark(listOf(remote))
        assertEquals(remote, seeded.first())
        assertEquals(AndroidFrameworkEndpointBookmark("Localhost", "127.0.0.1", 8089), seeded.last())
        assertEquals(seeded, withTermuxLocalhostBookmark(seeded))
    }
    @Test fun nameCollisionExistingEndpointAndCapacityRemainUntouched() {
        for (current in listOf(
            listOf(AndroidFrameworkEndpointBookmark("localhost", "custom.test", 8090)),
            listOf(AndroidFrameworkEndpointBookmark("My local", "127.0.0.1", 8089)),
            (1..MAX_ANDROID_FRAMEWORK_ENDPOINT_BOOKMARKS).map { AndroidFrameworkEndpointBookmark("Host $it", "remote.test", 8000 + it) }
        )) assertSame(current, withTermuxLocalhostBookmark(current))
    }
    @Test fun androidActionsOnlyAllowPackagedDocuments() {
        val descriptor = TermuxLocalControlPolicy.descriptor("http://127.0.0.1:44000")
        for (method in listOf("get_android_settings", "save_android_settings", "open_power_settings", "open_notification_settings")) {
            assertTrue(descriptor.allows("http://127.0.0.1:44000/electromux-shell/settings.html", method))
            assertFalse(descriptor.allows("http://127.0.0.1:44000/app/code_te2", method))
            assertFalse(descriptor.allows("http://remote.test/electromux-shell/settings.html", method))
        }
    }
}
