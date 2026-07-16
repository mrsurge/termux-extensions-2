package com.termux.extensions.rpc

import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class SocketIoJsonRpcDiagnosticsTest {
    @Test
    fun selectsDirectSocketIoBinaryPayload() {
        val payload = byteArrayOf(1, 2, 3)

        assertSame(payload, socketIoInboundPayload("rpc.notify", arrayOf(payload)))
    }

    @Test
    fun skipsEventNameRepeatedByBufferedSocketIoReplay() {
        val payload = byteArrayOf(1, 2, 3)

        assertSame(
            payload,
            socketIoInboundPayload("rpc.notify", arrayOf("rpc.notify", payload)),
        )
    }

    @Test
    fun remoteFailureIncludesLaneMethodIdCodeAndMessage() {
        val message = rpcFailureMessage(
            lane = "editor",
            method = "editor.mirror.publish",
            id = "request-7",
            kind = "remote_error",
            error = JsonRpcRemoteException(-32_001, "stale generation", null),
        )

        assertTrue(message.contains("editor"))
        assertTrue(message.contains("editor.mirror.publish"))
        assertTrue(message.contains("request-7"))
        assertTrue(message.contains("-32001"))
        assertTrue(message.contains("stale generation"))
    }

    @Test
    fun stringPayloadSummaryIsBoundedAndIdentifiesTransportType() {
        val summary = rpcPayloadSummary("x".repeat(500))

        assertTrue(summary.contains("payloadType=java.lang.String"))
        assertTrue(summary.contains("chars=500"))
        assertFalse(summary.contains("x".repeat(121)))
    }
}
