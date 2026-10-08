package com.termux.extensions

import android.content.res.AssetManager

/** Consumer shell is APK-owned, independent of editor OTA. Never proxy missing pages. */
internal object TermuxShellAssets {
    const val PREFIX = "/electromux-shell/"
    const val LAUNCHER = "${PREFIX}index.html"
    private val files = setOf("index.html", "settings.html", "shell.css", "host.js",
        "chrome.html", "chrome.css", "chrome.js",
        "launcher.js", "settings.js", "electromux-platform.js", "electromux-bootstrap.js", "electromux-settings.js",
        "extensions/apps.js", "extensions/registry.js", "extensions/local-framework.js")

    fun assetPath(path: String): String? {
        if (path == "${PREFIX}electromux-bridge.js") return "electromux-bridge.js"
        if (!path.startsWith(PREFIX)) return null
        val name = path.removePrefix(PREFIX)
        return if (name in files) "electromux_shell/$name" else null
    }

    fun handle(assets: AssetManager, request: LocalHttpRequest): LocalHttpResponse? {
        if ((request.path.startsWith(PREFIX) || request.path.startsWith("/android-shell/")) &&
            request.method !in setOf("GET", "HEAD")) return LocalHttpResponse.text(405, "Method not allowed")
        // Legacy launcher URLs migrate to the APK-owned namespace, never OTA.
        if (request.path.startsWith("/android-shell/")) {
            val name = request.path.removePrefix("/android-shell/")
            if (name !in files && name != "electromux-bridge.js") return null
            if (name.endsWith(".html")) return LocalHttpResponse.text(200,
                "<!doctype html><meta http-equiv=\"refresh\" content=\"0;url=$PREFIX$name\">",
                "text/html; charset=utf-8")
            return handle(assets, request.copy(path = PREFIX + name))
        }
        if (!request.path.startsWith(PREFIX)) return null
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
