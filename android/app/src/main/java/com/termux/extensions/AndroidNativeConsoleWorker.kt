package com.termux.extensions

import android.content.Context
import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URI
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

internal const val ANDROID_ASSET_FORCE_UPDATE_METHOD =
    "android.assets.forceUpdateAndReload"
internal const val ANDROID_DEVTOOLS_STATE_GET_METHOD =
    "android.devTools.state.get"
internal const val ANDROID_DEVTOOLS_TELEMETRY_CLEAR_METHOD =
    "android.devTools.telemetry.clear"

internal enum class AndroidNativeConsoleCommand {
    FORCE_UPDATE_AND_RELOAD,
    DEVTOOLS_STATE_GET,
    DEVTOOLS_TELEMETRY_CLEAR,
}

internal fun parseAndroidNativeConsoleCommand(code: String): AndroidNativeConsoleCommand {
    val payload = try {
        JSONObject(code)
    } catch (error: Exception) {
        throw IllegalArgumentException("native console commands must be JSON objects", error)
    }
    require(payload.optString("jsonrpc") == "2.0") {
        "native console command requires jsonrpc 2.0"
    }
    val params = payload.opt("params")
    require(params == null || params == JSONObject.NULL || params is JSONObject) {
        "native console command params must be an object"
    }
    return when (payload.optString("method")) {
        ANDROID_ASSET_FORCE_UPDATE_METHOD ->
            AndroidNativeConsoleCommand.FORCE_UPDATE_AND_RELOAD
        ANDROID_DEVTOOLS_STATE_GET_METHOD ->
            AndroidNativeConsoleCommand.DEVTOOLS_STATE_GET
        ANDROID_DEVTOOLS_TELEMETRY_CLEAR_METHOD ->
            AndroidNativeConsoleCommand.DEVTOOLS_TELEMETRY_CLEAR
        else -> throw IllegalArgumentException("unsupported native console command")
    }
}

internal fun androidNativeConsoleWorkerId(context: Context, renderer: String): String {
    require(renderer.matches(Regex("[a-z0-9_-]+"))) { "invalid renderer name" }
    val preferences = context.getSharedPreferences(
        "android_native_console",
        Context.MODE_PRIVATE,
    )
    val installationId = preferences.getString("installation_id", null)
        ?.takeIf { it.matches(Regex("[a-f0-9]{12}")) }
        ?: UUID.randomUUID().toString().replace("-", "").take(12).also {
            preferences.edit().putString("installation_id", it).apply()
        }
    return "android:$renderer:$installationId"
}

/**
 * Registers the Android runtime as an allowlisted TE2 console worker.
 *
 * The protocol reuses console request correlation, but `code` must contain a
 * supported JSON command. Arbitrary Kotlin or JavaScript evaluation is never
 * attempted.
 */
internal class AndroidNativeConsoleWorker(
    private val workerId: String,
    private val workerLabel: String,
    private val commandHandler: (
        AndroidNativeConsoleCommand,
        (Result<JSONObject>) -> Unit,
    ) -> Unit,
) {
    private var socket: Socket? = null
    private var serverBaseUrl: String? = null

    @Synchronized
    fun connect(baseUrl: String) {
        val normalizedBaseUrl = baseUrl.trimEnd('/')
        val current = socket
        if (serverBaseUrl == normalizedBaseUrl && current != null) {
            if (!current.connected()) current.connect()
            return
        }
        disconnect()
        serverBaseUrl = normalizedBaseUrl
        try {
            val options = IO.Options().apply {
                path = "/te2_console_ws/socket.io"
                transports = arrayOf("websocket")
                upgrade = false
                query = "app_id=code_te2&source=android_native_debug"
                reconnection = true
                reconnectionDelay = 2_000
                reconnectionDelayMax = 10_000
                forceNew = true
                multiplex = false
            }
            val nativeSocket = IO.socket(
                URI.create("$normalizedBaseUrl/te2_console"),
                options,
            )
            socket = nativeSocket
            nativeSocket.on(Socket.EVENT_CONNECT) {
                nativeSocket.emit(
                    "console:register",
                    JSONObject().apply {
                        put("workerId", workerId)
                        put("workerLabel", workerLabel)
                        put("role", "worker")
                    },
                )
                Log.i(TAG, "Registered native console worker $workerId")
            }
            nativeSocket.on(Socket.EVENT_DISCONNECT) {
                Log.i(TAG, "Native console worker disconnected")
            }
            nativeSocket.on(Socket.EVENT_CONNECT_ERROR) { args ->
                Log.w(TAG, "Native console worker connect error: ${args.firstOrNull()}")
            }
            nativeSocket.on("console:eval") { args ->
                handleEval(nativeSocket, args.firstOrNull())
            }
            nativeSocket.connect()
        } catch (error: Exception) {
            Log.e(TAG, "Failed to create native console worker", error)
        }
    }

    private fun handleEval(nativeSocket: Socket, rawPayload: Any?) {
        val payload = parseJsonArg(rawPayload) ?: return
        val reqId = payload.optString("reqId").trim()
        if (reqId.isEmpty()) return
        val targetWorkerId = payload.optString("targetWorkerId").trim()
        if (targetWorkerId.isNotEmpty() && targetWorkerId != workerId) return

        val command = try {
            parseAndroidNativeConsoleCommand(payload.optString("code"))
        } catch (error: Exception) {
            emitResult(nativeSocket, reqId, Result.failure(error))
            return
        }

        val completed = AtomicBoolean(false)
        try {
            commandHandler(command) { result ->
                if (completed.compareAndSet(false, true)) {
                    emitResult(nativeSocket, reqId, result)
                }
            }
        } catch (error: Exception) {
            if (completed.compareAndSet(false, true)) {
                emitResult(nativeSocket, reqId, Result.failure(error))
            }
        }
    }

    private fun emitResult(
        nativeSocket: Socket,
        reqId: String,
        result: Result<JSONObject>,
    ) {
        val payload = JSONObject().apply {
            put("workerId", workerId)
            put("reqId", reqId)
            result.fold(
                onSuccess = { value ->
                    put("ok", true)
                    put("value", value)
                },
                onFailure = { error ->
                    put("ok", false)
                    put(
                        "error",
                        JSONObject().apply {
                            put("name", error::class.java.simpleName)
                            put("message", error.message ?: "Native command failed")
                        },
                    )
                },
            )
        }
        nativeSocket.emit("console:evalResult", payload)
    }

    private fun parseJsonArg(value: Any?): JSONObject? = when (value) {
        is JSONObject -> value
        is String -> try {
            JSONObject(value)
        } catch (_: Exception) {
            null
        }
        else -> null
    }

    @Synchronized
    fun disconnect() {
        try {
            socket?.disconnect()
            socket?.off()
        } catch (error: Exception) {
            Log.w(TAG, "Failed to disconnect native console worker", error)
        } finally {
            socket = null
            serverBaseUrl = null
        }
    }

    companion object {
        private const val TAG = "AndroidNativeConsole"
    }
}
