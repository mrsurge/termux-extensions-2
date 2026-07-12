package com.termux.extensions

import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URI

/**
 * Socket.IO client that connects to the editor's UI IPC bus and listens for
 * typed UI IPC RPC notifications to toggle the EditorInputFilter.
 */
class UiIpcClient(
    private val filter: EditorInputFilter,
    private val onFilterChanged: ((Boolean) -> Unit)? = null
) {
    companion object {
        private const val TAG = "UiIpcClient"
        private const val DEFAULT_CONSOLE_TAIL_LINES = 500
        private const val UI_IPC_RPC_NOTIFICATION_EVENT = "rpc.notify"
        private const val UI_IPC_EDITOR_FOCUS = "ui.editor.focus"
        private const val UI_IPC_EDITOR_BLUR = "ui.editor.blur"
        private const val UI_IPC_IME_FOCUS = "ui.ime.focus"
        private const val UI_IPC_IME_BLUR = "ui.ime.blur"
        private const val DEFAULT_CONSOLE_TARGET_WORKER_ID = "main_page"
    }

    private var uiIpcSocket: Socket? = null
    private var consoleSocket: Socket? = null
    private var serverPort: Int? = null
    private var consoleDrawerEnabled = false
    private var consoleTailLines = DEFAULT_CONSOLE_TAIL_LINES
    private var activeImeOwner: String? = null

    /** Callback for console events — receives (eventName, JSONObject) */
    var onConsoleEvent: ((String, JSONObject) -> Unit)? = null

    /**
     * Connect to the UI IPC Socket.IO namespace.
     * @param port The server port (e.g. 8089)
     */
    fun connect(port: Int) {
        serverPort = port
        try {
            val opts = IO.Options().apply {
                path = "/ui_ipc_ws/socket.io"
                transports = arrayOf("websocket")
                upgrade = false
                query = "app_id=file_editor_cm6&source=android_native"
                reconnection = true
                reconnectionDelay = 2000
                reconnectionDelayMax = 10000
                forceNew = true
                multiplex = false
            }
            val uri = URI.create("http://127.0.0.1:$port/ui_ipc")
            uiIpcSocket = IO.socket(uri, opts).apply {
                on(Socket.EVENT_CONNECT) {
                    Log.i(TAG, "Connected to UI IPC on port $port")
                }
                on(Socket.EVENT_DISCONNECT) {
                    Log.i(TAG, "Disconnected from UI IPC — deactivating filter")
                    setFilterActive(false)
                }
                on(Socket.EVENT_CONNECT_ERROR) { args ->
                    Log.w(TAG, "Connect error: ${args.firstOrNull()}")
                }
                on(UI_IPC_RPC_NOTIFICATION_EVENT) { args ->
                    try {
                        val json = parseJsonArg(args.firstOrNull()) ?: return@on
                        handleUiIpcNotification(json)
                    } catch (e: Exception) {
                        Log.w(TAG, "Error processing UI IPC RPC notification", e)
                    }
                }
                connect()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create Socket.IO client", e)
        }
    }

    private fun createConsoleSocket(): Socket? {
        consoleSocket?.let { return it }
        val port = serverPort ?: return null
        try {
            val opts = IO.Options().apply {
                path = "/te2_console_ws/socket.io"
                transports = arrayOf("websocket")
                upgrade = false
                query = "app_id=file_editor_cm6&source=android_console"
                reconnection = true
                reconnectionDelay = 2000
                reconnectionDelayMax = 10000
                forceNew = true
                multiplex = false
            }
            val uri = URI.create("http://127.0.0.1:$port/te2_console")
            val socket = IO.socket(uri, opts)
            consoleSocket = socket
            socket.apply {
                on(Socket.EVENT_CONNECT) {
                    Log.i(TAG, "Connected to TE2 console on port $port")
                    if (consoleDrawerEnabled) {
                        registerAsDrawer(socket)
                    }
                }
                on(Socket.EVENT_DISCONNECT) {
                    Log.i(TAG, "Disconnected from TE2 console")
                }
                on(Socket.EVENT_CONNECT_ERROR) { args ->
                    Log.w(TAG, "TE2 console connect error: ${args.firstOrNull()}")
                }
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
                on("console:cleared") { args ->
                    val json = parseJsonArg(args.firstOrNull()) ?: JSONObject()
                    onConsoleEvent?.invoke("console:cleared", json)
                }
            }
            return socket
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create TE2 console socket", e)
            return null
        }
    }

    private fun ensureConsoleSocketConnected(): Socket? {
        val socket = createConsoleSocket() ?: return null
        if (!socket.connected()) {
            socket.connect()
        }
        return socket
    }

    private fun handleUiIpcNotification(json: JSONObject) {
        if (json.optString("jsonrpc", "") != "2.0") return
        when (json.optString("method", "")) {
            UI_IPC_EDITOR_FOCUS -> {
                handleImeFocus("editor")
            }
            UI_IPC_EDITOR_BLUR -> {
                handleImeBlur("editor")
            }
            UI_IPC_IME_FOCUS -> {
                handleImeFocus(notificationSource(json, "ime"))
            }
            UI_IPC_IME_BLUR -> {
                handleImeBlur(notificationSource(json, "ime"))
            }
        }
    }

    private fun notificationSource(json: JSONObject, fallback: String): String {
        val params = json.optJSONObject("params")
        val raw = params?.optString("source", "")?.trim().orEmpty()
        return raw.ifEmpty { fallback }
    }

    private fun handleImeFocus(owner: String) {
        activeImeOwner = owner
        Log.d(TAG, "IME focus via UI RPC ($owner) — activating filter")
        setFilterActive(true)
    }

    private fun handleImeBlur(owner: String) {
        if (activeImeOwner != null && activeImeOwner != owner) {
            Log.d(TAG, "Ignoring stale IME blur from $owner; active owner is $activeImeOwner")
            return
        }
        activeImeOwner = null
        Log.d(TAG, "IME blur via UI RPC ($owner) — deactivating filter")
        setFilterActive(false)
    }

    /** Register this client as a console drawer to receive log broadcasts. */
    private fun registerAsDrawer(socket: Socket? = consoleSocket) {
        try {
            val payload = JSONObject().apply {
                put("role", "drawer")
                put("tail_lines", consoleTailLines)
            }
            socket?.emit("console:register", payload)
            Log.d(TAG, "Registered as console drawer")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to register as drawer", e)
        }
    }

    fun setConsoleDrawerEnabled(enabled: Boolean, tailLines: Int = DEFAULT_CONSOLE_TAIL_LINES) {
        consoleDrawerEnabled = enabled
        if (tailLines > 0) {
            consoleTailLines = tailLines
        }
        if (enabled) {
            disconnectConsoleSocket()
            createConsoleSocket()?.let { socket ->
                if (socket.connected()) {
                    registerAsDrawer(socket)
                } else {
                    socket.connect()
                }
            }
        } else {
            unregisterAsDrawer()
            disconnectConsoleSocket()
        }
    }

    private fun unregisterAsDrawer() {
        try {
            val payload = JSONObject().apply {
                put("role", "drawer")
            }
            consoleSocket?.emit("console:unregister", payload)
            Log.d(TAG, "Unregistered as console drawer")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to unregister drawer", e)
        }
    }

    private fun disconnectConsoleSocket() {
        try {
            consoleSocket?.disconnect()
            consoleSocket?.off()
            consoleSocket = null
        } catch (e: Exception) {
            Log.w(TAG, "Error disconnecting TE2 console socket", e)
        }
    }

    /** Send a console eval request to a specific worker. */
    fun sendConsoleEval(code: String, targetWorkerId: String = DEFAULT_CONSOLE_TARGET_WORKER_ID) {
        try {
            val payload = JSONObject().apply {
                put("targetWorkerId", targetWorkerId)
                put("reqId", java.util.UUID.randomUUID().toString())
                put("code", code)
            }
            ensureConsoleSocketConnected()?.emit("console:eval", payload)
            Log.d(TAG, "Sent console:eval to $targetWorkerId")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to send console:eval", e)
        }
    }

    /** Request backend transcript truncation for the TE2 console. */
    fun sendConsoleClear() {
        try {
            ensureConsoleSocketConnected()?.emit("console:clear", JSONObject())
            Log.d(TAG, "Sent console:clear")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to send console:clear", e)
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
            uiIpcSocket?.disconnect()
            uiIpcSocket?.off()
            uiIpcSocket = null
            disconnectConsoleSocket()
            activeImeOwner = null
            filter.isActive = false
        } catch (e: Exception) {
            Log.w(TAG, "Error disconnecting", e)
        }
    }
}
