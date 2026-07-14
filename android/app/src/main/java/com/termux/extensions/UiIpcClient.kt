package com.termux.extensions

import android.os.Process
import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import com.termux.extensions.rpc.JsonRpcNotification
import com.termux.extensions.rpc.RpcResponseMode
import com.termux.extensions.rpc.SocketIoJsonRpcClient
import com.termux.extensions.rpc.SocketIoRpcLane
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.ArrayDeque

/**
 * Owns the Android wrapper's UI IPC lane and its existing TE2 console socket.
 * The console socket is a persistent native log/probe worker and becomes a
 * transcript drawer only while the Tools overlay is visible.
 */
class UiIpcClient(
    private val filter: EditorInputFilter,
    consoleWorkerLabel: String = "android_runtime",
    private val onFilterChanged: ((Boolean) -> Unit)? = null
) {
    companion object {
        private const val TAG = "UiIpcClient"
        private const val DEFAULT_CONSOLE_TAIL_LINES = 500
        private const val UI_IPC_EDITOR_FOCUS = "ui.editor.focus"
        private const val UI_IPC_EDITOR_BLUR = "ui.editor.blur"
        private const val UI_IPC_IME_FOCUS = "ui.ime.focus"
        private const val UI_IPC_IME_BLUR = "ui.ime.blur"
        private const val DEFAULT_CONSOLE_TARGET_WORKER_ID = "main_page"
        private const val MAX_PENDING_CONSOLE_LOGS = 300
    }

    private var rpcClient: SocketIoJsonRpcClient? = null
    private var consoleSocket: Socket? = null
    private var serverBaseUrl: String? = null
    private var consoleDrawerEnabled = false
    private var consoleTailLines = DEFAULT_CONSOLE_TAIL_LINES
    private var activeImeOwner: String? = null
    private val latestRpcNotifications = linkedMapOf<String, JsonRpcNotification>()
    private val pendingConsoleLogs = ArrayDeque<JSONObject>()
    private val consoleWorkerLabel = consoleWorkerLabel.trim().ifBlank { "android_runtime" }
    private val consoleWorkerId = "$consoleWorkerLabel:${Process.myPid()}"

    internal var onRpcNotification: ((JsonRpcNotification) -> Unit)? = null
        set(value) {
            field = value
            if (value != null) {
                latestRpcNotifications.values.forEach(value)
            }
        }

    internal var onRpcConnectionChanged: ((Boolean) -> Unit)? = null
        set(value) {
            field = value
            value?.invoke(isRpcConnected)
        }

    internal val isRpcConnected: Boolean
        get() = rpcClient?.isConnected == true

    /** Callback for console events — receives (eventName, JSONObject) */
    var onConsoleEvent: ((String, JSONObject) -> Unit)? = null

    /** Output-only by default; activities install a bounded native command registry. */
    var onConsoleCommand: ((String, (Result<Any?>) -> Unit) -> Unit)? = null

    /**
     * Connect to the UI IPC Socket.IO namespace.
     * @param baseUrl The configured framework origin (for example http://127.0.0.1:8089)
     */
    fun connect(baseUrl: String) {
        val normalizedBaseUrl = baseUrl.trimEnd('/')
        serverBaseUrl = normalizedBaseUrl
        try {
            rpcClient = SocketIoJsonRpcClient(
                normalizedBaseUrl,
                SocketIoRpcLane(
                    name = "ui_ipc",
                    namespace = "/ui_ipc",
                    path = "/ui_ipc_ws/socket.io",
                    responseMode = RpcResponseMode.ACK,
                ),
                source = "android_native",
            ).apply {
                onConnected = {
                    Log.i(TAG, "Connected to UI IPC at $normalizedBaseUrl")
                    onRpcConnectionChanged?.invoke(true)
                }
                onDisconnected = { reason ->
                    Log.i(TAG, "Disconnected from UI IPC ($reason) — deactivating filter")
                    setFilterActive(false)
                    onRpcConnectionChanged?.invoke(false)
                }
                onConnectError = { error ->
                    Log.w(TAG, "Connect error: $error")
                }
                onNotification = { notification ->
                    try {
                        latestRpcNotifications[notification.method] = notification
                        handleUiIpcNotification(notification)
                        onRpcNotification?.invoke(notification)
                    } catch (error: Exception) {
                        Log.w(TAG, "Error processing UI IPC RPC notification", error)
                    }
                }
                connect()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create Socket.IO client", e)
        }
        ensureConsoleSocketConnected()
    }

    private fun createConsoleSocket(): Socket? {
        consoleSocket?.let { return it }
        val baseUrl = serverBaseUrl ?: return null
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
            val uri = URI.create("$baseUrl/te2_console")
            val socket = IO.socket(uri, opts)
            consoleSocket = socket
            socket.apply {
                on(Socket.EVENT_CONNECT) {
                    Log.i(TAG, "Connected to TE2 console at $baseUrl")
                    registerAsWorker(socket)
                    flushPendingConsoleLogs(socket)
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
                on("console:eval") { args ->
                    parseJsonArg(args.firstOrNull())?.let { handleConsoleEval(socket, it) }
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

    private fun handleUiIpcNotification(notification: JsonRpcNotification) {
        when (notification.method) {
            UI_IPC_EDITOR_FOCUS -> {
                handleImeFocus("editor")
            }
            UI_IPC_EDITOR_BLUR -> {
                handleImeBlur("editor")
            }
            UI_IPC_IME_FOCUS -> {
                handleImeFocus(notification.params["source"]?.toString()?.trim().orEmpty().ifEmpty { "ime" })
            }
            UI_IPC_IME_BLUR -> {
                handleImeBlur(notification.params["source"]?.toString()?.trim().orEmpty().ifEmpty { "ime" })
            }
        }
    }

    /** Publish one native runtime entry through the existing TE2 console lane. */
    fun publishConsoleLog(level: String, text: String) {
        val payload = JSONObject().apply {
            put("workerId", consoleWorkerId)
            put("workerLabel", consoleWorkerLabel)
            put("level", level)
            put("ts", System.currentTimeMillis())
            put("args", JSONArray().put(text))
        }
        val socket = consoleSocket
        if (socket?.connected() == true) {
            socket.emit("console:log", payload)
        } else {
            synchronized(pendingConsoleLogs) {
                while (pendingConsoleLogs.size >= MAX_PENDING_CONSOLE_LOGS) {
                    pendingConsoleLogs.removeFirst()
                }
                pendingConsoleLogs.addLast(payload)
            }
        }
        if (consoleDrawerEnabled) {
            onConsoleEvent?.invoke("console:log", payload)
        }
    }

    fun request(
        method: String,
        params: Map<String, Any?> = emptyMap(),
        timeoutMs: Long = 8_000,
        callback: (Result<Any?>) -> Unit,
    ) {
        rpcClient?.request(method, params, timeoutMs, callback)
            ?: callback(Result.failure(IllegalStateException("UI IPC is unavailable")))
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

    private fun registerAsWorker(socket: Socket) {
        socket.emit(
            "console:register",
            JSONObject().apply {
                put("role", "worker")
                put("workerId", consoleWorkerId)
                put("workerLabel", consoleWorkerLabel)
            },
        )
    }

    private fun flushPendingConsoleLogs(socket: Socket) {
        val queued = synchronized(pendingConsoleLogs) {
            buildList {
                while (pendingConsoleLogs.isNotEmpty()) add(pendingConsoleLogs.removeFirst())
            }
        }
        queued.forEach { socket.emit("console:log", it) }
    }

    private fun handleConsoleEval(socket: Socket, payload: JSONObject) {
        val reqId = payload.optString("reqId").trim()
        if (reqId.isEmpty()) return
        val code = payload.optString("code").trim()
        val commandHandler = onConsoleCommand
        if (commandHandler == null) {
            emitConsoleEvalResult(
                socket,
                reqId,
                Result.failure(IllegalStateException("Native console commands are unavailable")),
            )
            return
        }
        try {
            commandHandler(code) { result -> emitConsoleEvalResult(socket, reqId, result) }
        } catch (error: Exception) {
            emitConsoleEvalResult(socket, reqId, Result.failure(error))
        }
    }

    private fun emitConsoleEvalResult(socket: Socket, reqId: String, result: Result<Any?>) {
        val payload = JSONObject().apply {
            put("workerId", consoleWorkerId)
            put("reqId", reqId)
            result.fold(
                onSuccess = { value ->
                    put("ok", true)
                    put("value", consoleJsonValue(value))
                },
                onFailure = { error ->
                    put("ok", false)
                    put(
                        "error",
                        JSONObject().apply {
                            put("name", error.javaClass.simpleName)
                            put("message", error.message ?: "Native console command failed")
                        },
                    )
                },
            )
        }
        socket.emit("console:evalResult", payload)
    }

    fun setConsoleDrawerEnabled(enabled: Boolean, tailLines: Int = DEFAULT_CONSOLE_TAIL_LINES) {
        consoleDrawerEnabled = enabled
        if (tailLines > 0) {
            consoleTailLines = tailLines
        }
        if (enabled) {
            ensureConsoleSocketConnected()?.let { socket ->
                if (socket.connected()) {
                    registerAsDrawer(socket)
                }
            }
        } else {
            unregisterAsDrawer()
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

    private fun consoleJsonValue(value: Any?): Any = when (value) {
        null -> JSONObject.NULL
        is JSONObject, is JSONArray, is String, is Number, is Boolean -> value
        is Map<*, *> -> JSONObject().apply {
            value.forEach { (key, item) ->
                if (key is String) put(key, consoleJsonValue(item))
            }
        }
        is Iterable<*> -> JSONArray().apply {
            value.forEach { put(consoleJsonValue(it)) }
        }
        is Array<*> -> JSONArray().apply {
            value.forEach { put(consoleJsonValue(it)) }
        }
        is ByteArray -> JSONArray().apply {
            value.forEach { put(it.toInt() and 0xff) }
        }
        else -> value.toString()
    }

    private fun setFilterActive(active: Boolean) {
        filter.isActive = active
        onFilterChanged?.invoke(active)
    }

    fun disconnect() {
        try {
            rpcClient?.disconnect()
            rpcClient = null
            onRpcConnectionChanged?.invoke(false)
            disconnectConsoleSocket()
            synchronized(pendingConsoleLogs) { pendingConsoleLogs.clear() }
            activeImeOwner = null
            latestRpcNotifications.clear()
            filter.isActive = false
        } catch (e: Exception) {
            Log.w(TAG, "Error disconnecting", e)
        }
    }
}
