package com.termux.extensions.nativeeditor.structure

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeEditorStructureParserTest {
    @Test
    fun parsesNestedDocumentSymbolsAndLocationRanges() {
        val blocks = NativeEditorStructureParser.documentSymbols(
            mapOf(
                "ok" to true,
                "result" to listOf(
                    mapOf(
                        "name" to "Outer",
                        "range" to range(1, 1, 12, 2),
                        "children" to listOf(
                            mapOf(
                                "name" to "method",
                                "location" to mapOf("range" to range(3, 5, 7, 6)),
                            ),
                        ),
                    ),
                ),
            ),
        )

        assertEquals(
            listOf(
                NativeEditorStructureBlock(0, 0, 11, 1),
                NativeEditorStructureBlock(2, 4, 6, 5),
            ),
            blocks,
        )
    }

    @Test
    fun parsesZeroBasedNestedPositionShape() {
        val blocks = NativeEditorStructureParser.documentSymbols(
            mapOf(
                "result" to listOf(
                    mapOf(
                        "range" to mapOf(
                            "start" to mapOf("line" to 2, "character" to 4),
                            "end" to mapOf("line" to 8, "character" to 1),
                        ),
                    ),
                ),
            ),
        )

        assertEquals(listOf(NativeEditorStructureBlock(2, 4, 8, 1)), blocks)
    }

    @Test
    fun foldingRangesUseOneBasedInclusiveLinesAndMergeWithoutDuplicates() {
        val folding = NativeEditorStructureParser.foldingRanges(
            raw = mapOf(
                "ok" to true,
                "result" to listOf(
                    mapOf("start" to 2, "end" to 4, "kind" to "region"),
                    mapOf("start" to 4, "end" to 4),
                ),
            ),
            content = "one\ntwo\nthree\nfour",
        )
        val symbol = NativeEditorStructureBlock(1, 0, 3, 4)

        assertEquals(listOf(symbol), NativeEditorStructureParser.merge(listOf(symbol), folding))
    }

    private fun range(
        startLine: Int,
        startColumn: Int,
        endLine: Int,
        endColumn: Int,
    ) = mapOf(
        "startLineNumber" to startLine,
        "startColumn" to startColumn,
        "endLineNumber" to endLine,
        "endColumn" to endColumn,
    )
}
