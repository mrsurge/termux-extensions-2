package com.termux.extensions.nativeeditor

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeCompletionFilterTest {
    @Test
    fun filtersAgainstWbaFilterTextAndFallsBackToLabel() {
        val completions = listOf(
            completion(label = "Map", filterText = "mapping"),
            completion(label = "maximum"),
            completion(label = "minimum"),
        )

        assertEquals(
            listOf("Map", "maximum"),
            NativeCompletionFilter.filter("ma", 0, 2, completions).map { it.label },
        )
    }

    @Test
    fun supportsOrderedCharacterMatchingForCompactPrefixes() {
        val completions = listOf(
            completion(label = "frameworkBaseUrl"),
            completion(label = "frameworkPort"),
            completion(label = "foreground"),
        )

        assertEquals(
            listOf("frameworkBaseUrl"),
            NativeCompletionFilter.filter("fbu", 0, 3, completions).map { it.label },
        )
    }

    @Test
    fun usesEachCompletionReplacementPrefix() {
        val completions = listOf(
            completion(label = "print", prefixLength = 2),
            completion(label = "map", prefixLength = 1),
        )

        assertEquals(
            listOf("print"),
            NativeCompletionFilter.filter("pri", 0, 3, completions).map { it.label },
        )
    }

    private fun completion(
        label: String,
        filterText: String = "",
        prefixLength: Int = 2,
    ): NativeCompletion = NativeCompletion(
        label = label,
        detail = "",
        insertText = label,
        prefixLength = prefixLength,
        kind = 1,
        filterText = filterText,
        sortText = label,
    )
}
