package com.termux.extensions

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TermuxWindowEffectsTest {
    @Test fun admitsOnlyExistingWindowAndPackagedHomeOrReload() {
        val launcher = "http://127.0.0.1:44100/electromux-shell/index.html"
        val calls = mutableListOf<String>()
        fun apply(raw: String) = TermuxWindowEffects.apply(JSONObject(raw), launcher,
            { calls += "register" }, { calls += "home" }, { calls += "reload" })
        apply("""{"kind":"window.create","windowId":1,"options":{}}""")
        apply("""{"kind":"window.load","windowId":1,"source":"url","value":"$launcher"}""")
        apply("""{"kind":"webContents","windowId":1,"action":"reload"}""")
        assertEquals(listOf("register", "home", "reload"), calls)
        for (raw in listOf(
            """{"kind":"window.create","windowId":2,"options":{}}""",
            """{"kind":"window.create","windowId":1,"options":{"nodeIntegration":true}}""",
            """{"kind":"window.load","windowId":1,"source":"file","value":"$launcher"}""",
            """{"kind":"window.load","windowId":1,"source":"url","value":"https://remote.test/"}""",
            """{"kind":"webContents","windowId":1,"action":"goBack"}""",
            """{"kind":"app.quit","windowId":1}""")) {
            try { apply(raw); fail("Unsupported native effect accepted") } catch (_: IllegalArgumentException) { }
            catch (_: IllegalStateException) { }
        }
        assertEquals(3, calls.size)
    }
}
