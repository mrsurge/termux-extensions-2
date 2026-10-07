package com.termux.extensions

import android.content.res.AssetManager

/** Consumer shell is APK-owned, independent of editor OTA. Never proxy missing pages. */
internal object TermuxShellAssets {
    private val files = setOf("index.html", "settings.html", "shell.css", "host.js",
        "launcher.js", "settings.js", "electromux-platform.js", "electromux-bootstrap.js",
        "extensions/apps.js", "extensions/registry.js", "extensions/local-framework.js")

    fun assetPath(path: String): String? {
        if (path == "/android-shell/electromux-bridge.js") return "electromux-bridge.js"
        if (!path.startsWith("/android-shell/")) return null
        val name = path.removePrefix("/android-shell/")
        return if (name in files) "electromux_shell/$name" else null
    }

    fun handle(assets: AssetManager, request: LocalHttpRequest): LocalHttpResponse? {
        if (!request.path.startsWith("/android-shell/")) return null
        if (request.method !in setOf("GET", "HEAD")) return LocalHttpResponse.text(405, "Method not allowed")
        val path = assetPath(request.path) ?: return LocalHttpResponse.text(404, "Unknown consumer asset")
        return try {
            val type = when {
                path.endsWith(".html") -> "text/html; charset=utf-8"
                path.endsWith(".css") -> "text/css; charset=utf-8"
                else -> "application/javascript; charset=utf-8"
            }
            LocalHttpResponse.text(200, assets.open(path).bufferedReader(Charsets.UTF_8).use { it.readText() }, type)
        } catch (_: java.io.IOException) { LocalHttpResponse.text(404, "Consumer asset missing from APK") }
    }
}
