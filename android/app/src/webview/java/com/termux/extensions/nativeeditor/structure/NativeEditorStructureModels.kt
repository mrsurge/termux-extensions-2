package com.termux.extensions.nativeeditor.structure

internal data class NativeEditorStructureBlock(
    val startLine: Int,
    val startColumn: Int,
    val endLine: Int,
    val endColumn: Int,
)
