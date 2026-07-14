package com.termux.extensions.nativeeditor

import com.termux.extensions.rpc.asStringMap

internal data class NativeTextMateGrammarDescriptor(
    val id: String,
    val scopeName: String,
    val language: String?,
    val extensionId: String,
    val injectTo: List<String>,
)

/** Converts the WBA extension-host grammar catalog into native load targets. */
internal object NativeTextMateGrammarCatalog {
    private val preferredScopes = mapOf(
        "bat" to "source.batchfile",
        "c" to "source.c",
        "cpp" to "source.cpp",
        "csharp" to "source.cs",
        "css" to "source.css",
        "dart" to "source.dart",
        "diff" to "source.diff",
        "dockerfile" to "source.dockerfile",
        "dotenv" to "source.dotenv",
        "go" to "source.go",
        "groovy" to "source.groovy",
        "html" to "text.html.basic",
        "ini" to "source.ini",
        "java" to "source.java",
        "javascript" to "source.js",
        "javascriptreact" to "source.js.jsx",
        "json" to "source.json",
        "jsonc" to "source.json.comments",
        "kotlin" to "source.kotlin",
        "less" to "source.css.less",
        "lua" to "source.lua",
        "makefile" to "source.makefile",
        "markdown" to "text.html.markdown",
        "objective-c" to "source.objc",
        "perl" to "source.perl",
        "php" to "source.php",
        "powershell" to "source.powershell",
        "python" to "source.python",
        "r" to "source.r",
        "ruby" to "source.ruby",
        "rust" to "source.rust",
        "scss" to "source.css.scss",
        "shellscript" to "source.shell",
        "sql" to "source.sql",
        "swift" to "source.swift",
        "toml" to "source.toml",
        "typescript" to "source.ts",
        "typescriptreact" to "source.tsx",
        "xml" to "text.xml",
        "yaml" to "source.yaml",
    )

    fun parse(value: Any?): List<NativeTextMateGrammarDescriptor> {
        val outer = value.asStringMap().orEmpty()
        val payload = outer["result"].asStringMap() ?: outer
        val grammars = payload["grammars"] as? List<*> ?: return emptyList()
        return grammars.mapNotNull { raw ->
            val item = raw.asStringMap() ?: return@mapNotNull null
            val id = item["id"] as? String ?: return@mapNotNull null
            val scopeName = item["scopeName"] as? String ?: return@mapNotNull null
            if (id.isBlank() || scopeName.isBlank()) return@mapNotNull null
            NativeTextMateGrammarDescriptor(
                id = id,
                scopeName = scopeName,
                language = (item["language"] as? String)?.takeIf(String::isNotBlank),
                extensionId = item["extensionId"] as? String ?: "unknown",
                injectTo = (item["injectTo"] as? List<*>)
                    .orEmpty()
                    .mapNotNull { it as? String }
                    .filter(String::isNotBlank),
            )
        }
    }

    fun requiredForLanguage(
        catalog: List<NativeTextMateGrammarDescriptor>,
        languageId: String,
    ): List<NativeTextMateGrammarDescriptor> {
        val candidates = catalog.filter { it.language == languageId }
        val preferredScope = preferredScopes[languageId]
        val primary = candidates.firstOrNull { it.scopeName == preferredScope }
            ?: candidates.firstOrNull()
            ?: preferredScope?.let { scope -> catalog.firstOrNull { it.scopeName == scope } }
            ?: return emptyList()
        val injections = catalog.filter { primary.scopeName in it.injectTo }
        return (injections + primary).distinctBy { "${it.id}\u0000${it.scopeName}" }
    }
}
