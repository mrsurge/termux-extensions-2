package com.termux.extensions.nativeeditor.structure

import com.termux.extensions.rpc.asStringMap

internal object NativeEditorStructureParser {
    fun documentSymbols(raw: Any?): List<NativeEditorStructureBlock> {
        val blocks = mutableListOf<NativeEditorStructureBlock>()
        resultList(raw).forEach { parseSymbol(it, blocks) }
        return blocks.distinct().sortedWith(structureBlockComparator)
    }

    fun foldingRanges(raw: Any?, content: String): List<NativeEditorStructureBlock> {
        val lines = content.split('\n')
        return resultList(raw).mapNotNull { rawRange ->
            val range = rawRange.asStringMap() ?: return@mapNotNull null
            val start = range.int("start") ?: return@mapNotNull null
            val end = range.int("end") ?: return@mapNotNull null
            if (start < 1 || end <= start) return@mapNotNull null
            val startLine = start - 1
            val endLine = end - 1
            NativeEditorStructureBlock(
                startLine = startLine,
                startColumn = 0,
                endLine = endLine,
                endColumn = lines.getOrNull(endLine)?.length ?: 0,
            )
        }.distinct().sortedWith(structureBlockComparator)
    }

    fun merge(
        symbols: List<NativeEditorStructureBlock>,
        foldingRanges: List<NativeEditorStructureBlock>,
    ): List<NativeEditorStructureBlock> = (symbols + foldingRanges)
        .asSequence()
        .filter { it.startLine >= 0 && it.endLine > it.startLine }
        .distinct()
        .sortedWith(structureBlockComparator)
        .toList()

    private fun parseSymbol(raw: Any?, output: MutableList<NativeEditorStructureBlock>) {
        val symbol = raw.asStringMap() ?: return
        val location = symbol["location"].asStringMap()
        val range = symbol["range"].asStringMap() ?: location?.get("range").asStringMap()
        range?.toStructureBlock()?.takeIf { it.endLine > it.startLine }?.let(output::add)
        symbol["children"].asList().forEach { child -> parseSymbol(child, output) }
    }

    private fun Map<String, Any?>.toStructureBlock(): NativeEditorStructureBlock? {
        val startPosition = this["start"].asStringMap()
        val endPosition = this["end"].asStringMap()
        val startLine = int("startLineNumber")
            ?: startPosition?.int("lineNumber")
            ?: startPosition?.int("line")?.plus(1)
            ?: return null
        val endLine = int("endLineNumber")
            ?: endPosition?.int("lineNumber")
            ?: endPosition?.int("line")?.plus(1)
            ?: startLine
        val startColumn = int("startColumn")
            ?: startPosition?.int("column")
            ?: startPosition?.int("character")?.plus(1)
            ?: 1
        val endColumn = int("endColumn")
            ?: endPosition?.int("column")
            ?: endPosition?.int("character")?.plus(1)
            ?: startColumn
        if (startLine < 1 || endLine < startLine) return null
        return NativeEditorStructureBlock(
            startLine = startLine - 1,
            startColumn = (startColumn - 1).coerceAtLeast(0),
            endLine = endLine - 1,
            endColumn = (endColumn - 1).coerceAtLeast(0),
        )
    }

    private fun resultList(raw: Any?): List<Any?> {
        var value = raw
        repeat(4) {
            val map = value.asStringMap() ?: return value.asList()
            if (map["ok"] == false) return emptyList()
            if ("result" !in map) return emptyList()
            value = map["result"]
        }
        return value.asList()
    }
}

private val structureBlockComparator = compareBy<NativeEditorStructureBlock>(
    { it.startLine },
    { it.startColumn },
    { -it.endLine },
    { -it.endColumn },
)

private fun Any?.asList(): List<Any?> = this as? List<Any?> ?: emptyList()

private fun Map<String, Any?>.int(key: String): Int? = (this[key] as? Number)?.toInt()
