package com.termux.extensions

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TermuxChromeTest {
    private val descriptor = TermuxChromePolicy.descriptor("http://127.0.0.1:32123")

    @Test fun packagedChromeHasNoProcessOrApplicationPageAuthority() {
        for (page in listOf("http://127.0.0.1:32123/app/code_te2",
            "http://127.0.0.1:32123/android-shell/index.html", descriptor.entrypoint + "?x"))
            assertFalse(descriptor.allows(page, "view_action"))
        assertFalse(descriptor.allows(descriptor.entrypoint, "start_local_framework"))
        assertFalse(descriptor.allows(descriptor.entrypoint, "evaluateJavaScript"))
    }

    @Test fun exactAllowlistedActionsReuseConsumerHandlersOnce() {
        val seen = mutableListOf<String>()
        val protocol = TermuxChromePolicy.protocol(descriptor, { seen.add(it) },
            { JSONObject().put("locked", true) })
        for (name in listOf("home", "reload", "recents", "lock", "quit", "tools")) {
            val request = protocol.parse(JSONObject().put("id", 1).put("method", "view_action")
                .put("documentId", "1234567890abcdef")
                .put("params", JSONObject().put("action", name)).toString(), descriptor.entrypoint)
            assertTrue(protocol.execute(request).getJSONObject("result").getBoolean("ok"))
            assertEquals(name, seen.last())
        }
        assertEquals(6, seen.size)
        for (params in listOf(JSONObject().put("action", "exec"),
            JSONObject().put("action", "home").put("script", "x"))) {
            val request = protocol.parse(JSONObject().put("id", 1).put("method", "view_action")
                .put("params", params).toString(), descriptor.entrypoint)
            assertFalse(protocol.execute(request).getJSONObject("result").getBoolean("ok"))
        }
        assertEquals(6, seen.size)
    }
}
