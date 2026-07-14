package com.termux.extensions.nativeeditor

internal enum class NativeEditorOverlay {
    NONE,
    EXPLORER,
    SEARCH,
    PROBLEMS,
    SIDEBAR,
}

internal data class NativeDocument(
    val path: String,
    val projectPath: String,
    val content: String,
    val baseSha256: String,
    val contentSha256: String,
    val languageId: String,
    val unsaved: Boolean,
) {
    val relativePath: String
        get() = path.removePrefix(projectPath.trimEnd('/') + "/")
}

internal data class NativeExplorerEntry(
    val name: String,
    val rel: String,
    val kind: String,
    val gitStatus: String,
    val gitFlags: List<String>,
    val hasDraft: Boolean,
) {
    val isDirectory: Boolean
        get() = kind == "dir"
}

internal data class NativeSearchResult(
    val path: String,
    val relativePath: String,
    val line: Int? = null,
    val column: Int? = null,
    val preview: String = "",
)

internal data class NativeDiagnostic(
    val path: String,
    val message: String,
    val severity: Int,
    val startLine: Int,
    val startColumn: Int,
    val endLine: Int,
    val endColumn: Int,
    val source: String,
) {
    val isError: Boolean
        get() = severity == 8
}

internal data class NativeSidebarItem(
    val hostId: String,
    val title: String,
    val url: String,
    val active: Boolean,
)

internal data class NativeSidebarCatalogItem(
    val appId: String,
    val title: String,
)

internal data class NativeEditorUiState(
    val projectPath: String = "",
    val document: NativeDocument? = null,
    val overlay: NativeEditorOverlay = NativeEditorOverlay.NONE,
    val listings: Map<String, List<NativeExplorerEntry>> = emptyMap(),
    val expandedDirectories: Set<String> = emptySet(),
    val activeFile: String = "",
    val searchMode: String = "content",
    val searchQuery: String = "",
    val searchResults: List<NativeSearchResult> = emptyList(),
    val searchRunning: Boolean = false,
    val searchId: String = "",
    val searchNextCursor: String = "",
    val projectGeneration: Int? = null,
    val diagnostics: Map<String, List<NativeDiagnostic>> = emptyMap(),
    val sidebarItems: List<NativeSidebarItem> = emptyList(),
    val sidebarCatalog: List<NativeSidebarCatalogItem> = emptyList(),
    val activeSidebarUrl: String = "",
    val editorConnected: Boolean = false,
    val explorerConnected: Boolean = false,
    val wbaConnected: Boolean = false,
    val uiConnected: Boolean = false,
    val adapterStatus: String = "idle",
    val textMateReady: Boolean = false,
    val projectSwitching: Boolean = false,
    val statusMessage: String = "Connecting to Code TE2...",
    val errorMessage: String? = null,
)
