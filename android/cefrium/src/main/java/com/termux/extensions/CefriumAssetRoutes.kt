package com.termux.extensions

internal object CefriumAssetRoutes {
    // Exact built-in resources only; never intercept dynamic /apps or API trees.
    private val builtInAppAssets = mapOf(
        "/apps/als_rs/template.html" to "/apps/als_rs/template.html",
        "/apps/by-id/als-rs/template.html" to "/apps/als_rs/template.html",
        "/apps/als_rs/main.js" to "/apps/als_rs/main.js",
        "/apps/by-id/als-rs/main.js" to "/apps/als_rs/main.js",
        "/apps/archive_manager/template.html" to "/apps/archive_manager/template.html",
        "/apps/by-id/archive_manager/template.html" to "/apps/archive_manager/template.html",
        "/apps/archive_manager/main.js" to "/apps/archive_manager/main.js",
        "/apps/by-id/archive_manager/main.js" to "/apps/archive_manager/main.js",
        "/apps/aria_downloader/template.html" to "/apps/aria_downloader/template.html",
        "/apps/by-id/aria_downloader/template.html" to "/apps/aria_downloader/template.html",
        "/apps/aria_downloader/main.js" to "/apps/aria_downloader/main.js",
        "/apps/by-id/aria_downloader/main.js" to "/apps/aria_downloader/main.js",
        "/apps/file_editor/template.html" to "/apps/file_editor/template.html",
        "/apps/by-id/file_editor/template.html" to "/apps/file_editor/template.html",
        "/apps/file_editor/main.js" to "/apps/file_editor/main.js",
        "/apps/by-id/file_editor/main.js" to "/apps/file_editor/main.js",
        "/apps/file_explorer/template.html" to "/apps/file_explorer/template.html",
        "/apps/by-id/file_explorer/template.html" to "/apps/file_explorer/template.html",
        "/apps/file_explorer/main.js" to "/apps/file_explorer/main.js",
        "/apps/by-id/file_explorer/main.js" to "/apps/file_explorer/main.js",
        "/apps/settings/template.html" to "/apps/settings/template.html",
        "/apps/by-id/settings/template.html" to "/apps/settings/template.html",
        "/apps/settings/main.js" to "/apps/settings/main.js",
        "/apps/by-id/settings/main.js" to "/apps/settings/main.js",
        "/apps/terminal/template.html" to "/apps/terminal/template.html",
        "/apps/by-id/terminal/template.html" to "/apps/terminal/template.html",
        "/apps/terminal/static/dist/main.js" to "/apps/terminal/static/dist/main.js",
        "/apps/by-id/terminal/static/dist/main.js" to "/apps/terminal/static/dist/main.js",
    )
    private val localPrefixes = listOf(
        "/apps/terminal/vendor/android-terminalapp-assets-js/",
        "/apps/by-id/terminal/vendor/android-terminalapp-assets-js/",
        "/static/vendor/codicons/",
        "/static/vendor/seti-icons/",
        "/static/vendor/es-module-shims/",
        "/static/vendor/codemirror.1/",
        "/static/vendor/xterm/",
        "/static/vendor/ws/",
        "/static/fonts/",
        "/static/js/",
        "/extensions/",
        "/apps/code_te2/static/icons/",
        "/apps/code_te2/static/vendor/monaco-touch-selection/",
        "/apps/code_te2/vendor/android-terminalapp-assets-js/",
        "/api/app/code_te2/static/vendor/monaco-touch-selection/",
        "/api/app/code_te2/ui/monaco_editor/textmate/",
        "/api/app/code_te2/ui/monaco_editor/themes/",
        "/api/app/code_te2/ui/monaco_vscode/lang/workers/",
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
        "/apps/code_te2/template.html",
        "/apps/by-id/code_te2/template.html",
        "/apps/code_te2/static/dist/host.js",
        "/apps/by-id/code_te2/static/dist/host.js",
        "/apps/code_te2/static/dist/host.css",
        "/apps/code_te2/static/dist/explorer.css",
        "/apps/code_te2/static/dist/explorer-search-widget.css",
        "/apps/code_te2/static/vendor/vconsole/vconsole.min.js",
        "/api/app/code_te2/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.css",
        "/api/app/code_te2/ui/monaco_vscode/esm/vs/editor/common/services/editorWebWorkerMain.bundle.js",
        "/apps/code_te2/monaco_editor/vscode_build_src/out/breadcrumbsWidget.css",
        "/apps/code_te2/monaco_editor/vscode_chat_editing_vendor/upstream/media/chatEditorController.css",
        "/apps/code_te2/monaco_editor/vscode_chat_editing_vendor/upstream/media/chatEditingEditorOverlay.css",
    )

    fun localPath(requestPath: String): String? {
        AlsProxyAssets.localPath(requestPath)?.let { return it }
        builtInAppAssets[requestPath]?.let { return it }
        if (
            requestPath !in localFiles &&
            localPrefixes.none { requestPath.startsWith(it) }
        ) {
            return null
        }
        return when {
            requestPath.startsWith("/apps/by-id/terminal/vendor/android-terminalapp-assets-js/") ->
                "/apps/terminal/vendor/android-terminalapp-assets-js/" +
                    requestPath.removePrefix("/apps/by-id/terminal/vendor/android-terminalapp-assets-js/")

            requestPath == "/apps/by-id/code_te2/template.html" ->
                "/apps/code_te2/template.html"

            requestPath.startsWith("/apps/by-id/code_te2/static/") ->
                "/apps/code_te2/static/" +
                    requestPath.removePrefix("/apps/by-id/code_te2/static/")

            requestPath.startsWith("/api/app/code_te2/static/") ->
                "/apps/code_te2/static/" +
                    requestPath.removePrefix("/api/app/code_te2/static/")

            requestPath.startsWith("/api/app/code_te2/ui/monaco_vscode/lang/") ->
                "/static/vendor/monaco-editor-core/te2-lang/" +
                    requestPath.removePrefix(
                        "/api/app/code_te2/ui/monaco_vscode/lang/",
                    )

            requestPath.startsWith("/api/app/code_te2/ui/monaco_vscode/esm/") ->
                "/static/vendor/monaco-editor-core/esm/" +
                    requestPath.removePrefix(
                        "/api/app/code_te2/ui/monaco_vscode/esm/",
                    )

            requestPath.startsWith(
                "/apps/code_te2/monaco_editor/vscode_build_src/",
            ) ->
                "/api/app/code_te2/ui/monaco_editor/vscode_build_src/" +
                    requestPath.removePrefix(
                        "/apps/code_te2/monaco_editor/vscode_build_src/",
                    )

            else -> requestPath
        }
    }
}
