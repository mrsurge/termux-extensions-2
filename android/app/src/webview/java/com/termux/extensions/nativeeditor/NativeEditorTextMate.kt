package com.termux.extensions.nativeeditor

import android.util.Log
import io.github.rosemoe.sora.lang.EmptyLanguage
import io.github.rosemoe.sora.lang.Language
import io.github.rosemoe.sora.lang.completion.CompletionItemKind
import io.github.rosemoe.sora.lang.completion.CompletionPublisher
import io.github.rosemoe.sora.lang.completion.SimpleCompletionItem
import io.github.rosemoe.sora.langs.textmate.TextMateColorScheme
import io.github.rosemoe.sora.langs.textmate.TextMateLanguage
import io.github.rosemoe.sora.langs.textmate.registry.GrammarRegistry
import io.github.rosemoe.sora.langs.textmate.registry.ThemeRegistry
import io.github.rosemoe.sora.langs.textmate.registry.model.DefaultGrammarDefinition
import io.github.rosemoe.sora.langs.textmate.registry.model.GrammarDefinition
import io.github.rosemoe.sora.langs.textmate.registry.model.ThemeModel
import io.github.rosemoe.sora.text.CharPosition
import io.github.rosemoe.sora.text.ContentReference
import io.github.rosemoe.sora.widget.schemes.EditorColorScheme
import org.json.JSONArray
import org.json.JSONObject
import org.eclipse.tm4e.core.registry.IGrammarSource
import org.eclipse.tm4e.core.registry.IThemeSource
import java.io.ByteArrayInputStream
import java.io.File
import java.util.concurrent.ConcurrentHashMap

internal data class NativeCompletion(
    val label: String,
    val detail: String,
    val insertText: String,
    val prefixLength: Int,
    val kind: Int,
    val filterText: String,
    val sortText: String,
)

/**
 * WBA owns the extension-host grammar catalog and grammar bodies. Android owns
 * only the Sora/TM4E adaptation and the locally published visual theme.
 */
internal class NativeEditorTextMate(private val assetRoot: File) {
    companion object {
        private const val TAG = "NativeEditorTextMate"
        private const val THEME_PATH =
            "api/app/file_editor_cm6/ui/monaco_editor/textmate/themes/" +
                "github-dark-default.vscode.json"
        private const val NATIVE_THEME_NAME = "github-dark-default-native"
    }

    private val registryLock = Any()
    private val scopeByLanguage = ConcurrentHashMap<String, String>()
    private val loadedScopes = ConcurrentHashMap.newKeySet<String>()

    @Volatile
    private var registry = GrammarRegistry(GrammarRegistry.getInstance())

    fun resetSession() {
        synchronized(registryLock) {
            registry = GrammarRegistry(GrammarRegistry.getInstance())
            scopeByLanguage.clear()
            loadedScopes.clear()
        }
    }

    fun isReady(languageId: String): Boolean = scopeByLanguage.containsKey(languageId)

    fun installLanguage(
        languageId: String,
        descriptors: List<NativeTextMateGrammarDescriptor>,
        bodiesById: Map<String, String>,
    ) {
        check(descriptors.isNotEmpty()) { "WBA returned no TextMate grammar for $languageId" }
        val primary = descriptors.lastOrNull { it.language == languageId }
            ?: descriptors.last()
        synchronized(registryLock) {
            val definitions = descriptors
                .distinctBy { it.scopeName }
                .filterNot { it.scopeName in loadedScopes }
                .map { descriptor ->
                    grammarDefinition(
                        descriptor,
                        bodiesById[descriptor.id]
                            ?: error("WBA grammar body is missing: ${descriptor.id}"),
                    )
                }
            if (definitions.isNotEmpty()) {
                registry.loadGrammars(definitions)
                loadedScopes.addAll(descriptors.map { it.scopeName })
            }
            check(registry.findGrammar(primary.scopeName, false) != null) {
                "WBA grammar did not register scope ${primary.scopeName}"
            }
            loadTheme(registry)
            scopeByLanguage[languageId] = primary.scopeName
        }
        Log.i(
            TAG,
            "WBA TextMate ready language=$languageId scope=${primary.scopeName} " +
                "grammars=${descriptors.size}",
        )
    }

    fun install(): EditorColorScheme? {
        if (scopeByLanguage.isEmpty()) return null
        return try {
            TextMateColorScheme.create(ThemeRegistry.getInstance())
        } catch (error: Exception) {
            Log.w(TAG, "Unable to create TextMate color scheme", error)
            null
        }
    }

    fun language(
        languageId: String,
        completionProvider: (String, Int, Int, String) -> List<NativeCompletion>,
    ): Language {
        val base = synchronized(registryLock) {
            val scope = scopeByLanguage[languageId]
            if (scope == null) {
                EmptyLanguage()
            } else {
                try {
                    TextMateLanguage.create(scope, registry, false)
                } catch (error: Exception) {
                    Log.w(TAG, "Unable to activate WBA TextMate scope=$scope", error)
                    EmptyLanguage()
                }
            }
        }
        return object : Language by base {
            override fun requireAutoComplete(
                content: ContentReference,
                position: CharPosition,
                publisher: CompletionPublisher,
                extraArguments: android.os.Bundle,
            ) {
                val text = content.reference.toString()
                NativeCompletionFilter.filter(
                    text,
                    position.line,
                    position.column,
                    completionProvider(text, position.line, position.column, languageId),
                )
                    .forEach { completion ->
                        val item = SimpleCompletionItem(
                            completion.label,
                            completion.detail,
                            completion.prefixLength,
                            completion.insertText,
                        ).kind(completionKind(completion.kind))
                        item.sortText = completion.sortText.ifBlank { completion.label }
                        publisher.addItem(item)
                    }
            }

            override fun destroy() {
                base.destroy()
            }
        }
    }

    fun debugSnapshot(): Map<String, Any?> = mapOf(
        "readyLanguages" to scopeByLanguage.keys.sorted(),
        "scopes" to scopeByLanguage.toSortedMap(),
        "loadedScopeCount" to loadedScopes.size,
    )

    private fun grammarDefinition(
        descriptor: NativeTextMateGrammarDescriptor,
        raw: String,
    ): GrammarDefinition = DefaultGrammarDefinition.withGrammarSource(
        IGrammarSource.fromString(grammarContentType(descriptor.id, raw), raw),
        descriptor.id,
        descriptor.scopeName,
    )

    private fun grammarContentType(id: String, raw: String): IGrammarSource.ContentType {
        val normalized = id.lowercase()
        return when {
            normalized.endsWith(".yaml") || normalized.endsWith(".yml") ->
                IGrammarSource.ContentType.YAML
            raw.trimStart().startsWith("<") -> IGrammarSource.ContentType.XML
            else -> IGrammarSource.ContentType.JSON
        }
    }

    private fun loadTheme(targetRegistry: GrammarRegistry) {
        val themeRegistry = ThemeRegistry.getInstance()
        var model = themeRegistry.findThemeByThemeName(NATIVE_THEME_NAME)
        if (model == null) {
            val theme = File(assetRoot, THEME_PATH)
            check(theme.isFile) { "GitHub Dark Default TextMate theme is missing: $theme" }
            val normalizedTheme = normalizeTheme(theme.readText(Charsets.UTF_8))
            model = ThemeModel(
                IThemeSource.fromInputStream(
                    ByteArrayInputStream(normalizedTheme.toByteArray(Charsets.UTF_8)),
                    theme.absolutePath,
                    Charsets.UTF_8,
                ),
                NATIVE_THEME_NAME,
            ).apply { isDark = true }
            themeRegistry.loadTheme(model)
        }
        themeRegistry.setTheme(model)
        targetRegistry.setTheme(model)
    }

    private fun normalizeTheme(raw: String): String {
        val theme = JSONObject(raw)
        val colors = theme.optJSONObject("colors") ?: JSONObject()
        val foreground = colors.optString("editor.foreground")
            .ifBlank { colors.optString("foreground") }
        val background = colors.optString("editor.background")
        check(foreground.isNotBlank()) { "TextMate theme has no editor foreground" }
        check(background.isNotBlank()) { "TextMate theme has no editor background" }

        val sourceRules = theme.optJSONArray("tokenColors") ?: JSONArray()
        val normalizedRules = JSONArray().put(
            JSONObject().put(
                "settings",
                JSONObject()
                    .put("foreground", foreground)
                    .put("background", background),
            ),
        )
        for (index in 0 until sourceRules.length()) {
            normalizedRules.put(sourceRules.get(index))
        }
        theme.put("tokenColors", normalizedRules)
        return theme.toString()
    }

    private fun completionKind(kind: Int): CompletionItemKind = when (kind) {
        2 -> CompletionItemKind.Method
        3 -> CompletionItemKind.Function
        4 -> CompletionItemKind.Constructor
        5 -> CompletionItemKind.Field
        6 -> CompletionItemKind.Variable
        7 -> CompletionItemKind.Class
        8 -> CompletionItemKind.Interface
        9 -> CompletionItemKind.Module
        10 -> CompletionItemKind.Property
        11 -> CompletionItemKind.Unit
        12 -> CompletionItemKind.Value
        13 -> CompletionItemKind.Enum
        14 -> CompletionItemKind.Keyword
        15 -> CompletionItemKind.Snippet
        16 -> CompletionItemKind.Color
        17 -> CompletionItemKind.File
        18 -> CompletionItemKind.Reference
        19 -> CompletionItemKind.Folder
        20 -> CompletionItemKind.EnumMember
        21 -> CompletionItemKind.Constant
        22 -> CompletionItemKind.Struct
        23 -> CompletionItemKind.Event
        24 -> CompletionItemKind.Operator
        25 -> CompletionItemKind.TypeParameter
        else -> CompletionItemKind.Text
    }
}
