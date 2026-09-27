package com.termux.extensions

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CefriumInspectorSessionsTest {
    private fun attach(parent: String, child: String) = JSONObject()
        .put("sessionId", parent).put("method", "Target.attachedToTarget")
        .put("params", JSONObject().put("sessionId", child).put("waitingForDebugger", true))

    @Test fun pausedWorkerAttachmentAndResumeReplyReachInspector() {
        val router = CefriumInspectorSessions()
        val attached = router.incoming(attach("page", "worker"), "page")!!
        assertFalse(attached.has("sessionId"))
        assertTrue(attached.getJSONObject("params").getBoolean("waitingForDebugger"))
        val resume = router.outgoing(JSONObject().put("id", 5)
            .put("sessionId", "worker").put("method", "Runtime.runIfWaitingForDebugger"), "page")!!
        assertEquals("worker", resume.getString("sessionId"))
        val reply = router.incoming(JSONObject().put("id", 5).put("sessionId", "worker")
            .put("result", JSONObject()), "page")!!
        assertEquals("worker", reply.getString("sessionId"))
    }

    @Test fun contextsForwardAndNativeMonitorSessionsStayPrivate() {
        val router = CefriumInspectorSessions()
        val event = JSONObject().put("sessionId", "page").put("method", "Runtime.executionContextCreated")
        assertFalse(router.incoming(event, "page")!!.has("sessionId"))
        assertNull(router.incoming(attach("monitor", "private-worker"), "page"))
        assertNull(router.outgoing(JSONObject().put("sessionId", "private-worker"), "page"))
        assertEquals("page", router.outgoing(JSONObject().put("method", "Runtime.enable"), "page")!!.getString("sessionId"))
    }

    @Test fun nestedWorkersDetachAndTargetSwitchDropsOldSessions() {
        val router = CefriumInspectorSessions()
        router.incoming(attach("page", "worker"), "page")
        val nested = router.incoming(attach("worker", "nested"), "page")!!
        assertEquals("worker", nested.getString("sessionId"))
        val detached = JSONObject().put("sessionId", "page").put("method", "Target.detachedFromTarget")
            .put("params", JSONObject().put("sessionId", "worker"))
        assertNotNull(router.incoming(detached, "page"))
        assertNull(router.outgoing(JSONObject().put("sessionId", "nested"), "page"))
        router.incoming(attach("page", "worker2"), "page")
        assertNull(router.incoming(JSONObject().put("sessionId", "worker2"), "new-page"))
        assertNull(router.outgoing(JSONObject(), null))
    }
}
