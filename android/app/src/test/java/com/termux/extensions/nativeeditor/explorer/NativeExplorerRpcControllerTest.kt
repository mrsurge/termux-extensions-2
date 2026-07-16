package com.termux.extensions.nativeeditor.explorer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeExplorerRpcControllerTest {
    @Test
    fun expandingDirectoryUsesProjectionNotificationsWithoutPendingRequests() {
        val transport = RecordingExplorerTransport()
        val errors = mutableListOf<String>()
        val controller = NativeExplorerRpcController(
            transport = transport,
            onOpenFile = {},
            onError = errors::add,
        )

        controller.toggleDirectory("src")

        assertEquals(
            listOf("explorer.list", "explorer.openDirs.set"),
            transport.notifications.map { it.first },
        )
        assertEquals(mapOf("rel" to "src"), transport.notifications[0].second)
        assertEquals(listOf("src"), transport.notifications[1].second["dirs"])
        assertTrue(transport.requests.isEmpty())
        assertTrue("src" in controller.state.value.expandedDirectories)
        assertTrue(errors.isEmpty())
    }

    private class RecordingExplorerTransport : NativeExplorerRpcTransport {
        override val isConnected = true
        val notifications = mutableListOf<Pair<String, Map<String, Any?>>>()
        val requests = mutableListOf<Pair<String, Map<String, Any?>>>()

        override fun notify(method: String, params: Map<String, Any?>): Boolean {
            notifications += method to params
            return true
        }

        override fun request(
            method: String,
            params: Map<String, Any?>,
            callback: (Result<Any?>) -> Unit,
        ) {
            requests += method to params
        }
    }
}
