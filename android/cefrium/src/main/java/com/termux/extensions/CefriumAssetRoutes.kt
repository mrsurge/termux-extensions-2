package com.termux.extensions

internal object CefriumAssetRoutes {
    private val localPrefixes = listOf(
        "/static/vendor/codicons/",
        "/static/vendor/seti-icons/",
        "/static/vendor/es-module-shims/",
        "/static/vendor/codemirror.1/",
        "/static/vendor/xterm/",
        "/static/vendor/ws/",
        "/static/fonts/",
        "/static/js/",
        "/extensions/",
        "/apps/file_editor_cm6/static/icons/",
        "/apps/file_editor_cm6/static/vendor/monaco-touch-selection/",
        "/apps/file_editor_cm6/vendor/android-terminalapp-assets-js/",
        "/api/app/file_editor_cm6/static/vendor/monaco-touch-selection/",
        "/api/app/file_editor_cm6/ui/monaco_editor/textmate/",
        "/api/app/file_editor_cm6/ui/monaco_editor/themes/",
        "/api/app/file_editor_cm6/ui/monaco_vscode/lang/workers/",
    )

    private val localFiles = setOf(
        "/static/icon.png",
        "/static/move.png",
        "/static/manifest.webmanifest",
        "/static/bookmarks.json",
        "/static/vendor/socket.io.min.js",
        "/static/vendor/monaco-editor-core/te2-lang/bootstrap/monaco.bootstrap.bundle.css",
        "/static/vendor/monaco-editor-core/te2-lang/bootstrap/codicon-LN6W7LCM.ttf",
        "/static/vendor/monaco-editor-core/esm/vs/editor/common/services/editorWebWorkerMain.bundle.js",
        "/apps/file_editor_cm6/template.html",
        "/apps/by-id/file_editor_cm6/template.html",
        "/apps/file_editor_cm6/static/dist/host.js",
        "/apps/by-id/file_editor_cm6/static/dist/host.js",
        "/apps/file_editor_cm6/static/dist/host.css",
        "/apps/file_editor_cm6/static/dist/explorer.css",
        "/apps/file_editor_cm6/static/dist/explorer-highlight-github.css",
        "/apps/file_editor_cm6/static/dist/explorer-search-widget.css",
        "/apps/file_editor_cm6/static/vendor/vconsole/vconsole.min.js",
        "/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.css",
        "/api/app/file_editor_cm6/ui/monaco_vscode/esm/vs/editor/common/services/editorWebWorkerMain.bundle.js",
        "/apps/file_editor_cm6/monaco_editor/vscode_build_src/out/breadcrumbsWidget.css",
        "/apps/file_editor_cm6/monaco_editor/vscode_chat_editing_vendor/upstream/media/chatEditorController.css",
        "/apps/file_editor_cm6/monaco_editor/vscode_chat_editing_vendor/upstream/media/chatEditingEditorOverlay.css",
    )

    fun localPath(requestPath: String): String? {
        if (
            requestPath !in localFiles &&
            localPrefixes.none { requestPath.startsWith(it) }
        ) {
            return null
        }
        return when {
            requestPath == "/apps/by-id/file_editor_cm6/template.html" ->
                "/apps/file_editor_cm6/template.html"

            requestPath.startsWith("/apps/by-id/file_editor_cm6/static/") ->
                "/apps/file_editor_cm6/static/" +
                    requestPath.removePrefix("/apps/by-id/file_editor_cm6/static/")

            requestPath.startsWith("/api/app/file_editor_cm6/static/") ->
                "/apps/file_editor_cm6/static/" +
                    requestPath.removePrefix("/api/app/file_editor_cm6/static/")

            requestPath.startsWith("/api/app/file_editor_cm6/ui/monaco_vscode/lang/") ->
                "/static/vendor/monaco-editor-core/te2-lang/" +
                    requestPath.removePrefix(
                        "/api/app/file_editor_cm6/ui/monaco_vscode/lang/",
                    )

            requestPath.startsWith("/api/app/file_editor_cm6/ui/monaco_vscode/esm/") ->
                "/static/vendor/monaco-editor-core/esm/" +
                    requestPath.removePrefix(
                        "/api/app/file_editor_cm6/ui/monaco_vscode/esm/",
                    )

            requestPath.startsWith(
                "/apps/file_editor_cm6/monaco_editor/vscode_build_src/",
            ) ->
                "/api/app/file_editor_cm6/ui/monaco_editor/vscode_build_src/" +
                    requestPath.removePrefix(
                        "/apps/file_editor_cm6/monaco_editor/vscode_build_src/",
                    )

            else -> requestPath
        }
    }
}
