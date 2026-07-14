package com.termux.extensions.nativeeditor

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeTextMateGrammarCatalogTest {
    @Test
    fun selectsPreferredWbaGrammarAndItsDeclaredInjections() {
        val catalog = NativeTextMateGrammarCatalog.parse(
            mapOf(
                "ok" to true,
                "grammars" to listOf(
                    grammar(
                        id = "vscode.markdown/markdown.json",
                        scope = "text.html.markdown",
                        language = "markdown",
                    ),
                    grammar(
                        id = "vscode.markdown-math/math.json",
                        scope = "text.html.markdown.math",
                        injectTo = listOf("text.html.markdown"),
                    ),
                ),
            ),
        )

        assertEquals(
            listOf(
                "vscode.markdown-math/math.json",
                "vscode.markdown/markdown.json",
            ),
            NativeTextMateGrammarCatalog.requiredForLanguage(catalog, "markdown").map { it.id },
        )
    }

    @Test
    fun keepsWbaGrammarIdsOpaque() {
        val id = "publisher.extension/./syntaxes/custom.tmLanguage.json"
        val catalog = NativeTextMateGrammarCatalog.parse(
            mapOf("grammars" to listOf(grammar(id, "source.custom", "custom"))),
        )

        assertEquals(id, catalog.single().id)
    }

    private fun grammar(
        id: String,
        scope: String,
        language: String? = null,
        injectTo: List<String> = emptyList(),
    ): Map<String, Any?> = mapOf(
        "id" to id,
        "scopeName" to scope,
        "language" to language,
        "extensionId" to id.substringBefore('/'),
        "injectTo" to injectTo,
    )
}
