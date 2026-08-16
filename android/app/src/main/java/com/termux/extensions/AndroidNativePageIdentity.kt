package com.termux.extensions

private const val NATIVE_MARKER = "gv_native"
private const val RENDERER_MARKER = "te2_renderer"

/** Attach the renderer identity without disturbing unrelated query or fragment state. */
internal fun withAndroidNativePageIdentity(rawUrl: String, renderer: String): String {
    require(renderer.matches(Regex("[a-z0-9_-]+"))) { "invalid Android renderer name" }
    val fragmentIndex = rawUrl.indexOf('#')
    val base = if (fragmentIndex >= 0) rawUrl.substring(0, fragmentIndex) else rawUrl
    val fragment = if (fragmentIndex >= 0) rawUrl.substring(fragmentIndex) else ""
    val queryIndex = base.indexOf('?')
    val path = if (queryIndex >= 0) base.substring(0, queryIndex) else base
    val query = if (queryIndex >= 0) base.substring(queryIndex + 1) else ""
    val fields = query.split('&')
        .filter { it.isNotBlank() }
        .filterNot {
            val name = it.substringBefore('=')
            name == NATIVE_MARKER || name == RENDERER_MARKER
        }
        .toMutableList()
    fields += "$NATIVE_MARKER=1"
    fields += "$RENDERER_MARKER=$renderer"
    return "$path?${fields.joinToString("&")}$fragment"
}
