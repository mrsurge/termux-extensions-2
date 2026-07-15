package com.termux.extensions.rpc

import android.os.Handler
import android.os.Looper
import android.util.Log
import io.socket.client.Ack
import io.socket.client.IO
import io.socket.client.Socket
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

internal enum class RpcResponseMode {
    ACK,
    IN_BAND,
}

internal data class SocketIoRpcLane(
    val name: String,
    val namespace: String,
    val path: String,
    val responseMode: RpcResponseMode,
    val notificationEvent: String = "rpc.notify",
)

internal data class JsonRpcNotification(
    val method: String,
    val params: Map<String, Any?>,
)

internal class JsonRpcRemoteException(
    val code: Long,
    message: String,
    val data: Map<String, Any?>?,
) : RuntimeException(message)

/**
 * Socket.IO owns connection/reconnect behavior; this subsystem owns only the
 * strict MessagePack JSON-RPC envelope, correlation, and lane response mode.
 */
internal class SocketIoJsonRpcClient(
    private val baseUrl: String,
    private val lane: SocketIoRpcLane,
    private val source: String,
    private val callbackHandler: Handler = Handler(Looper.getMainLooper()),
) {
    companion object {
        private const val TAG = "SocketIoJsonRpc"
        private const val RPC_EVENT = "rpc"
        private const val RPC_CODEC = "msgpack-v1"
    }

    private data class PendingRequest(
        val method: String,
        val callback: (Result<Any?>) -> Unit,
        val timeout: Runnable,
    )

    private val nextId = AtomicLong(1)
    private val pending = ConcurrentHashMap<String, PendingRequest>()
    private var socket: Socket? = null

    var onConnected: (() -> Unit)? = null
    var onDisconnected: ((String?) -> Unit)? = null
    var onConnectError: ((Any?) -> Unit)? = null
    var onNotification: ((JsonRpcNotification) -> Unit)? = null

    val isConnected: Boolean
        get() = socket?.connected() == true

    val socketId: String?
        get() = socket?.takeIf { it.connected() }?.id()

    fun connect() {
        if (socket != null) return
        val normalizedBaseUrl = baseUrl.trimEnd('/')
        val options = IO.Options().apply {
            path = lane.path
            transports = arrayOf("websocket")
            upgrade = false
            query = "app_id=file_editor_cm6&source=$source"
            auth = mapOf("rpcCodec" to RPC_CODEC)
            reconnection = true
            reconnectionDelay = 1000
            reconnectionDelayMax = 8000
            forceNew = true
            multiplex = false
        }
        val nextSocket = IO.socket(URI.create(normalizedBaseUrl + lane.namespace), options)
        socket = nextSocket
        nextSocket.on(Socket.EVENT_CONNECT) {
            Log.i(TAG, "${lane.name} connected namespace=${lane.namespace} path=${lane.path}")
            postCallback("connected") { onConnected?.invoke() }
        }
        nextSocket.on(Socket.EVENT_DISCONNECT) { args ->
            val reason = args.firstOrNull()?.toString()
            Log.i(TAG, "${lane.name} disconnected reason=${reason ?: "unknown"}")
            failPending(
                IllegalStateException("${lane.name} RPC disconnected: ${reason ?: "unknown"}"),
                "disconnected",
            )
            postCallback("disconnected") { onDisconnected?.invoke(reason) }
        }
        nextSocket.on(Socket.EVENT_CONNECT_ERROR) { args ->
            val error = args.firstOrNull()
            Log.w(TAG, "${lane.name} connection error: $error")
            postCallback("connect_error") { onConnectError?.invoke(error) }
        }
        if (lane.responseMode == RpcResponseMode.IN_BAND) {
            nextSocket.on(RPC_EVENT) { args -> handleWirePayload(RPC_EVENT, args.firstOrNull()) }
        }
        if (lane.notificationEvent != RPC_EVENT) {
            nextSocket.on(lane.notificationEvent) { args ->
                handleWirePayload(lane.notificationEvent, args.firstOrNull())
            }
        }
        nextSocket.connect()
    }

    fun ensureConnected() {
        try {
            val activeSocket = socket
            if (activeSocket == null) {
                connect()
            } else if (!activeSocket.connected()) {
                Log.i(TAG, "${lane.name} foreground reconnect requested")
                activeSocket.connect()
            }
        } catch (error: Exception) {
            Log.w(
                TAG,
                "${lane.name} foreground reconnect failed: " +
                    "${error.javaClass.simpleName}: ${error.message ?: "connect failed"}",
            )
        }
    }

    fun request(
        method: String,
        params: Map<String, Any?> = emptyMap(),
        timeoutMs: Long = 8_000,
        callback: (Result<Any?>) -> Unit,
    ) {
        val activeSocket = socket
        if (activeSocket?.connected() != true) {
            val error = IllegalStateException("${lane.name} RPC is not connected")
            Log.w(TAG, rpcFailureMessage(lane.name, method, null, "not_connected", error))
            postCallback("request method=$method") { callback(Result.failure(error)) }
            return
        }
        val id = "android_${lane.name}_${nextId.getAndIncrement()}_${System.currentTimeMillis()}"
        val envelope = mapOf(
            "jsonrpc" to "2.0",
            "id" to id,
            "method" to method,
            "params" to params,
        )
        Log.d(TAG, "${lane.name} request method=$method id=$id")
        val timeout = Runnable {
            val entry = pending.remove(id) ?: return@Runnable
            val error = IllegalStateException("RPC request timeout: $method")
            Log.w(TAG, rpcFailureMessage(lane.name, entry.method, id, "timeout", error))
            invokeRequestCallback(id, entry, Result.failure(error))
        }
        pending[id] = PendingRequest(method, callback, timeout)
        callbackHandler.postDelayed(timeout, timeoutMs.coerceAtLeast(500))
        try {
            val wire = MessagePackRpcCodec.encode(envelope)
            if (lane.responseMode == RpcResponseMode.ACK) {
                activeSocket.emit(RPC_EVENT, wire, Ack { args ->
                    handleWirePayload("$RPC_EVENT.ack", args.firstOrNull())
                })
            } else {
                activeSocket.emit(RPC_EVENT, wire)
            }
        } catch (error: Exception) {
            completePending(id, Result.failure(error), "encode_or_emit")
        }
    }

    fun notify(method: String, params: Map<String, Any?> = emptyMap()): Boolean {
        val activeSocket = socket
        if (activeSocket?.connected() != true) {
            Log.w(
                TAG,
                rpcFailureMessage(
                    lane.name,
                    method,
                    null,
                    "notify_not_connected",
                    IllegalStateException("${lane.name} RPC is not connected"),
                ),
            )
            return false
        }
        return try {
            activeSocket.emit(
                RPC_EVENT,
                MessagePackRpcCodec.encode(
                    mapOf("jsonrpc" to "2.0", "method" to method, "params" to params),
                ),
            )
            true
        } catch (error: Exception) {
            Log.w(TAG, "Failed to notify ${lane.name} method=$method", error)
            false
        }
    }

    fun disconnect() {
        failPending(IllegalStateException("${lane.name} RPC closed"), "closed")
        socket?.disconnect()
        socket?.off()
        socket = null
    }

    fun debugSnapshot(): Map<String, Any?> = mapOf(
        "lane" to lane.name,
        "namespace" to lane.namespace,
        "path" to lane.path,
        "connected" to isConnected,
        "socketId" to socketId,
        "responseMode" to lane.responseMode.name.lowercase(),
        "pendingCount" to pending.size,
        "pendingMethods" to pending.values.map { it.method }.distinct().sorted(),
    )

    private fun handleWirePayload(event: String, payload: Any?) {
        try {
            val decoded = MessagePackRpcCodec.decode(payload)
            if (decoded is List<*>) {
                decoded.forEachIndexed { index, envelope -> handleEnvelope(envelope, "$event[$index]") }
            } else {
                handleEnvelope(decoded, event)
            }
        } catch (error: Exception) {
            Log.w(
                TAG,
                "${lane.name} RPC protocol failure event=$event ${rpcPayloadSummary(payload)} " +
                    "error=${error.javaClass.simpleName}: ${error.message ?: "decode failed"}",
            )
        }
    }

    private fun handleEnvelope(value: Any?, event: String) {
        val envelope = value.asStringMap()
        if (envelope == null) {
            Log.w(TAG, "${lane.name} RPC invalid envelope event=$event ${rpcPayloadSummary(value)}")
            return
        }
        if (envelope["jsonrpc"] != "2.0") {
            Log.w(
                TAG,
                "${lane.name} RPC invalid version event=$event jsonrpc=${envelope["jsonrpc"]}",
            )
            return
        }
        val method = envelope["method"] as? String
        if (method != null && !envelope.containsKey("id")) {
            val notification = JsonRpcNotification(
                method,
                envelope["params"].asStringMap() ?: emptyMap(),
            )
            postCallback("notification event=$event method=$method") {
                onNotification?.invoke(notification)
            }
            return
        }
        if (method != null) {
            Log.w(TAG, "${lane.name} RPC unsupported server request event=$event method=$method")
            return
        }
        val id = envelope["id"]?.toString()
        if (id == null) {
            Log.w(TAG, "${lane.name} RPC response missing id event=$event")
            return
        }
        val error = envelope["error"].asStringMap()
        if (error != null) {
            val code = (error["code"] as? Number)?.toLong() ?: -32_000
            val message = error["message"]?.toString() ?: "RPC request failed"
            if (!completePending(
                id,
                Result.failure(JsonRpcRemoteException(code, message, error["data"].asStringMap())),
                "remote_error",
            )) {
                Log.w(TAG, "${lane.name} RPC orphan remote error id=$id code=$code message=$message")
            }
            return
        }
        if (envelope.containsKey("result")) {
            if (!completePending(id, Result.success(envelope["result"]))) {
                Log.w(TAG, "${lane.name} RPC orphan response id=$id event=$event")
            }
            return
        }
        Log.w(TAG, "${lane.name} RPC response missing result/error id=$id event=$event")
    }

    private fun completePending(
        id: String,
        result: Result<Any?>,
        failureKind: String = "response",
    ): Boolean {
        val entry = pending.remove(id) ?: return false
        callbackHandler.removeCallbacks(entry.timeout)
        Log.d(
            TAG,
            "${lane.name} response method=${entry.method} id=$id ok=${result.isSuccess}",
        )
        result.exceptionOrNull()?.let { error ->
            Log.w(TAG, rpcFailureMessage(lane.name, entry.method, id, failureKind, error))
        }
        invokeRequestCallback(id, entry, result)
        return true
    }

    private fun failPending(error: Exception, failureKind: String) {
        val entries = pending.entries.toList()
        pending.clear()
        entries.forEach { (id, entry) ->
            callbackHandler.removeCallbacks(entry.timeout)
            Log.w(TAG, rpcFailureMessage(lane.name, entry.method, id, failureKind, error))
            invokeRequestCallback(id, entry, Result.failure(error))
        }
    }

    private fun invokeRequestCallback(
        id: String,
        entry: PendingRequest,
        result: Result<Any?>,
    ) {
        postCallback("request callback method=${entry.method} id=$id") {
            entry.callback(result)
        }
    }

    private fun postCallback(context: String, callback: () -> Unit) {
        val accepted = callbackHandler.post {
            try {
                callback()
            } catch (error: Exception) {
                Log.e(
                    TAG,
                    "${lane.name} RPC callback failure context=$context " +
                        "error=${error.javaClass.simpleName}: ${error.message ?: "callback failed"}",
                    error,
                )
            }
        }
        if (!accepted) {
            Log.e(TAG, "${lane.name} RPC callback rejected context=$context")
        }
    }
}

@Suppress("UNCHECKED_CAST")
internal fun Any?.asStringMap(): Map<String, Any?>? {
    if (this !is Map<*, *>) return null
    return entries
        .filter { it.key is String }
        .associate { it.key as String to it.value }
}

internal fun rpcFailureMessage(
    lane: String,
    method: String,
    id: String?,
    kind: String,
    error: Throwable,
): String = buildString {
    append(lane)
    append(" RPC request failed kind=")
    append(kind)
    append(" method=")
    append(method)
    if (id != null) {
        append(" id=")
        append(id)
    }
    if (error is JsonRpcRemoteException) {
        append(" code=")
        append(error.code)
    }
    append(" error=")
    append(error.javaClass.simpleName)
    append(": ")
    append(error.message ?: "request failed")
}

internal fun rpcPayloadSummary(payload: Any?): String = when (payload) {
    null -> "payloadType=null"
    is ByteArray -> {
        val prefix = payload.take(16).joinToString("") { byte -> "%02x".format(byte) }
        "payloadType=byte[] bytes=${payload.size} hexPrefix=$prefix"
    }
    is String -> {
        val preview = payload
            .take(120)
            .map { character -> if (character.isISOControl()) ' ' else character }
            .joinToString("")
        "payloadType=java.lang.String chars=${payload.length} preview=$preview"
    }
    else -> "payloadType=${payload.javaClass.name} value=${payload.toString().take(120)}"
}
