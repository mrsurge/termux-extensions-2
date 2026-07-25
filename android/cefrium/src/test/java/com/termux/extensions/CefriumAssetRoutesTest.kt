package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CefriumAssetRoutesTest {
    @Test
    fun mapsFrameworkAliasesIntoTheInstalledAssetTree() {
        assertEquals(
            "/apps/file_editor_cm6/template.html",
            CefriumAssetRoutes.localPath("/apps/by-id/file_editor_cm6/template.html"),
        )
        assertEquals(
            "/apps/file_editor_cm6/static/vendor/monaco-touch-selection/style.css",
            CefriumAssetRoutes.localPath(
                "/api/app/file_editor_cm6/static/vendor/monaco-touch-selection/style.css",
            ),
        )
        assertEquals(
            "/static/vendor/monaco-editor-core/te2-lang/workers/editor.worker.js",
            CefriumAssetRoutes.localPath(
                "/api/app/file_editor_cm6/ui/monaco_vscode/lang/workers/editor.worker.js",
            ),
        )
    }

    @Test
    fun rejectsDynamicAndUndeclaredFrameworkPaths() {
        assertNull(CefriumAssetRoutes.localPath("/api/apps/catalog"))
        assertNull(CefriumAssetRoutes.localPath("/api/app/file_editor_cm6/socket.io"))
        assertNull(CefriumAssetRoutes.localPath("/apps/terminal/template.html"))
    }
}
