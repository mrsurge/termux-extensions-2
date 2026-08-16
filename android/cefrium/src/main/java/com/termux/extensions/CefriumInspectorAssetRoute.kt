package com.termux.extensions

import android.content.res.AssetManager
import java.io.IOException

/** Serves the packaged Inspector tree from Cefrium's trusted loopback origin. */
internal object CefriumInspectorAssetRoute {
    const val PATH_PREFIX = "/android-cefrium-devtools/"
    const val DOCUMENT_PATH = "${PATH_PREFIX}inspector.html"

    fun handle(
        assets: AssetManager,
        request: LocalHttpRequest,
    ): LocalHttpResponse? {
        if (!request.path.startsWith(PATH_PREFIX)) return null
        if (request.method != "GET" && request.method != "HEAD") {
            return LocalHttpResponse.text(405, "405 Method Not Allowed")
        }

        val relativePath = request.path.removePrefix(PATH_PREFIX)
        if (
            relativePath.isBlank() ||
            relativePath.split('/').any { it.isBlank() || it == "." || it == ".." }
        ) {
            return LocalHttpResponse.text(404, "404 Not Found")
        }

        val body = try {
            assets.open("devtools_inspector/$relativePath", AssetManager.ACCESS_STREAMING)
                .use { it.readBytes() }
        } catch (_: IOException) {
            return LocalHttpResponse.text(404, "404 Not Found")
        }
        return LocalHttpResponse(
            status = 200,
            contentType = contentType(relativePath),
            body = body,
            cacheControl = "no-store",
        )
    }

    private fun contentType(path: String): String = when (path.substringAfterLast('.', "")) {
        "avif" -> "image/avif"
        "css" -> "text/css; charset=utf-8"
        "gif" -> "image/gif"
        "html" -> "text/html; charset=utf-8"
        "ico" -> "image/x-icon"
        "js", "mjs" -> "text/javascript; charset=utf-8"
        "json", "map" -> "application/json; charset=utf-8"
        "png" -> "image/png"
        "svg" -> "image/svg+xml"
        "wasm" -> "application/wasm"
        "webp" -> "image/webp"
        "woff" -> "font/woff"
        "woff2" -> "font/woff2"
        else -> "application/octet-stream"
    }
}
