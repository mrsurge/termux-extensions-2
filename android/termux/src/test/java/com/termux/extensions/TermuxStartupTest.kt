package com.termux.extensions

import java.io.Closeable
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TermuxStartupTest {
    private class Runtime : AndroidLocalFrameworkRuntime {
        var starts = 0
        var observer: ((String, JSONObject) -> Unit)? = null
        override fun execute(operation: () -> Unit) = operation()
        override fun request(method: String, params: JSONObject): JSONObject {
            assertEquals("start_local_framework", method); starts++
            return JSONObject().put("phase", "starting")
        }
        override fun subscribe(observer: (String, JSONObject) -> Unit): Closeable {
            this.observer = observer
            return Closeable { this.observer = null }
        }
        fun state(phase: String, origin: String, selected: Boolean = true) {
            observer?.invoke("local-framework-state", JSONObject().put("data", JSONObject()
                .put("phase", phase).put("localOrigin", origin).put("selected", selected)))
        }
        override fun close() {}
    }
    @Test fun startsOnceAndOnlyOpensPreferredAfterSelectedReadiness() {
        val runtime = Runtime()
        var origin = "http://remote.test:8089"
        val opened = mutableListOf<Pair<String, String>>()
        val coordinator = TermuxStartupCoordinator(TermuxStartupSettings(true, true, "code_te2"),
            runtime, { origin }, { app, host -> opened.add(app to host) }, { fail(it) })
        coordinator.begin(); coordinator.begin()
        assertEquals(1, runtime.starts); assertTrue(opened.isEmpty())
        runtime.state("running", "http://127.0.0.1:8089", false)
        assertTrue(opened.isEmpty()) // Native endpoint selection has not completed.
        origin = "http://127.0.0.1:8089"
        runtime.state("running", origin)
        runtime.state("running", origin)
        assertEquals(listOf("code_te2" to origin), opened)
    }
    @Test fun remoteSelectionAndDisposeFenceLateReadiness() {
        val runtime = Runtime(); var origin = "http://first.test:8089"; var opens = 0
        val coordinator = TermuxStartupCoordinator(TermuxStartupSettings(true, true, "code_te2"),
            runtime, { origin }, { _, _ -> opens++ }, { fail(it) })
        coordinator.begin(); origin = "http://second.test:8089"
        runtime.state("running", "http://127.0.0.1:8089", false)
        origin = "http://127.0.0.1:8089"; runtime.state("running", origin)
        assertEquals(0, opens)
        coordinator.close(); assertNull(runtime.observer)
    }
    @Test fun remotePreferredModeDoesNotStartLocalFramework() {
        val runtime = Runtime(); var opened = false
        TermuxStartupCoordinator(TermuxStartupSettings(false, true, "code_te2"), runtime,
            { "http://remote.test:8089" }, { _, _ -> opened = true }, { fail(it) }).begin()
        assertEquals(0, runtime.starts); assertTrue(opened)
    }
    @Test fun startupSettingsValidateNamesTypesAndNoDefaultLaunch() {
        assertEquals(TermuxStartupSettings(), TermuxStartupSettings.parse(JSONObject()))
        for (value in listOf(JSONObject().put("preferredAppId", "../evil"),
            JSONObject().put("autostart", "true"))) {
            try { TermuxStartupSettings.parse(value); fail("Invalid startup config accepted") }
            catch (_: IllegalArgumentException) {}
        }
        val descriptor = TermuxLocalControlPolicy.descriptor("http://127.0.0.1:44100")
        assertFalse(descriptor.allows("http://127.0.0.1:44100/app/code_te2", "save_settings"))
        assertFalse(descriptor.allows("http://127.0.0.1:44100/android-shell/index.html", "save_settings"))
    }
}
