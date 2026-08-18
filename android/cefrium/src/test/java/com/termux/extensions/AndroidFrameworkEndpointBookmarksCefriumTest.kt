package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidFrameworkEndpointBookmarksCefriumTest {
    @Test
    fun sharedBookmarkCodecIsAvailableToCefrium() {
        val bookmark = validatedAndroidFrameworkEndpointBookmark(
            name = "Remote",
            frameworkHost = "100.108.128.8",
            frameworkPort = 8089,
        )

        assertEquals(
            listOf(bookmark),
            decodeAndroidFrameworkEndpointBookmarks(
                encodeAndroidFrameworkEndpointBookmarks(listOf(bookmark)),
            ),
        )
    }
}
