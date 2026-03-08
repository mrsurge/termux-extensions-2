package com.termux.extensions

import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URI

/**
 * Socket.IO client that connects to the editor's UI IPC bus and listens for
 * focus/blur events to toggle the EditorInputFilter.
 *
 * The editor iframe emits:
 *   { type: "focus" }  on onDidFocusEditorWidget
 *   { type: "blur" }   on onDidBlurEditorWidget
 *
 * These are rebroadcast by the Python server to all /ui_ipc clients.
 */
class UiIpcClient(
    private val filter: EditorInputFilter,
    private val onFilterChanged: ((Boolean) -> Unit)? = null
) {
    private var socket: Socket? = null

    /** Callback for console events — receives (eventName, JSONObject) */
    var onConsoleEvent: ((String, JSONObject) -> Unit)? = null

    /**
     * Connect to the UI IPC Socket.IO namespace.
     * @param port The server port (e.g. 8089)
     */
    fun connect(port: Int) {
        try {
            val opts = IO.Options().apply {
                path = "/ui_ipc_ws/socket.io"
                transports = arrayOf("websocket")
                query = "app_id=file_editor_cm6&source=gecko_native"
                reconnection = true
                reconnectionDelay = 2000
                reconnectionDelayMax = 10000
            }
            val uri = URI.create("http://127.0.0.1:$port/ui_ipc")
            socket = IO.socket(uri, opts).apply {
                on(Socket.EVENT_CONNECT) {
                    Log.i(TAG, "Connected to UI IPC on port $port")
                    registerAsDrawer()
                }
                on(Socket.EVENT_DISCONNECT) {
                    Log.i(TAG, "Disconnected from UI IPC — deactivating filter")
                    setFilterActive(false)
                }
                on(Socket.EVENT_CONNECT_ERROR) { args ->
                    Log.w(TAG, "Connect error: ${args.firstOrNull()}")
                }
                on("ui_event") { args ->
                    try {
                        val json = parseJsonArg(args.firstOrNull()) ?: return@on
                        val type = json.optString("type", "")
                        when (type) {
                            "focus" -> {
                                Log.d(TAG, "Editor focused — activating IME filter")
                                setFilterActive(true)
                            }
                            "blur" -> {
                                Log.d(TAG, "Editor blurred — deactivating IME filter")
                                setFilterActive(false)
                            }
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Error processing ui_event", e)
                    }
                }
                // Console events from the server
                on("console:log") { args ->
                    parseJsonArg(args.firstOrNull())?.let {
                        onConsoleEvent?.invoke("console:log", it)
                    }
                }
                on("console:evalResult") { args ->
                    parseJsonArg(args.firstOrNull())?.let {
                        onConsoleEvent?.invoke("console:evalResult", it)
                    }
                }
                on("console:workers") { args ->
                    try {
                        val data = args.firstOrNull()
                        val workerList = when (data) {
                            is org.json.JSONArray -> data
                            is String -> try { org.json.JSONArray(data) } catch (_: Exception) { null }
                            else -> null
                        }
                        if (workerList != null) {
                            val wrapper = JSONObject().put("workers", workerList)
                            onConsoleEvent?.invoke("console:workers", wrapper)
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Error processing console:workers", e)
                    }
                }
                on("console:clear") { args ->
                    val json = parseJsonArg(args.firstOrNull()) ?: JSONObject()
                    onConsoleEvent?.invoke("console:clear", json)
                }
                connect()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create Socket.IO client", e)
        }
    }

    /** Register this client as a console drawer to receive log broadcasts. */
    private fun registerAsDrawer() {
        try {
            val payload = JSONObject().apply {
                put("role", "drawer")
            }
            socket?.emit("console:register", payload)
            Log.d(TAG, "Registered as console drawer")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to register as drawer", e)
        }
    }

    /** Send a console eval request to a specific worker. */
    fun sendConsoleEval(code: String, targetWorkerId: String = "editor_iframe") {
        try {
            val payload = JSONObject().apply {
                put("targetWorkerId", targetWorkerId)
                put("reqId", java.util.UUID.randomUUID().toString())
                put("code", code)
            }
            socket?.emit("console:eval", payload)
            Log.d(TAG, "Sent console:eval to $targetWorkerId")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to send console:eval", e)
        }
    }

    private fun parseJsonArg(data: Any?): JSONObject? {
        return when (data) {
            is JSONObject -> data
            is String -> try { JSONObject(data) } catch (_: Exception) { null }
            else -> null
        }
    }

    private fun setFilterActive(active: Boolean) {
        filter.isActive = active
        onFilterChanged?.invoke(active)
    }

    fun disconnect() {
        try {
            socket?.disconnect()
            socket?.off()
            socket = null
            filter.isActive = false
        } catch (e: Exception) {
            Log.w(TAG, "Error disconnecting", e)
        }
    }

    companion object {
        private const val TAG = "UiIpcClient"
    }
}
