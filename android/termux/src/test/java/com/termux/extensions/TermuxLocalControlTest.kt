package com.termux.extensions

import dev.mrsurge.electromux.host.ConsumerPageProtocol
import dev.mrsurge.electromux.host.ConsumerResult
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TermuxLocalControlTest {
    private val origin = "http://127.0.0.1:44100"
    @Test fun executionAuthorityIsExactPackagedDocument() {
        val policy = TermuxLocalControlPolicy.descriptor(origin)
        for (page in listOf("index.html", "settings.html"))
            assertTrue(policy.allows("$origin/android-shell/$page", "start_local_framework"))
        for (page in listOf("$origin/app/code_te2", "$origin/android-shell/index.html?q=1",
            "$origin/android-shell/settings.html#x", "http://remote.test/android-shell/index.html",
            "http://127.0.0.1:44101/android-shell/index.html"))
            assertFalse(policy.allows(page, "start_local_framework"))
        assertFalse(policy.allows("$origin/android-shell/index.html", "set_selected_framework"))
        assertFalse(policy.allows("$origin/android-shell/index.html", "shutdown"))
    }
    @Test fun genericProtocolActuallyEnforcesConsumerPolicy() {
        val descriptor = TermuxLocalControlPolicy.descriptor(origin)
        var invoked = 0
        val protocol = ConsumerPageProtocol(descriptor, descriptor.methods.associateWith {
            { _: JSONObject -> invoked++; ConsumerResult(JSONObject()) }
        })
        val raw = JSONObject().put("id", 1).put("method", "start_local_framework")
            .put("params", JSONObject()).put("documentId", "0123456789abcdef").toString()
        val request = protocol.parse(raw, "$origin/android-shell/index.html")
        protocol.execute(request)
        assertEquals(1, invoked)
        try { protocol.parse(raw, "$origin/app/code_te2"); fail("Remote app accepted") }
        catch (_: IllegalArgumentException) {}
        assertEquals(1, invoked)
    }
    private fun state(revision: Long, selected: String = "http://127.0.0.1:8089") =
        JSONObject().put("selectionRevision", revision).put("selectedOrigin", selected)
    @Test fun refreshCannotRetargetAndExplicitIntentIsSingleUse() {
        val fence = TermuxLocalSelectionFence()
        assertNull(fence.consume(state(1)))
        fence.arm("http://remote.test:8089")
        assertNull(fence.consume(state(1)))
        assertEquals(8089 to "http://remote.test:8089", fence.consume(state(2)))
        assertNull(fence.consume(state(2)))
        assertNull(fence.consume(state(3)))
    }
    @Test fun invalidOrRetainedActorSelectionCannotBecomeNewIntent() {
        val fence = TermuxLocalSelectionFence()
        fence.observe(8)
        fence.arm(origin)
        assertNull(fence.consume(state(8)))
        assertNull(fence.consume(state(9, "http://remote.test:8089")))
        assertNull(fence.consume(state(10)))
        fence.reset(); fence.arm(origin)
        assertNull(fence.consume(state(1, "http://127.0.0.1:99999")))
    }
    @Test fun bundledSeedContainsActorAndBridgeBeforeConsumerBootstrap() {
        val root = java.io.File("build/generated/termuxShellAssets")
        assertEquals(java.io.File("../../desktop_client/electromux/dist/local-framework-backend.mjs").readText(),
            java.io.File(root, "electromux_backend/local-framework-backend.mjs").readText())
        for (page in listOf("index.html", "settings.html")) {
            val html = java.io.File(root, "electromux_shell/$page").readText()
            assertTrue(html.indexOf("./electromux-bridge.js") >= 0)
            assertTrue(html.indexOf("./electromux-bridge.js") < html.indexOf("./electromux-bootstrap.js"))
        }
        assertEquals("electromux-bridge.js", TermuxShellAssets.assetPath("/android-shell/electromux-bridge.js"))
    }
    @Test fun nativeSelectionUpdatesActivityProjectionBeforeReadiness() {
        val source = java.io.File("../cefrium/src/main/java/com/termux/extensions/MainActivity.kt").readText()
        val observer = source.substringAfter("override fun onRuntimeStateChanged(snapshot: AndroidClientRuntimeSnapshot)")
            .substringBefore("override fun onImeContextChanged")
        assertTrue(observer.indexOf("frameworkBaseUrl = snapshot.frameworkBaseUrl") >= 0)
        assertTrue(observer.indexOf("frameworkBaseUrl = snapshot.frameworkBaseUrl") <
            observer.indexOf("if (snapshot.projectionReady)"))
        assertFalse(observer.contains("applySettings(")) // No recursive configure/OTA work.
    }
    @Test fun settledPageRequestsStateWithoutLaunchingOrWeakeningAuthority() {
        val source = java.io.File("src/main/java/com/termux/extensions/TermuxLocalPageBridge.kt").readText()
        val ready = source.substringAfter("fun pageReady()").substringBefore("fun handle(")
        assertTrue(ready.contains("gate.captureRequest(page) != null"))
        assertTrue(ready.contains("electromux:page-ready"))
        assertFalse(ready.contains("start_local_framework"))
        val activity = java.io.File("../cefrium/src/main/java/com/termux/extensions/MainActivity.kt").readText()
        assertTrue(activity.substringAfter("if (!isLoading) {")
            .substringBefore("browser.setOnRenderProcessTerminatedListener").contains("termuxLocalPageBridge?.pageReady()"))
    }
}
