package com.termux.extensions.nativeeditor.explorer

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

internal data class NativeExplorerUiState(
    val listings: Map<String, List<NativeExplorerEntry>> = emptyMap(),
    val expandedDirectories: Set<String> = emptySet(),
    val activeFile: String = "",
)

internal data class NativeExplorerProjection(
    val listings: Map<String, List<NativeExplorerEntry>>,
    val expandedDirectories: Set<String>,
)
