package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CefriumAssetRoutesTest {
    @Test
    fun mapsFrameworkAliasesIntoTheInstalledAssetTree() {
        assertEquals(
            "/apps/code_te2/template.html",
            CefriumAssetRoutes.localPath("/apps/by-id/code_te2/template.html"),
        )
        assertEquals(
            "/apps/code_te2/static/vendor/monaco-touch-selection/style.css",
            CefriumAssetRoutes.localPath(
                "/api/app/code_te2/static/vendor/monaco-touch-selection/style.css",
            ),
        )
        assertEquals(
            "/static/vendor/monaco-editor-core/te2-lang/workers/editor.worker.js",
            CefriumAssetRoutes.localPath(
                "/api/app/code_te2/ui/monaco_vscode/lang/workers/editor.worker.js",
            ),
        )
    }

    @Test
    fun rejectsDynamicAndUndeclaredFrameworkPaths() {
        assertNull(CefriumAssetRoutes.localPath("/api/apps/catalog"))
        assertNull(CefriumAssetRoutes.localPath("/api/app/code_te2/socket.io"))
        assertNull(CefriumAssetRoutes.localPath("/apps/file_explorer/file_explorer.py"))
        assertNull(CefriumAssetRoutes.localPath("/apps/by-id/custom/main.js"))
        assertNull(CefriumAssetRoutes.localPath("/apps/code_te2/static/dist/explorer-highlight-github.css"))
    }

    @Test
    fun mapsAllBuiltInEntrypointsWithoutOpeningDynamicTrees() {
        val apps = mapOf("als-rs" to "als_rs", "archive_manager" to "archive_manager", "aria_downloader" to "aria_downloader", "file_editor" to "file_editor", "file_explorer" to "file_explorer", "settings" to "settings", "terminal" to "terminal")
        for ((id, directory) in apps) {
            val script = if (id == "terminal") "static/dist/main.js" else "main.js"
            for (file in listOf("template.html", script)) {
                val canonical = "/apps/$directory/$file"
                assertEquals(canonical, CefriumAssetRoutes.localPath(canonical))
                assertEquals(canonical, CefriumAssetRoutes.localPath("/apps/by-id/$id/$file"))
            }
        }
        assertEquals("/apps/terminal/vendor/android-terminalapp-assets-js/ctrl_key_handler.js", CefriumAssetRoutes.localPath("/apps/by-id/terminal/vendor/android-terminalapp-assets-js/ctrl_key_handler.js"))
        assertEquals("/static/js/file_explorer_main.js", CefriumAssetRoutes.localPath("/static/js/file_explorer_main.js"))
    }
}
