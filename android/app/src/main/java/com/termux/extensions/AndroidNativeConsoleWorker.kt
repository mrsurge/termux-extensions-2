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

private const val PRIMARY_CLIENT_ROLE = "primary"
private const val SECONDARY_CLIENT_ROLE = "secondary"
private const val PRIMARY_INSTALLATION_ID_KEY = "installation_id"
private const val SECONDARY_INSTALLATION_ID_KEY = "secondary_editor_installation_id"

private fun normalizedAndroidClientRole(role: String): String = when (role) {
    PRIMARY_CLIENT_ROLE, SECONDARY_CLIENT_ROLE -> role
    else -> throw IllegalArgumentException("invalid Android client role")
}

private fun installationIdKey(role: String): String =
    if (normalizedAndroidClientRole(role) == SECONDARY_CLIENT_ROLE) {
        SECONDARY_INSTALLATION_ID_KEY
    } else {
        PRIMARY_INSTALLATION_ID_KEY
    }

internal fun androidInstallationId(
    context: Context,
    role: String = PRIMARY_CLIENT_ROLE,
): String {
    val preferences = context.getSharedPreferences(
        "android_native_console",
        Context.MODE_PRIVATE,
    )
    val key = installationIdKey(role)
    val installationId = preferences.getString(key, null)
        ?.takeIf { it.matches(Regex("[a-f0-9]{12}")) }
        ?: UUID.randomUUID().toString().replace("-", "").take(12).also {
            preferences.edit().putString(key, it).apply()
        }
    return installationId
}

internal fun resetAndroidInstallationId(context: Context): String {
    val primaryInstallationId = UUID.randomUUID().toString().replace("-", "").take(12)
    val secondaryInstallationId = UUID.randomUUID().toString().replace("-", "").take(12)
    context.getSharedPreferences("android_native_console", Context.MODE_PRIVATE)
        .edit()
        .putString(PRIMARY_INSTALLATION_ID_KEY, primaryInstallationId)
        .putString(SECONDARY_INSTALLATION_ID_KEY, secondaryInstallationId)
        .commit()
    return primaryInstallationId
}

internal fun androidClientInstanceId(
    context: Context,
    role: String = PRIMARY_CLIENT_ROLE,
): String = "client_${androidInstallationId(context, role)}"

internal fun androidNativeConsoleWorkerId(context: Context, renderer: String): String {
    require(renderer.matches(Regex("[a-z0-9_-]+"))) { "invalid renderer name" }
    val installationId = androidInstallationId(context)
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
    private val onConnectionStateChanged: ((Boolean) -> Unit)? = null,
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
                onConnectionStateChanged?.invoke(true)
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
                onConnectionStateChanged?.invoke(false)
                Log.i(TAG, "Native console worker disconnected")
            }
            nativeSocket.on(Socket.EVENT_CONNECT_ERROR) { args ->
                onConnectionStateChanged?.invoke(false)
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
            onConnectionStateChanged?.invoke(false)
        }
    }

    companion object {
        private const val TAG = "AndroidNativeConsole"
    }
}
