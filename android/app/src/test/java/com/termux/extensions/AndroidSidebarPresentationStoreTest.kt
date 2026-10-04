package com.termux.extensions

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidSidebarPresentationStoreTest {
    @Test
    fun terminalPreferenceIsClientFrameworkScopedAndPreservesDockState() {
        var payload: String? = null
        val store = AndroidSidebarPresentationStore({ payload }, { payload = it; true })
        val client = "client_aaaaaaaaaaaa"
        val origin = "http://server-a:8089"
        assertEquals("ask", store.terminalDestination(client, origin))
        store.write(client, origin, "/project/a", state())
        assertEquals("drawer", store.terminalDestination(client, origin, "drawer"))
        store.write(client, origin, "/project/b", state())
        val recreated = AndroidSidebarPresentationStore({ payload }, { payload = it; true })
        assertEquals("drawer", recreated.terminalDestination(client, origin))
        assertEquals("hidden", recreated.read(client, origin, "/project/a")?.getJSONObject("presentations")?.getString("extension-a"))
        assertEquals("ask", recreated.terminalDestination("client_bbbbbbbbbbbb", origin))
        assertEquals("ask", recreated.terminalDestination(client, "http://server-b:8089"))
        assertEquals("ask", recreated.terminalDestination(client, origin, "ask"))
    }

    private fun state(mode: String = "hidden"): JSONObject = JSONObject()
        .put("version", 1)
        .put("order", JSONArray().put("extension-a"))
        .put("foregroundHostId", "")
        .put("lastAgentHostId", "extension-a")
        .put("lastAgentPresentationId", "transient-frame")
        .put("presentations", JSONObject().put("extension-a", mode))

    @Test
    fun persistsByStableClientFrameworkAndProjectIdentity() {
        var payload: String? = null
        val store = AndroidSidebarPresentationStore(
            readPayload = { payload },
            writePayload = {
                payload = it
                true
            },
        )

        store.write(
            "client_aaaaaaaaaaaa",
            "HTTP://Server-A:8089/path-is-ignored",
            "/workspace/a/",
            state(),
        )

        val restored = store.read(
            "client_aaaaaaaaaaaa",
            "http://server-a:8089",
            "/workspace/a",
        )
        assertEquals("hidden", restored?.getJSONObject("presentations")?.getString("extension-a"))
        assertEquals("", restored?.getString("lastAgentPresentationId"))
        assertNull(store.read("client_bbbbbbbbbbbb", "http://server-a:8089", "/workspace/a"))
        assertNull(store.read("client_aaaaaaaaaaaa", "http://server-b:8089", "/workspace/a"))
        assertNull(store.read("client_aaaaaaaaaaaa", "http://server-a:8089", "/workspace/b"))
    }

    @Test
    fun retainsOnlyTheMostRecentProjectPartitions() {
        var payload: String? = null
        val store = AndroidSidebarPresentationStore(
            readPayload = { payload },
            writePayload = {
                payload = it
                true
            },
        )

        repeat(33) { index ->
            store.write(
                "client_aaaaaaaaaaaa",
                "http://server-a:8089",
                "/workspace/$index",
                state(),
            )
        }

        val records = JSONObject(payload!!).getJSONObject("records")
        assertEquals(32, records.length())
        assertNull(store.read("client_aaaaaaaaaaaa", "http://server-a:8089", "/workspace/0"))
        assertTrue(
            store.read("client_aaaaaaaaaaaa", "http://server-a:8089", "/workspace/32") != null,
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsUnknownPresentationModes() {
        val store = AndroidSidebarPresentationStore(
            readPayload = { null },
            writePayload = { true },
        )
        store.write(
            "client_aaaaaaaaaaaa",
            "http://server-a:8089",
            "/workspace/a",
            state("floating"),
        )
    }
}
