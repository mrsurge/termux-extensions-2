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
        assertNull(CefriumAssetRoutes.localPath("/apps/terminal/template.html"))
    }
}
