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
            callbackHandler.post { onConnected?.invoke() }
        }
        nextSocket.on(Socket.EVENT_DISCONNECT) { args ->
            val reason = args.firstOrNull()?.toString()
            Log.i(TAG, "${lane.name} disconnected reason=${reason ?: "unknown"}")
            failPending(IllegalStateException("${lane.name} RPC disconnected: ${reason ?: "unknown"}"))
            callbackHandler.post { onDisconnected?.invoke(reason) }
        }
        nextSocket.on(Socket.EVENT_CONNECT_ERROR) { args ->
            val error = args.firstOrNull()
            Log.w(TAG, "${lane.name} connection error: $error")
            callbackHandler.post { onConnectError?.invoke(error) }
        }
        if (lane.responseMode == RpcResponseMode.IN_BAND) {
            nextSocket.on(RPC_EVENT) { args -> handleWirePayload(args.firstOrNull()) }
        }
        if (lane.notificationEvent != RPC_EVENT) {
            nextSocket.on(lane.notificationEvent) { args -> handleWirePayload(args.firstOrNull()) }
        }
        nextSocket.connect()
    }

    fun request(
        method: String,
        params: Map<String, Any?> = emptyMap(),
        timeoutMs: Long = 8_000,
        callback: (Result<Any?>) -> Unit,
    ) {
        val activeSocket = socket
        if (activeSocket?.connected() != true) {
            callbackHandler.post {
                callback(Result.failure(IllegalStateException("${lane.name} RPC is not connected")))
            }
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
            entry.callback(Result.failure(IllegalStateException("RPC request timeout: $method")))
        }
        pending[id] = PendingRequest(method, callback, timeout)
        callbackHandler.postDelayed(timeout, timeoutMs.coerceAtLeast(500))
        try {
            val wire = MessagePackRpcCodec.encode(envelope)
            if (lane.responseMode == RpcResponseMode.ACK) {
                activeSocket.emit(RPC_EVENT, wire, Ack { args ->
                    handleWirePayload(args.firstOrNull())
                })
            } else {
                activeSocket.emit(RPC_EVENT, wire)
            }
        } catch (error: Exception) {
            completePending(id, Result.failure(error))
        }
    }

    fun notify(method: String, params: Map<String, Any?> = emptyMap()): Boolean {
        val activeSocket = socket
        if (activeSocket?.connected() != true) return false
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
        failPending(IllegalStateException("${lane.name} RPC closed"))
        socket?.disconnect()
        socket?.off()
        socket = null
    }

    fun debugSnapshot(): Map<String, Any?> = mapOf(
        "lane" to lane.name,
        "namespace" to lane.namespace,
        "path" to lane.path,
        "connected" to isConnected,
        "responseMode" to lane.responseMode.name.lowercase(),
        "pendingCount" to pending.size,
        "pendingMethods" to pending.values.map { it.method }.distinct().sorted(),
    )

    private fun handleWirePayload(payload: Any?) {
        try {
            val decoded = MessagePackRpcCodec.decode(payload)
            if (decoded is List<*>) {
                decoded.forEach(::handleEnvelope)
            } else {
                handleEnvelope(decoded)
            }
        } catch (error: Exception) {
            Log.w(TAG, "Invalid ${lane.name} RPC payload", error)
        }
    }

    private fun handleEnvelope(value: Any?) {
        val envelope = value.asStringMap() ?: return
        if (envelope["jsonrpc"] != "2.0") return
        val method = envelope["method"] as? String
        if (method != null && !envelope.containsKey("id")) {
            val notification = JsonRpcNotification(
                method,
                envelope["params"].asStringMap() ?: emptyMap(),
            )
            callbackHandler.post { onNotification?.invoke(notification) }
            return
        }
        val id = envelope["id"]?.toString() ?: return
        val error = envelope["error"].asStringMap()
        if (error != null) {
            val code = (error["code"] as? Number)?.toLong() ?: -32_000
            val message = error["message"]?.toString() ?: "RPC request failed"
            completePending(
                id,
                Result.failure(JsonRpcRemoteException(code, message, error["data"].asStringMap())),
            )
            return
        }
        if (envelope.containsKey("result")) {
            completePending(id, Result.success(envelope["result"]))
        }
    }

    private fun completePending(id: String, result: Result<Any?>) {
        val entry = pending.remove(id) ?: return
        callbackHandler.removeCallbacks(entry.timeout)
        Log.d(
            TAG,
            "${lane.name} response method=${entry.method} id=$id ok=${result.isSuccess}",
        )
        callbackHandler.post { entry.callback(result) }
    }

    private fun failPending(error: Exception) {
        val entries = pending.entries.toList()
        pending.clear()
        entries.forEach { (_, entry) ->
            callbackHandler.removeCallbacks(entry.timeout)
            callbackHandler.post { entry.callback(Result.failure(error)) }
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
