package com.termux.extensions.nativeeditor.explorer

import android.util.Log
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import com.termux.extensions.rpc.JsonRpcNotification
import com.termux.extensions.rpc.asStringMap

internal class NativeExplorerRpcController(
    private val transport: NativeExplorerRpcTransport,
    private val onOpenFile: () -> Unit,
    private val onError: (String) -> Unit,
) {
    companion object {
        private const val TAG = "NativeExplorer"
    }

    private val mutableState = mutableStateOf(NativeExplorerUiState())
    val state: State<NativeExplorerUiState> = mutableState

    fun onConnected() {
        refresh("socket_connect")
    }

    fun onResume() {
        refresh("resume")
    }

    fun reset() {
        mutableState.value = NativeExplorerUiState()
    }

    fun setActiveFile(path: String) {
        if (path.isBlank()) return
        update { it.copy(activeFile = path) }
    }

    fun toggleDirectory(rel: String) {
        val current = state.value
        val wasExpanded = rel in current.expandedDirectories
        val next = nativeExplorerProjectionAfterToggle(
            current.listings,
            current.expandedDirectories,
            rel,
        )
        if (!wasExpanded) requestDirectory(rel)
        update {
            it.copy(
                listings = next.listings,
                expandedDirectories = next.expandedDirectories,
            )
        }
        notifyProjection(
            "explorer.openDirs.set",
            mapOf("dirs" to next.expandedDirectories.toList()),
            "Explorer state sync failed",
        )
    }

    fun requestDirectory(rel: String = ".") {
        notifyProjection("explorer.list", mapOf("rel" to rel), "Explorer failed")
    }

    fun refresh(reason: String = "manual") {
        if (!transport.isConnected) return
        val directories = nativeExplorerRefreshDirectories(state.value.expandedDirectories)
        Log.d(TAG, "refresh reason=$reason directories=${directories.size}")
        directories.forEach(::requestDirectory)
        notifyProjection("explorer.git.status.get", errorPrefix = "Git refresh failed")
    }

    fun openFile(relOrPath: String, line: Int? = null, column: Int? = null) {
        val params = linkedMapOf<String, Any?>(
            "path" to relOrPath,
            "source" to "android_native_explorer",
            "focus" to true,
        )
        if (line != null) params["line"] = line
        if (column != null) params["column"] = column
        transport.request("explorer.editor.open", params) { result ->
            result.exceptionOrNull()?.let { onError("Open failed: ${it.message}") }
        }
        onOpenFile()
    }

    fun handleNotification(notification: JsonRpcNotification): Boolean {
        when (notification.method) {
            "explorer.list.updated" -> applyDirectoryListing(notification.params)
            "explorer.openDirs.updated" -> applyOpenDirectories(notification.params)
            "explorer.activeFile.updated", "explorer.openState.changed" -> {
                val active = notification.params.string("path")
                    .ifBlank { notification.params.string("openFile") }
                    .ifBlank { notification.params.string("rel") }
                setActiveFile(active)
            }
            "explorer.git.decorations.updated" -> applyGitDecorations(notification.params)
            "explorer.decorations.updated" -> applyDraftDecorations(notification.params)
            else -> return false
        }
        return true
    }

    private fun applyDirectoryListing(payload: Map<String, Any?>) {
        val cwd = payload.string("cwd").ifBlank { "." }
        val entries = payload["entries"].asList().mapNotNull { raw ->
            val item = raw.asStringMap() ?: return@mapNotNull null
            val rel = item.string("rel")
            if (rel.isBlank()) return@mapNotNull null
            NativeExplorerEntry(
                name = item.string("name").ifBlank { rel.substringAfterLast('/') },
                rel = rel,
                kind = item.string("kind"),
                gitStatus = item.string("gitStatus"),
                gitFlags = item["gitFlags"].asList().mapNotNull { it as? String },
                hasDraft = item["hasDraft"] == true,
            )
        }
        update { it.copy(listings = it.listings + (cwd to entries)) }
    }

    private fun applyOpenDirectories(payload: Map<String, Any?>) {
        val dirs = payload["dirs"].asList().mapNotNull { it as? String }.toSet()
        val newlyOpen = dirs - state.value.expandedDirectories
        update {
            val next = nativeExplorerProjectionAfterOpenDirectories(it.listings, dirs)
            it.copy(
                listings = next.listings,
                expandedDirectories = next.expandedDirectories,
            )
        }
        newlyOpen.forEach(::requestDirectory)
    }

    private fun applyGitDecorations(payload: Map<String, Any?>) {
        val statuses = payload["statuses"].asStringMap().orEmpty().mapNotNull { (path, rawStatus) ->
            val status = rawStatus as? String ?: return@mapNotNull null
            path to status
        }.toMap()
        update {
            it.copy(listings = nativeExplorerListingsAfterGitDecorations(it.listings, statuses))
        }
    }

    private fun applyDraftDecorations(payload: Map<String, Any?>) {
        val drafts = payload["drafts"].asStringMap().orEmpty().mapNotNull { (path, rawState) ->
            path.takeIf { rawState.asStringMap()?.get("hasDraft") == true }
        }.toSet()
        update {
            it.copy(listings = nativeExplorerListingsAfterDraftDecorations(it.listings, drafts))
        }
    }

    private fun update(transform: (NativeExplorerUiState) -> NativeExplorerUiState) {
        mutableState.value = transform(mutableState.value)
    }

    private fun notifyProjection(
        method: String,
        params: Map<String, Any?> = emptyMap(),
        errorPrefix: String,
    ) {
        if (!transport.notify(method, params)) {
            onError("$errorPrefix: Explorer RPC is not connected")
        }
    }
}

private fun Any?.asList(): List<Any?> = this as? List<Any?> ?: emptyList()

private fun Map<String, Any?>.string(key: String): String = this[key] as? String ?: ""
