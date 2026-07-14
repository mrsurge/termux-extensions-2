package com.termux.extensions.nativeeditor

import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import com.termux.extensions.UiIpcClient
import com.termux.extensions.rpc.JsonRpcNotification
import com.termux.extensions.rpc.RpcResponseMode
import com.termux.extensions.rpc.SocketIoJsonRpcClient
import com.termux.extensions.rpc.SocketIoRpcLane
import com.termux.extensions.rpc.asStringMap
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.max

/**
 * Native Code TE2 is a projection client. This controller translates user
 * intent into existing backend RPC methods and never treats local tree,
 * project, open-file, diagnostics, or sidebar state as authoritative.
 */
internal class NativeEditorController(
    private val assetRoot: File,
    private val mainHandler: Handler = Handler(Looper.getMainLooper()),
) {
    companion object {
        private const val TAG = "NativeEditor"
        private const val MIRROR_DEBOUNCE_MS = 180L
        private const val WBA_CHANGE_DEBOUNCE_MS = 120L
    }

    private val mutableState = mutableStateOf(NativeEditorUiState())
    val state: State<NativeEditorUiState> = mutableState
    val textMate = NativeEditorTextMate(assetRoot)

    private var baseUrl = ""
    private var editorClient: SocketIoJsonRpcClient? = null
    private var explorerClient: SocketIoJsonRpcClient? = null
    private var wbaClient: SocketIoJsonRpcClient? = null
    private var uiIpcClient: UiIpcClient? = null
    private var mirrorTask: Runnable? = null
    private var wbaChangeTask: Runnable? = null
    private var bootSnapshotInFlight = false
    private var adapterReady = false
    private var released = false
    private var textMateCatalog: List<NativeTextMateGrammarDescriptor>? = null
    private var textMateRequestGeneration = 0L
    private var textMateLoadingLanguage = ""

    fun connect(nextBaseUrl: String, uiClient: UiIpcClient?) {
        if (released) return
        disconnectLanes()
        resetTextMateSession()
        adapterReady = false
        baseUrl = nextBaseUrl.trimEnd('/')
        Log.i(TAG, "connect baseUrl=$baseUrl")
        attachUiIpc(uiClient)
        editorClient = createLane(
            SocketIoRpcLane(
                name = "editor",
                namespace = "/rpc/editor",
                path = "/editor_ws/socket.io",
                responseMode = RpcResponseMode.IN_BAND,
            ),
            onConnected = { update { it.copy(editorConnected = true, errorMessage = null) } },
            onDisconnected = { update { it.copy(editorConnected = false) } },
            onNotification = ::handleEditorNotification,
        )
        explorerClient = createLane(
            SocketIoRpcLane(
                name = "explorer",
                namespace = "/rpc/explorer",
                path = "/explorer_ws/socket.io",
                responseMode = RpcResponseMode.ACK,
            ),
            onConnected = { update { it.copy(explorerConnected = true, errorMessage = null) } },
            onDisconnected = { update { it.copy(explorerConnected = false) } },
            onNotification = ::handleExplorerNotification,
        )
        editorClient?.connect()
        explorerClient?.connect()
        requestBootSnapshot()
    }

    fun attachUiIpc(client: UiIpcClient?) {
        if (uiIpcClient === client) return
        uiIpcClient?.onRpcNotification = null
        uiIpcClient?.onRpcConnectionChanged = null
        uiIpcClient = client
        client?.onRpcNotification = ::handleUiNotification
        client?.onRpcConnectionChanged = ::handleUiConnectionChanged
    }

    fun reconnect(nextBaseUrl: String, uiClient: UiIpcClient?) {
        connect(nextBaseUrl, uiClient)
    }

    fun release() {
        released = true
        mirrorTask?.let(mainHandler::removeCallbacks)
        wbaChangeTask?.let(mainHandler::removeCallbacks)
        mirrorTask = null
        wbaChangeTask = null
        disconnectLanes()
        uiIpcClient?.onRpcNotification = null
        uiIpcClient?.onRpcConnectionChanged = null
        uiIpcClient = null
    }

    fun setOverlay(overlay: NativeEditorOverlay) {
        update { current ->
            current.copy(overlay = if (current.overlay == overlay) NativeEditorOverlay.NONE else overlay)
        }
    }

    fun closeOverlay(): Boolean {
        if (state.value.overlay == NativeEditorOverlay.NONE) return false
        update { it.copy(overlay = NativeEditorOverlay.NONE) }
        return true
    }

    fun onDocumentChanged(content: String) {
        val document = state.value.document ?: return
        if (document.content == content) return
        val updated = document.copy(
            content = content,
            contentSha256 = sha256(content),
            unsaved = true,
        )
        update {
            it.copy(
                document = updated,
                activeFile = updated.path,
                statusMessage = "Modified",
                errorMessage = null,
            )
        }
        scheduleMirror()
        scheduleWbaChange()
    }

    fun save() {
        val document = state.value.document ?: return
        update { it.copy(statusMessage = "Saving ${document.relativePath}...", errorMessage = null) }
        editorClient?.request(
            "editor.save",
            mapOf(
                "path" to document.path,
                "content" to document.content,
                "base_sha256" to document.baseSha256,
                "request_id" to requestId("native_save"),
                "client_id" to "android_native",
            ),
            timeoutMs = 15_000,
        ) { result ->
            result.fold(
                onSuccess = { value -> applySaveResult(value) },
                onFailure = { error -> setError("Save failed: ${error.message}") },
            )
        }
    }

    fun runActiveFile() {
        update { it.copy(statusMessage = "Starting run profile...", errorMessage = null) }
        val client = uiIpcClient
        if (client == null) {
            setError("UI IPC is unavailable")
            return
        }
        client.request(
            "ui.host.file.run",
            mapOf("source" to "android_native"),
            timeoutMs = 20_000,
        ) { result ->
            result.fold(
                onSuccess = { value ->
                    val payload = value.asStringMap().orEmpty()
                    if (payload["ok"] == false) {
                        setError(payload["error"]?.toString() ?: "Run failed")
                    } else {
                        update { it.copy(statusMessage = "Run request accepted", errorMessage = null) }
                    }
                },
                onFailure = { error -> setError("Run failed: ${error.message}") },
            )
        }
    }

    fun toggleDirectory(rel: String) {
        val current = state.value
        val next = current.expandedDirectories.toMutableSet()
        if (!next.add(rel)) {
            next.remove(rel)
        } else {
            requestDirectory(rel)
        }
        update { it.copy(expandedDirectories = next) }
        explorerClient?.request(
            "explorer.openDirs.set",
            mapOf("dirs" to next.toList()),
        ) { }
    }

    fun requestDirectory(rel: String = ".") {
        explorerClient?.request("explorer.list", mapOf("rel" to rel)) { result ->
            result.exceptionOrNull()?.let { setError("Explorer failed: ${it.message}") }
        }
    }

    fun openFile(relOrPath: String, line: Int? = null, column: Int? = null) {
        val params = linkedMapOf<String, Any?>(
            "path" to relOrPath,
            "source" to "android_native_explorer",
            "focus" to true,
        )
        if (line != null) params["line"] = line
        if (column != null) params["column"] = column
        explorerClient?.request("explorer.editor.open", params) { result ->
            result.exceptionOrNull()?.let { setError("Open failed: ${it.message}") }
        }
        update { it.copy(overlay = NativeEditorOverlay.NONE) }
    }

    fun setSearchMode(mode: String) {
        if (mode != "name" && mode != "content") return
        update { it.copy(searchMode = mode) }
    }

    fun setSearchQuery(query: String) {
        update { it.copy(searchQuery = query) }
    }

    fun runSearch() {
        val current = state.value
        val query = current.searchQuery.trim()
        if (query.isEmpty()) return
        if (current.searchRunning) cancelSearch()
        update {
            it.copy(
                searchResults = emptyList(),
                searchRunning = true,
                searchId = "",
                searchNextCursor = "",
                statusMessage = "Searching...",
                errorMessage = null,
            )
        }
        explorerClient?.request(
            "explorer.search.run",
            mapOf(
                "mode" to current.searchMode,
                "query" to query,
                "correlationId" to requestId("native_search"),
                "isRegex" to false,
                "isCaseSensitive" to false,
                "isWholeWords" to false,
                "includePattern" to "",
                "excludePattern" to "",
                "useIgnoreFiles" to true,
            ),
            timeoutMs = 20_000,
        ) { result ->
            result.exceptionOrNull()?.let {
                update { state -> state.copy(searchRunning = false) }
                setError("Search failed: ${it.message}")
            }
        }
    }

    fun loadMoreSearch() {
        val current = state.value
        val generation = current.projectGeneration ?: return
        if (current.searchId.isBlank() || current.searchNextCursor.isBlank()) return
        explorerClient?.request(
            "explorer.search.more",
            mapOf(
                "searchId" to current.searchId,
                "projectGeneration" to generation,
                "cursor" to current.searchNextCursor,
                "limit" to mapOf(
                    "maxMatchesPerFile" to 100,
                    "maxMatchesTotal" to 500,
                ),
            ),
            timeoutMs = 20_000,
        ) { result ->
            result.exceptionOrNull()?.let { setError("Search continuation failed: ${it.message}") }
        }
    }

    fun cancelSearch() {
        val current = state.value
        explorerClient?.request(
            "explorer.search.cancel",
            mapOf(
                "searchId" to current.searchId.ifBlank { null },
                "reason" to "android_native_cancel",
            ),
        ) { }
        update { it.copy(searchRunning = false, statusMessage = "Search cancelled") }
    }

    fun activateSidebar(hostId: String) {
        uiIpcClient?.request(
            "ui.sidebar.window.activate",
            mapOf("host_id" to hostId, "source" to "android_native"),
        ) { result ->
            result.onSuccess(::applyUiResultState)
            result.exceptionOrNull()?.let { setError("Sidebar activation failed: ${it.message}") }
        }
    }

    fun openSidebarApp(appId: String) {
        uiIpcClient?.request(
            "ui.sidebar.window.create",
            mapOf(
                "app_id" to appId,
                "activate" to true,
                "source" to "android_native",
            ),
            timeoutMs = 15_000,
        ) { result ->
            result.onSuccess(::applyUiResultState)
            result.exceptionOrNull()?.let { setError("Sidebar open failed: ${it.message}") }
        }
    }

    fun completions(
        text: String,
        line: Int,
        column: Int,
        languageId: String,
    ): List<NativeCompletion> {
        val document = state.value.document ?: return emptyList()
        val client = wbaClient ?: return emptyList()
        if (!client.isConnected) return emptyList()
        Log.d(TAG, "completion request path=${document.path} line=$line column=$column")
        val latch = CountDownLatch(1)
        var response: Any? = null
        var failure: Throwable? = null
        client.request(
            "vscode.completions",
            mapOf(
                "path" to document.path,
                "languageId" to languageId,
                "lineNumber" to line + 1,
                "column" to column + 1,
                "text" to text,
                "timeoutMs" to 4_000,
            ),
            timeoutMs = 5_000,
        ) { result ->
            result.fold(
                onSuccess = { response = it },
                onFailure = { failure = it },
            )
            latch.countDown()
        }
        if (!latch.await(5_500, TimeUnit.MILLISECONDS)) return emptyList()
        failure?.let {
            Log.d(TAG, "Completion request failed: ${it.message}")
            return emptyList()
        }
        return parseCompletions(response, line, column, text).also { items ->
            Log.d(TAG, "completion response path=${document.path} items=${items.size}")
        }
    }

    /** Bounded native probes exposed through the existing TE2 console worker. */
    fun evaluateConsoleCommand(
        rawCommand: String,
        callback: (Result<Any?>) -> Unit,
    ): Boolean {
        val command = rawCommand.trim().removeSuffix("()")
        when (command) {
            "native.help" -> {
                callback(
                    Result.success(
                        listOf("native.snapshot", "wba.ping", "wba.status", "wba.events"),
                    ),
                )
            }
            "native.snapshot" -> mainHandler.post {
                callback(Result.success(buildDebugSnapshot()))
            }
            "wba.ping" -> requestWbaProbe("te2.ping", callback)
            "wba.status" -> requestWbaProbe("adapter.status", callback)
            "wba.events" -> requestWbaProbe("adapter.events", callback)
            else -> return false
        }
        return true
    }

    private fun createLane(
        lane: SocketIoRpcLane,
        onConnected: () -> Unit,
        onDisconnected: () -> Unit,
        onNotification: (JsonRpcNotification) -> Unit,
    ): SocketIoJsonRpcClient = SocketIoJsonRpcClient(
        baseUrl,
        lane,
        source = "android_native",
    ).apply {
        this.onConnected = onConnected
        this.onDisconnected = { onDisconnected() }
        this.onConnectError = { error ->
            setError("${lane.name} connection failed: ${error ?: "unknown"}")
        }
        this.onNotification = onNotification
    }

    private fun handleUiConnectionChanged(connected: Boolean) {
        update { it.copy(uiConnected = connected) }
        if (connected) requestBootSnapshot()
    }

    /**
     * Native mode participates in the same backend boot transaction as the web
     * host. The snapshot request also starts the backend-owned adapter runtime.
     */
    private fun requestBootSnapshot() {
        val client = uiIpcClient ?: return
        if (!client.isRpcConnected || bootSnapshotInFlight) return
        bootSnapshotInFlight = true
        Log.i(TAG, "requesting backend boot snapshot")
        client.request(
            "ui.host.bootSnapshot.get",
            timeoutMs = 20_000,
        ) { result ->
            bootSnapshotInFlight = false
            result.fold(
                onSuccess = { value ->
                    val response = value.asStringMap().orEmpty()
                    val snapshot = response["snapshot"].asStringMap().orEmpty()
                    snapshot["editor_ssot"].asStringMap()?.let(::applyEditorSnapshot)
                    Log.i(TAG, "backend boot snapshot received")
                    update { it.copy(statusMessage = "Waiting for workbench...", errorMessage = null) }
                },
                onFailure = { error -> setError("Native boot failed: ${error.message}") },
            )
        }
    }

    private fun applyAdapterState(payload: Map<String, Any?>) {
        val status = payload.string("status").ifBlank { "idle" }
        Log.i(TAG, "adapter state status=$status project=${payload.string("project")}")
        adapterReady = status == "ready"
        update {
            it.copy(
                adapterStatus = status,
                statusMessage = when (status) {
                    "starting" -> "Starting workbench..."
                    "switching" -> "Switching workbench..."
                    "ready" -> it.statusMessage
                    "error" -> payload.string("error").ifBlank { "Workbench failed" }
                    else -> it.statusMessage
                },
                errorMessage = if (status == "error") {
                    payload.string("error").ifBlank { "Workbench failed" }
                } else {
                    it.errorMessage
                },
            )
        }
        if (adapterReady) {
            ensureWbaClient()
            flushActiveWbaDocument("adapter_ready")
            ensureTextMateForActiveDocument()
        }
    }

    private fun ensureWbaClient() {
        if (released || !adapterReady || wbaClient != null) return
        wbaClient = createLane(
            SocketIoRpcLane(
                name = "wba",
                namespace = "/wba",
                path = "/wba_ws/socket.io",
                responseMode = RpcResponseMode.IN_BAND,
                notificationEvent = "rpc",
            ),
            onConnected = {
                Log.i(TAG, "WBA socket connected")
                update { it.copy(wbaConnected = true, errorMessage = null) }
                flushActiveWbaDocument("wba_socket_connect")
                ensureTextMateForActiveDocument()
            },
            onDisconnected = {
                Log.i(TAG, "WBA socket disconnected")
                update { it.copy(wbaConnected = false) }
            },
            onNotification = ::handleWbaNotification,
        ).also(SocketIoJsonRpcClient::connect)
    }

    private fun handleWbaNotification(notification: JsonRpcNotification) {
        if (notification.method != "te2.event") return
        val type = notification.params.string("type")
        Log.d(TAG, "WBA event type=$type")
        when (type) {
            "adapter/sessionReset" -> {
                adapterReady = false
                resetTextMateSession()
                update { it.copy(adapterStatus = "switching", textMateReady = false) }
            }
            "workspace/switched" -> {
                if (notification.params["readyForDocumentOpen"] == true) {
                    adapterReady = true
                    update { it.copy(adapterStatus = "ready") }
                    flushActiveWbaDocument("workspace_switched")
                    ensureTextMateForActiveDocument()
                }
            }
        }
    }

    private fun handleEditorNotification(notification: JsonRpcNotification) {
        when (notification.method) {
            "editor.state.ssot" -> applyEditorSnapshot(notification.params)
            "editor.file.opened", "editor.mirror.updated" -> applyDocumentPayload(notification.params)
            "editor.openState.changed" -> applyOpenState(notification.params)
            "editor.cache.state" -> applyCacheState(notification.params)
            "editor.adapter.state" -> applyAdapterState(notification.params)
            "editor.save.snapshot.request" -> respondToSaveSnapshot(notification.params)
            "editor.project.switching" -> {
                adapterReady = false
                update {
                    it.copy(
                        projectSwitching = true,
                        statusMessage = "Switching project...",
                        errorMessage = null,
                    )
                }
            }
            "editor.project.switched" -> applyProjectSwitched(notification.params)
            "editor.notify" -> {
                val message = notification.params["message"]?.toString()
                if (!message.isNullOrBlank()) update { it.copy(statusMessage = message) }
            }
        }
    }

    private fun handleExplorerNotification(notification: JsonRpcNotification) {
        when (notification.method) {
            "explorer.list.updated" -> applyDirectoryListing(notification.params)
            "explorer.openDirs.updated" -> {
                val dirs = notification.params["dirs"].asList().mapNotNull { it as? String }.toSet()
                update { it.copy(expandedDirectories = dirs) }
            }
            "explorer.activeFile.updated", "explorer.openState.changed" -> {
                val active = notification.params.string("path")
                    .ifBlank { notification.params.string("openFile") }
                    .ifBlank { notification.params.string("rel") }
                if (active.isNotBlank()) update { it.copy(activeFile = active) }
            }
            "explorer.project.opened", "explorer.project.active.updated" -> {
                val project = projectPath(notification.params)
                val generation = notification.params.int("projectGeneration")
                update {
                    it.copy(
                        projectPath = project.ifBlank { it.projectPath },
                        projectGeneration = generation ?: it.projectGeneration,
                        projectSwitching = false,
                    )
                }
            }
            "explorer.diagnostics.detail" -> applyDiagnostics(notification.params)
            "explorer.search.started" -> applySearchStarted(notification.params)
            "explorer.search.results.updated" -> applySearchResult(notification.params, append = false)
            "search.job.result", "explorer.search.more.result" -> {
                val result = notification.params["result"].asStringMap() ?: notification.params
                applySearchResult(result, append = true)
            }
            "search.job.done" -> update {
                it.copy(searchRunning = false, statusMessage = "Search complete")
            }
            "search.job.error" -> {
                update { it.copy(searchRunning = false) }
                setError(notification.params.string("message").ifBlank { "Search failed" })
            }
            "explorer.search.cancelled", "explorer.search.reset" -> update {
                it.copy(searchRunning = false)
            }
            "explorer.error" -> setError(
                notification.params.string("message").ifBlank { "Explorer request failed" },
            )
        }
    }

    private fun handleUiNotification(notification: JsonRpcNotification) {
        update { it.copy(uiConnected = true) }
        when (notification.method) {
            "ui.adapter.state" -> applyAdapterState(notification.params)
            "ui.sidebar.windows.changed",
            "ui.sidebar.window.activated",
            "ui.sidebar.window.readiness.changed" -> applySidebarState(notification.params)
        }
    }

    private fun applyEditorSnapshot(payload: Map<String, Any?>) {
        val project = projectPath(payload)
        val file = payload["file"].asStringMap()
        update {
            it.copy(
                projectPath = project.ifBlank { it.projectPath },
                projectSwitching = false,
                statusMessage = if (file == null) "No file open" else it.statusMessage,
            )
        }
        file?.let(::applyDocumentPayload)
        payload["openState"].asStringMap()?.let(::applyOpenState)
    }

    private fun applyDocumentPayload(payload: Map<String, Any?>) {
        val path = payload.string("path")
        if (path.isBlank()) return
        val project = state.value.projectPath.ifBlank { projectPath(payload) }
        val content = payload.string("content")
        val existing = state.value.document
        val reason = payload.string("reason")
        if (
            existing?.path == path &&
            existing.projectPath == project &&
            existing.unsaved &&
            payload["unsaved"] != true &&
            (reason == "reconnect" || reason == "disk")
        ) {
            return
        }
        val baseSha = payload.string("base_sha256").ifBlank { sha256(content) }
        val contentSha = payload.string("content_sha256").ifBlank { sha256(content) }
        val document = NativeDocument(
            path = path,
            projectPath = project,
            content = content,
            baseSha256 = baseSha,
            contentSha256 = contentSha,
            languageId = languageIdForPath(path),
            unsaved = payload["unsaved"] == true,
        )
        update {
            it.copy(
                projectPath = project,
                document = document,
                activeFile = path,
                projectSwitching = false,
                statusMessage = if (document.unsaved) "Modified" else document.relativePath,
                errorMessage = null,
            )
        }
        flushActiveWbaDocument("document_projection")
        ensureTextMateForActiveDocument()
    }

    private fun applyOpenState(payload: Map<String, Any?>) {
        val path = payload.string("openFile").ifBlank { payload.string("path") }
        if (path.isNotBlank()) update { it.copy(activeFile = path) }
    }

    private fun applyCacheState(payload: Map<String, Any?>) {
        val current = state.value.document ?: return
        val path = payload.string("path")
        if (path.isNotBlank() && path != current.path) return
        val clean = payload["unsaved"] == false || payload.string("state") == "clean"
        if (!clean) return
        val sha = payload.string("base_sha256").ifBlank { sha256(current.content) }
        update {
            it.copy(
                document = current.copy(
                    baseSha256 = sha,
                    contentSha256 = sha,
                    unsaved = false,
                ),
                statusMessage = "Saved",
                errorMessage = null,
            )
        }
    }

    private fun applyProjectSwitched(payload: Map<String, Any?>) {
        val project = projectPath(payload)
        update {
            it.copy(
                projectPath = project,
                document = null,
                listings = emptyMap(),
                expandedDirectories = emptySet(),
                activeFile = "",
                searchResults = emptyList(),
                searchId = "",
                searchNextCursor = "",
                diagnostics = emptyMap(),
                projectSwitching = false,
                statusMessage = "Project switched",
                errorMessage = null,
            )
        }
        requestDirectory(".")
    }

    private fun respondToSaveSnapshot(payload: Map<String, Any?>) {
        val requestId = payload.string("requestId").ifBlank { payload.string("request_id") }
        if (requestId.isBlank()) return
        val document = state.value.document
        val response = if (document == null) {
            mapOf("requestId" to requestId, "request_id" to requestId, "error" to "No active document")
        } else {
            mapOf(
                "requestId" to requestId,
                "request_id" to requestId,
                "path" to document.path,
                "content" to document.content,
                "base_sha256" to document.baseSha256,
            )
        }
        editorClient?.request("editor.save.snapshot.response", response) { }
    }

    private fun applySaveResult(value: Any?) {
        val payload = value.asStringMap().orEmpty()
        if (payload["ok"] == false) {
            setError(payload["error"]?.toString() ?: "Save failed")
            return
        }
        val current = state.value.document ?: return
        val data = payload["data"].asStringMap().orEmpty()
        val sha = data.string("sha256").ifBlank { sha256(current.content) }
        update {
            it.copy(
                document = current.copy(
                    baseSha256 = sha,
                    contentSha256 = sha,
                    unsaved = false,
                ),
                statusMessage = "Saved",
                errorMessage = null,
            )
        }
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
        update { current ->
            current.copy(listings = current.listings + (cwd to entries))
        }
    }

    private fun applyDiagnostics(payload: Map<String, Any?>) {
        val next = payload.mapValues { (path, rawMarkers) ->
            rawMarkers.asList().mapNotNull { raw ->
                val marker = raw.asStringMap() ?: return@mapNotNull null
                NativeDiagnostic(
                    path = path,
                    message = marker.string("message"),
                    severity = marker.int("severity") ?: 0,
                    startLine = marker.int("startLineNumber") ?: 1,
                    startColumn = marker.int("startColumn") ?: 1,
                    endLine = marker.int("endLineNumber") ?: marker.int("startLineNumber") ?: 1,
                    endColumn = marker.int("endColumn") ?: marker.int("startColumn") ?: 1,
                    source = marker.string("source"),
                )
            }
        }.filterValues { it.isNotEmpty() }
        update { it.copy(diagnostics = next) }
    }

    private fun applySearchStarted(payload: Map<String, Any?>) {
        update {
            it.copy(
                searchId = payload.string("searchId"),
                projectGeneration = payload.int("projectGeneration") ?: it.projectGeneration,
                searchRunning = true,
            )
        }
    }

    private fun applySearchResult(payload: Map<String, Any?>, append: Boolean) {
        val mode = payload.string("mode")
        val parsed = if (mode == "name") {
            payload["results"].asList().mapNotNull { raw ->
                val item = raw.asStringMap() ?: return@mapNotNull null
                val path = item.string("path")
                val rel = item.string("rel").ifBlank { item.string("relativePath") }
                if (path.isBlank() && rel.isBlank()) return@mapNotNull null
                NativeSearchResult(path = path, relativePath = rel.ifBlank { path })
            }
        } else {
            payload["results"].asList().flatMap { rawFile ->
                val file = rawFile.asStringMap() ?: return@flatMap emptyList()
                val path = file.string("path")
                val rel = file.string("rel").ifBlank { file.string("relativePath") }
                file["matches"].asList().mapNotNull { rawMatch ->
                    val match = rawMatch.asStringMap() ?: return@mapNotNull null
                    NativeSearchResult(
                        path = path,
                        relativePath = rel.ifBlank { path },
                        line = match.int("line") ?: match.int("lineNumber"),
                        column = match.int("column") ?: match.int("columnNumber"),
                        preview = match.string("snippet").ifBlank { match.string("text") }
                            .ifBlank { match.string("lineText") },
                    )
                }
            }
        }
        update { current ->
            val combined = if (append) current.searchResults + parsed else parsed
            current.copy(
                searchResults = combined.distinctBy {
                    listOf(it.path, it.relativePath, it.line, it.column, it.preview)
                },
                searchId = payload.string("searchId").ifBlank { current.searchId },
                projectGeneration = payload.int("projectGeneration") ?: current.projectGeneration,
                searchNextCursor = payload.string("nextGlobalCursor"),
                searchRunning = payload["complete"] != true,
                statusMessage = "${combined.size} search results",
            )
        }
    }

    private fun applySidebarState(payload: Map<String, Any?>) {
        val statePayload = payload["state"].asStringMap() ?: payload
        val active = statePayload.string("active_host_id").ifBlank {
            statePayload.string("activeHostId")
        }
        val slots = statePayload["slots"].asStringMap().orEmpty()
        val order = statePayload["order"].asList().mapNotNull { it as? String }
        val items = order.mapNotNull { hostId ->
            if (hostId == "launcher") return@mapNotNull null
            val slot = slots[hostId].asStringMap() ?: return@mapNotNull null
            val rawUrl = slot.string("url").ifBlank { slot.string("restore_url") }
            NativeSidebarItem(
                hostId = hostId,
                title = slot.string("title").ifBlank { slot.string("label") }
                    .ifBlank { slot.string("app_id") }.ifBlank { "Sidebar" },
                url = resolveUrl(rawUrl),
                active = hostId == active,
            )
        }
        val catalog = statePayload["catalog"].asList().mapNotNull { raw ->
            val item = raw.asStringMap() ?: return@mapNotNull null
            val appId = item.string("app_id").ifBlank { item.string("id") }
            if (appId.isBlank()) return@mapNotNull null
            NativeSidebarCatalogItem(
                appId = appId,
                title = item.string("name").ifBlank { item.string("title") }.ifBlank { appId },
            )
        }
        val activeUrl = items.firstOrNull { it.active }?.url.orEmpty()
        update {
            it.copy(
                sidebarItems = items,
                sidebarCatalog = catalog,
                activeSidebarUrl = activeUrl,
                uiConnected = true,
            )
        }
    }

    private fun applyUiResultState(value: Any?) {
        val payload = value.asStringMap().orEmpty()
        payload["state"].asStringMap()?.let(::applySidebarState)
    }

    private fun scheduleMirror() {
        mirrorTask?.let(mainHandler::removeCallbacks)
        mirrorTask = Runnable {
            val document = state.value.document ?: return@Runnable
            editorClient?.request(
                "editor.mirror.publish",
                mapOf(
                    "path" to document.path,
                    "content" to document.content,
                    "base_sha256" to document.baseSha256,
                ),
            ) { result ->
                result.exceptionOrNull()?.let { Log.d(TAG, "Mirror publish failed: ${it.message}") }
            }
        }.also { mainHandler.postDelayed(it, MIRROR_DEBOUNCE_MS) }
    }

    private fun scheduleWbaChange() {
        wbaChangeTask?.let(mainHandler::removeCallbacks)
        wbaChangeTask = Runnable {
            val document = state.value.document ?: return@Runnable
            publishWbaDocument(document)
        }.also { mainHandler.postDelayed(it, WBA_CHANGE_DEBOUNCE_MS) }
    }

    /** Replays the complete active model before incremental WBA changes resume. */
    private fun flushActiveWbaDocument(reason: String) {
        val document = state.value.document ?: return
        val client = wbaClient ?: return
        if (!adapterReady || !client.isConnected) return
        Log.i(TAG, "WBA open path=${document.path} reason=$reason")
        client.request(
            "vscode.openFile",
            mapOf(
                "path" to document.path,
                "languageId" to document.languageId,
                "workspaceFolder" to document.projectPath,
                "requestId" to requestId("native_open_${reason}"),
            ),
            timeoutMs = 30_000,
        ) { result ->
            result.exceptionOrNull()?.let { setError("Workbench open failed: ${it.message}") }
            Log.i(TAG, "WBA open result path=${document.path} ok=${result.isSuccess}")
            val current = state.value.document
            if (result.isSuccess && current?.path == document.path) {
                publishWbaDocument(current)
            }
        }
    }

    private fun publishWbaDocument(document: NativeDocument) {
        val client = wbaClient ?: return
        if (!adapterReady || !client.isConnected) return
        Log.d(TAG, "WBA didChange path=${document.path} bytes=${document.content.length}")
        client.request(
            "vscode.didChange",
            mapOf(
                "path" to document.path,
                "text" to document.content,
                "languageId" to document.languageId,
            ),
        ) { result ->
            result.exceptionOrNull()?.let { Log.d(TAG, "WBA didChange failed: ${it.message}") }
        }
    }

    private fun resetTextMateSession() {
        textMateRequestGeneration += 1
        textMateLoadingLanguage = ""
        textMateCatalog = null
        textMate.resetSession()
        update { it.copy(textMateReady = false) }
    }

    private fun ensureTextMateForActiveDocument() {
        val document = state.value.document ?: return
        val languageId = document.languageId
        if (languageId == "plaintext") return
        val client = wbaClient ?: return
        if (!adapterReady || !client.isConnected) return
        if (textMate.isReady(languageId)) {
            if (!state.value.textMateReady) update { it.copy(textMateReady = true) }
            return
        }
        if (textMateLoadingLanguage == languageId) return
        val generation = ++textMateRequestGeneration
        textMateLoadingLanguage = languageId
        update { it.copy(textMateReady = false) }
        val catalog = textMateCatalog
        if (catalog != null) {
            loadTextMateLanguage(client, languageId, catalog, generation)
            return
        }
        Log.i(TAG, "WBA TextMate catalog request language=$languageId")
        client.request(
            "vscode.textmate.grammars.list",
            timeoutMs = 15_000,
        ) { result ->
            if (!isCurrentTextMateRequest(generation, languageId)) return@request
            result.fold(
                onSuccess = { raw ->
                    val parsed = NativeTextMateGrammarCatalog.parse(raw)
                    if (parsed.isEmpty()) {
                        finishTextMateFailure(
                            generation,
                            languageId,
                            IllegalStateException("WBA returned an empty TextMate grammar catalog"),
                        )
                    } else {
                        textMateCatalog = parsed
                        Log.i(TAG, "WBA TextMate catalog received grammars=${parsed.size}")
                        loadTextMateLanguage(client, languageId, parsed, generation)
                    }
                },
                onFailure = { error -> finishTextMateFailure(generation, languageId, error) },
            )
        }
    }

    private fun loadTextMateLanguage(
        client: SocketIoJsonRpcClient,
        languageId: String,
        catalog: List<NativeTextMateGrammarDescriptor>,
        generation: Long,
    ) {
        val descriptors = NativeTextMateGrammarCatalog.requiredForLanguage(catalog, languageId)
        if (descriptors.isEmpty()) {
            textMateLoadingLanguage = ""
            Log.i(TAG, "WBA TextMate grammar unavailable language=$languageId")
            return
        }
        val grammarIds = descriptors.map { it.id }.distinct()
        val bodies = linkedMapOf<String, String>()
        var remaining = grammarIds.size
        var failed = false
        Log.i(
            TAG,
            "WBA TextMate load language=$languageId grammars=${grammarIds.size}",
        )
        grammarIds.forEach { grammarId ->
            client.request(
                "vscode.textmate.grammars.load",
                mapOf("id" to grammarId),
                timeoutMs = 15_000,
            ) { result ->
                if (failed || !isCurrentTextMateRequest(generation, languageId)) return@request
                result.fold(
                    onSuccess = { rawResult ->
                        val payload = rawResult.asStringMap().orEmpty()
                        val raw = payload["raw"] as? String
                        if (payload["ok"] != true || raw.isNullOrBlank()) {
                            failed = true
                            finishTextMateFailure(
                                generation,
                                languageId,
                                IllegalStateException(
                                    payload["error"] as? String
                                        ?: "WBA returned no body for grammar $grammarId",
                                ),
                            )
                            return@fold
                        }
                        bodies[grammarId] = raw
                        remaining -= 1
                        if (remaining == 0) {
                            installTextMateLanguage(
                                languageId,
                                descriptors,
                                bodies.toMap(),
                                generation,
                            )
                        }
                    },
                    onFailure = { error ->
                        failed = true
                        finishTextMateFailure(generation, languageId, error)
                    },
                )
            }
        }
    }

    private fun installTextMateLanguage(
        languageId: String,
        descriptors: List<NativeTextMateGrammarDescriptor>,
        bodies: Map<String, String>,
        generation: Long,
    ) {
        Thread({
            val result = runCatching {
                textMate.installLanguage(languageId, descriptors, bodies)
            }
            mainHandler.post {
                if (!isCurrentTextMateRequest(generation, languageId)) return@post
                textMateLoadingLanguage = ""
                result.fold(
                    onSuccess = {
                        update {
                            it.copy(
                                textMateReady = true,
                                errorMessage = it.errorMessage?.takeUnless { message ->
                                    message.startsWith("TextMate failed:")
                                },
                            )
                        }
                    },
                    onFailure = { error -> finishTextMateFailure(generation, languageId, error) },
                )
            }
        }, "code-te2-textmate-$languageId").start()
    }

    private fun isCurrentTextMateRequest(generation: Long, languageId: String): Boolean =
        !released &&
            generation == textMateRequestGeneration &&
            state.value.document?.languageId == languageId

    private fun finishTextMateFailure(
        generation: Long,
        languageId: String,
        error: Throwable,
    ) {
        if (!isCurrentTextMateRequest(generation, languageId)) return
        textMateLoadingLanguage = ""
        Log.w(TAG, "WBA TextMate failed language=$languageId", error)
        setError("TextMate failed: ${error.message ?: error.javaClass.simpleName}")
    }

    private fun requestWbaProbe(method: String, callback: (Result<Any?>) -> Unit) {
        val client = wbaClient
        if (client == null) {
            callback(Result.failure(IllegalStateException("WBA client has not been created")))
            return
        }
        client.request(method, timeoutMs = 10_000, callback = callback)
    }

    private fun buildDebugSnapshot(): Map<String, Any?> {
        val current = state.value
        val document = current.document
        return mapOf(
            "baseUrl" to baseUrl,
            "released" to released,
            "bootSnapshotInFlight" to bootSnapshotInFlight,
            "adapterReady" to adapterReady,
            "adapterStatus" to current.adapterStatus,
            "projectPath" to current.projectPath,
            "projectGeneration" to current.projectGeneration,
            "activeFile" to current.activeFile,
            "document" to document?.let {
                mapOf(
                    "path" to it.path,
                    "languageId" to it.languageId,
                    "contentLength" to it.content.length,
                    "unsaved" to it.unsaved,
                )
            },
            "textMateReady" to current.textMateReady,
            "textMateLoadingLanguage" to textMateLoadingLanguage,
            "textMateCatalogCount" to textMateCatalog?.size,
            "textMate" to textMate.debugSnapshot(),
            "errorMessage" to current.errorMessage,
            "uiConnected" to current.uiConnected,
            "editor" to editorClient?.debugSnapshot(),
            "explorer" to explorerClient?.debugSnapshot(),
            "wba" to wbaClient?.debugSnapshot(),
        )
    }

    private fun parseCompletions(
        raw: Any?,
        line: Int,
        column: Int,
        text: String,
    ): List<NativeCompletion> {
        val outer = raw.asStringMap().orEmpty()
        val result = outer["result"].asStringMap() ?: outer
        val fallbackPrefix = tokenPrefixLength(text, line, column)
        return result["items"].asList().mapNotNull { rawItem ->
            val item = rawItem.asStringMap() ?: return@mapNotNull null
            val labelValue = item["label"]
            val label = when (labelValue) {
                is String -> labelValue
                else -> labelValue.asStringMap()?.string("label").orEmpty()
            }
            if (label.isBlank()) return@mapNotNull null
            val insertTextValue = item["insertText"]
            val insertText = when (insertTextValue) {
                is String -> insertTextValue
                else -> insertTextValue.asStringMap()?.string("snippet").orEmpty()
            }.ifBlank { label }
            NativeCompletion(
                label = label,
                detail = item.string("detail"),
                insertText = insertText,
                prefixLength = prefixLength(item["range"], line, column) ?: fallbackPrefix,
                kind = item.int("kind") ?: 1,
            )
        }
    }

    private fun prefixLength(rawRange: Any?, line: Int, column: Int): Int? {
        val range = when (rawRange) {
            is List<*> -> rawRange.firstOrNull().asStringMap()
            else -> rawRange.asStringMap()
        } ?: return null
        val startLine = range.int("startLineNumber") ?: return null
        val endLine = range.int("endLineNumber") ?: startLine
        val startColumn = range.int("startColumn") ?: return null
        val endColumn = range.int("endColumn") ?: column + 1
        if (startLine != line + 1 || endLine != line + 1 || endColumn != column + 1) return null
        return max(0, column - (startColumn - 1))
    }

    private fun tokenPrefixLength(text: String, line: Int, column: Int): Int {
        val lineText = text.lineSequence().drop(line).firstOrNull().orEmpty()
        val safeColumn = column.coerceIn(0, lineText.length)
        var start = safeColumn
        while (start > 0) {
            val ch = lineText[start - 1]
            if (!ch.isLetterOrDigit() && ch != '_' && ch != '$') break
            start -= 1
        }
        return safeColumn - start
    }

    private fun disconnectLanes() {
        editorClient?.disconnect()
        explorerClient?.disconnect()
        wbaClient?.disconnect()
        editorClient = null
        explorerClient = null
        wbaClient = null
        update {
            it.copy(
                editorConnected = false,
                explorerConnected = false,
                wbaConnected = false,
            )
        }
    }

    private fun update(transform: (NativeEditorUiState) -> NativeEditorUiState) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            mutableState.value = transform(mutableState.value)
        } else {
            mainHandler.post { mutableState.value = transform(mutableState.value) }
        }
    }

    private fun setError(message: String) {
        Log.w(TAG, message)
        update { it.copy(errorMessage = message, statusMessage = message) }
    }

    private fun projectPath(payload: Map<String, Any?>): String =
        payload.string("project")
            .ifBlank { payload.string("projectRoot") }
            .ifBlank { payload.string("root") }
            .ifBlank { payload.string("resolved_path") }
            .ifBlank { payload.string("path") }

    private fun resolveUrl(raw: String): String {
        if (raw.isBlank()) return ""
        return try {
            URI(baseUrl.trimEnd('/') + "/").resolve(raw).toString()
        } catch (_: Exception) {
            raw
        }
    }

    private fun requestId(prefix: String): String =
        "${prefix}_${System.currentTimeMillis()}_${Thread.currentThread().id}"

    private fun sha256(content: String): String = MessageDigest.getInstance("SHA-256")
        .digest(content.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun languageIdForPath(path: String): String {
        val name = path.substringAfterLast('/').lowercase()
        if (name == "dockerfile") return "dockerfile"
        if (name == "makefile") return "makefile"
        return when (name.substringAfterLast('.', "")) {
            "bat", "cmd" -> "bat"
            "c" -> "c"
            "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx" -> "cpp"
            "cs" -> "csharp"
            "css" -> "css"
            "dart" -> "dart"
            "diff", "patch" -> "diff"
            "env" -> "dotenv"
            "go" -> "go"
            "groovy" -> "groovy"
            "htm", "html" -> "html"
            "ini", "cfg" -> "ini"
            "java" -> "java"
            "js", "mjs", "cjs" -> "javascript"
            "jsx" -> "javascriptreact"
            "json" -> "json"
            "jsonc" -> "jsonc"
            "kt", "kts" -> "kotlin"
            "less" -> "less"
            "lua" -> "lua"
            "md", "mdx" -> "markdown"
            "m", "mm" -> "objective-c"
            "pl", "pm" -> "perl"
            "php" -> "php"
            "ps1" -> "powershell"
            "py", "pyi" -> "python"
            "r" -> "r"
            "rb" -> "ruby"
            "rs" -> "rust"
            "scss" -> "scss"
            "sh", "bash", "zsh" -> "shellscript"
            "sql" -> "sql"
            "swift" -> "swift"
            "toml" -> "toml"
            "ts", "mts", "cts" -> "typescript"
            "tsx" -> "typescriptreact"
            "xml", "svg" -> "xml"
            "yaml", "yml" -> "yaml"
            else -> "plaintext"
        }
    }
}

private fun Any?.asList(): List<Any?> = this as? List<Any?> ?: emptyList()

private fun Map<String, Any?>.string(key: String): String = this[key] as? String ?: ""

private fun Map<String, Any?>.int(key: String): Int? = (this[key] as? Number)?.toInt()
