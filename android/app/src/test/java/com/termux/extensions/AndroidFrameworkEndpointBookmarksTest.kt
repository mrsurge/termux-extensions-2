package com.termux.extensions

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidFrameworkEndpointBookmarksTest {
    @Test
    fun validationNormalizesEndpointAndSerializesIpv6() {
        val bookmark = validatedAndroidFrameworkEndpointBookmark(
            name = "  Tablet  ",
            frameworkHost = "[::1]",
            frameworkPort = 8089,
        )

        assertEquals("Tablet", bookmark.name)
        assertEquals("::1", bookmark.frameworkHost)
        assertEquals("http://[::1]:8089", bookmark.frameworkBaseUrl)
        assertEquals("Tablet", bookmark.toJson().getString("name"))
    }

    @Test
    fun codecRoundTripPreservesInsertionOrder() {
        val bookmarks = listOf(
            bookmark("Home", "100.108.128.8", 8089),
            bookmark("Local", "127.0.0.1", 8090),
        )

        assertEquals(
            bookmarks,
            decodeAndroidFrameworkEndpointBookmarks(
                encodeAndroidFrameworkEndpointBookmarks(bookmarks),
            ),
        )
    }

    @Test
    fun decoderDropsMalformedAndDuplicateNames() {
        val payload = JSONArray()
            .put(bookmark("Home", "100.108.128.8", 8089).toJson())
            .put(JSONObject().put("name", "Broken").put("frameworkHost", "http://bad"))
            .put(bookmark("home", "127.0.0.1", 9000).toJson())

        assertEquals(
            listOf(bookmark("Home", "100.108.128.8", 8089)),
            decodeAndroidFrameworkEndpointBookmarks(payload.toString()),
        )
        assertEquals(emptyList<AndroidFrameworkEndpointBookmark>(), decodeAndroidFrameworkEndpointBookmarks("{"))
    }

    @Test
    fun upsertReplacesNamesCaseInsensitivelyWithoutReordering() {
        val updated = upsertAndroidFrameworkEndpointBookmark(
            listOf(
                bookmark("Home", "100.108.128.8", 8089),
                bookmark("Local", "127.0.0.1", 8089),
            ),
            bookmark("home", "10.0.0.4", 9000),
        )

        assertEquals(listOf("home", "Local"), updated.map { it.name })
        assertEquals("10.0.0.4", updated.first().frameworkHost)
    }

    @Test
    fun deletionMatchesNamesCaseInsensitively() {
        val updated = deleteAndroidFrameworkEndpointBookmark(
            listOf(
                bookmark("Home", "100.108.128.8", 8089),
                bookmark("Local", "127.0.0.1", 8089),
            ),
            " home ",
        )

        assertEquals(listOf("Local"), updated.map { it.name })
    }

    @Test
    fun validationAndCapacityAreBounded() {
        assertThrows(IllegalArgumentException::class.java) {
            bookmark("", "127.0.0.1", 8089)
        }
        assertThrows(IllegalArgumentException::class.java) {
            bookmark("Bad\nName", "127.0.0.1", 8089)
        }
        assertThrows(IllegalArgumentException::class.java) {
            bookmark("Bad host", "http://example.test", 8089)
        }
        val full = (1..MAX_ANDROID_FRAMEWORK_ENDPOINT_BOOKMARKS).map { index ->
            bookmark("Endpoint $index", "127.0.0.1", 8000 + index)
        }
        assertThrows(IllegalArgumentException::class.java) {
            upsertAndroidFrameworkEndpointBookmark(
                full,
                bookmark("One too many", "127.0.0.1", 9000),
            )
        }
    }

    private fun bookmark(
        name: String,
        host: String,
        port: Int,
    ): AndroidFrameworkEndpointBookmark = validatedAndroidFrameworkEndpointBookmark(
        name = name,
        frameworkHost = host,
        frameworkPort = port,
    )
}
