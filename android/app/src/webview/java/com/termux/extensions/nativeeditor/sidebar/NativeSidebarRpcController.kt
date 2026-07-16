package com.termux.extensions.nativeeditor.sidebar

import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import com.termux.extensions.UiIpcClient
import com.termux.extensions.rpc.JsonRpcNotification
import com.termux.extensions.rpc.asStringMap
import java.net.URI
import okhttp3.OkHttpClient

internal interface NativeSidebarRpcTransport {
    fun request(
        method: String,
        params: Map<String, Any?> = emptyMap(),
        timeoutMs: Long = 8_000,
        callback: (Result<Any?>) -> Unit,
    )
}

internal class UiIpcNativeSidebarRpcTransport(
    private val client: () -> UiIpcClient?,
) : NativeSidebarRpcTransport {
    override fun request(
        method: String,
        params: Map<String, Any?>,
        timeoutMs: Long,
        callback: (Result<Any?>) -> Unit,
    ) {
        val current = client()
        if (current == null) {
            callback(Result.failure(IllegalStateException("UI IPC is unavailable")))
            return
        }
        current.request(method, params, timeoutMs, callback)
    }
}

/** Owns the established host sidebar RPC contract and its native projection. */
internal class NativeSidebarRpcController(
    httpClient: OkHttpClient,
    private val transport: NativeSidebarRpcTransport,
    private val onError: (String) -> Unit,
    private val mainHandler: Handler = Handler(Looper.getMainLooper()),
) {
    companion object {
        private const val TAG = "NativeSidebarRpc"
    }

    private val mutableState = mutableStateOf(NativeSidebarUiState())
    val state: State<NativeSidebarUiState> = mutableState
    private val runtime = NativeSidebarRuntime(httpClient)
    private var baseUrl = ""

    fun bind(nextBaseUrl: String) {
        baseUrl = nextBaseUrl.trimEnd('/')
        runtime.bind(baseUrl)
    }

    fun release() {
        runtime.release()
    }

    fun activate(hostId: String) {
        transport.request(
            "ui.sidebar.window.activate",
            mapOf("host_id" to hostId, "source" to "android_native"),
        ) { result ->
            result.onSuccess(::applyResultState)
            result.exceptionOrNull()?.let { reportError("Sidebar activation failed: ${it.message}") }
        }
    }

    fun close(hostId: String) {
        transport.request(
            "ui.sidebar.window.close",
            mapOf("host_id" to hostId, "source" to "android_native"),
        ) { result ->
            result.onSuccess(::applyResultState)
            result.exceptionOrNull()?.let { reportError("Sidebar close failed: ${it.message}") }
        }
    }

    fun openApp(appId: String) {
        transport.request(
            "ui.sidebar.window.create",
            mapOf(
                "app_id" to appId,
                "activate" to true,
                "source" to "android_native",
            ),
            timeoutMs = 15_000,
        ) { result ->
            result.onSuccess(::applyResultState)
            result.exceptionOrNull()?.let { reportError("Sidebar open failed: ${it.message}") }
        }
    }

    fun handleNotification(notification: JsonRpcNotification): Boolean = when (notification.method) {
        "ui.sidebar.windows.changed", "ui.sidebar.window.readiness.changed" -> {
            applyLedger(notification.params)
            true
        }
        "ui.sidebar.window.activated" -> {
            applyActivation(notification.params)
            true
        }
        else -> false
    }

    private fun applyLedger(payload: Map<String, Any?>) {
        val ledger = nativeSidebarLedgerState(payload)
        if (ledger == null) {
            Log.w(TAG, "Ignoring incomplete sidebar ledger keys=${payload.keys.sorted()}")
            return
        }
        val active = ledger.string("active_host_id").ifBlank {
            ledger.string("activeHostId")
        }
        val slots = ledger["slots"].asStringMap().orEmpty()
        val order = ledger["order"].asList().mapNotNull { it as? String }
        val items = order.mapNotNull { hostId ->
            if (hostId == "launcher") return@mapNotNull null
            val slot = slots[hostId].asStringMap() ?: return@mapNotNull null
            val rawUrl = slot.string("restore_url").ifBlank {
                slot.string("restoreUrl")
            }.ifBlank { slot.string("url") }
            val readiness = slot["readiness"].asStringMap().orEmpty()
            NativeSidebarItem(
                hostId = hostId,
                title = slot.string("title").ifBlank { slot.string("label") }
                    .ifBlank { slot.string("app_id") }.ifBlank { "Sidebar" },
                url = resolveUrl(rawUrl),
                active = hostId == active,
                kind = slot.string("kind").ifBlank {
                    if (slot.string("app_id").isBlank()) "url" else "app"
                },
                appId = slot.string("app_id"),
                stateful = slot["stateful"] == true,
                load = slot.string("load").ifBlank { "lazy" },
                readinessStatus = readiness.string("status"),
                readinessMessage = readiness.string("message").ifBlank {
                    readiness.string("detail")
                },
            )
        }
        val catalog = ledger["catalog"].asList().mapNotNull { raw ->
            val item = raw.asStringMap() ?: return@mapNotNull null
            val appId = item.string("app_id").ifBlank { item.string("id") }
            if (appId.isBlank()) return@mapNotNull null
            NativeSidebarCatalogItem(
                appId = appId,
                title = item.string("name").ifBlank { item.string("title") }.ifBlank { appId },
            )
        }
        update { it.copy(items = items, catalog = catalog, error = null) }
        runtime.reconcile(items, ::applyRuntimeProjection)
    }

    private fun applyActivation(payload: Map<String, Any?>) {
        val hostId = payload.string("host_id").ifBlank { payload.string("hostId") }
        if (hostId.isBlank()) return
        update { current ->
            if (current.items.none { it.hostId == hostId }) return@update current
            current.copy(
                items = nativeSidebarItemsAfterActivation(current.items, hostId),
                activeUrl = current.loadedUrls[hostId].orEmpty(),
            )
        }
    }

    private fun applyRuntimeProjection(projection: NativeSidebarProjection) {
        update {
            it.copy(
                activeUrl = projection.loadedUrls[projection.activeHostId].orEmpty(),
                loadedUrls = projection.loadedUrls,
                loading = projection.loading,
                message = projection.message,
                error = projection.error,
            )
        }
    }

    private fun applyResultState(value: Any?) {
        value.asStringMap().orEmpty()["state"].asStringMap()?.let(::applyLedger)
    }

    private fun reportError(message: String) {
        Log.w(TAG, message)
        update { it.copy(loading = false, message = message, error = message) }
        onError(message)
    }

    private fun resolveUrl(raw: String): String {
        if (raw.isBlank()) return ""
        return try {
            URI(baseUrl.trimEnd('/') + "/").resolve(raw).toString()
        } catch (_: Exception) {
            raw
        }
    }

    private fun update(transform: (NativeSidebarUiState) -> NativeSidebarUiState) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            mutableState.value = transform(mutableState.value)
        } else {
            mainHandler.post { mutableState.value = transform(mutableState.value) }
        }
    }
}

private fun Map<String, Any?>.string(key: String): String = this[key] as? String ?: ""

private fun Any?.asList(): List<Any?> = this as? List<Any?> ?: emptyList()
