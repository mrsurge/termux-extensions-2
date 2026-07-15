package com.termux.extensions.nativeeditor

/**
 * Adapts VS Code completion filtering to Sora, whose completion model has no
 * filterText field. WBA remains authoritative for candidates and replacement
 * ranges; this subsystem only removes candidates that no longer match the
 * characters immediately before the cursor.
 */
internal object NativeCompletionFilter {
    fun filter(
        text: String,
        line: Int,
        column: Int,
        completions: List<NativeCompletion>,
    ): List<NativeCompletion> {
        val lineText = text.lineSequence().drop(line).firstOrNull().orEmpty()
        val safeColumn = column.coerceIn(0, lineText.length)
        return completions.filter { completion ->
            val prefixLength = completion.prefixLength.coerceIn(0, safeColumn)
            if (prefixLength == 0) {
                true
            } else {
                val prefix = lineText.substring(safeColumn - prefixLength, safeColumn)
                val candidate = completion.filterText.ifBlank { completion.label }
                characterSequenceMatches(prefix, candidate)
            }
        }
    }

    private fun characterSequenceMatches(prefix: String, candidate: String): Boolean {
        if (prefix.isEmpty()) return true
        if (candidate.startsWith(prefix, ignoreCase = true)) return true

        var prefixIndex = 0
        candidate.forEach { candidateCharacter ->
            if (candidateCharacter.equals(prefix[prefixIndex], ignoreCase = true)) {
                prefixIndex += 1
                if (prefixIndex == prefix.length) return true
            }
        }
        return false
    }
}
