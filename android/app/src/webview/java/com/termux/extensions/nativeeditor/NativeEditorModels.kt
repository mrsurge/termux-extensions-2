package com.termux.extensions.nativeeditor

import com.termux.extensions.nativeeditor.structure.NativeEditorStructureBlock

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
    val kind: String,
    val appId: String,
    val stateful: Boolean,
    val load: String,
    val readinessStatus: String,
    val readinessMessage: String,
)

internal data class NativeSidebarCatalogItem(
    val appId: String,
    val title: String,
)

internal data class NativeEditorUiState(
    val projectPath: String = "",
    val document: NativeDocument? = null,
    val overlay: NativeEditorOverlay = NativeEditorOverlay.NONE,
    val searchMode: String = "content",
    val searchQuery: String = "",
    val searchResults: List<NativeSearchResult> = emptyList(),
    val searchRunning: Boolean = false,
    val searchId: String = "",
    val searchNextCursor: String = "",
    val projectGeneration: Int? = null,
    val diagnostics: Map<String, List<NativeDiagnostic>> = emptyMap(),
    val structureBlocks: List<NativeEditorStructureBlock> = emptyList(),
    val sidebarItems: List<NativeSidebarItem> = emptyList(),
    val sidebarCatalog: List<NativeSidebarCatalogItem> = emptyList(),
    val activeSidebarUrl: String = "",
    val sidebarLoadedUrls: Map<String, String> = emptyMap(),
    val sidebarLoading: Boolean = false,
    val sidebarMessage: String = "Select a sidebar app",
    val sidebarError: String? = null,
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
