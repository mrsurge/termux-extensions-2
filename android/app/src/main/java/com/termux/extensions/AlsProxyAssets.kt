package com.termux.extensions

/** Static-only aliases shared by the native relay and Gecko's local asset server. */
internal object AlsProxyAssets {
    private const val PROXY_STATIC = "/api/app/als-rs/proxy/static/"
    private const val LOCAL_STATIC = "/apps/als_rs/frontend/static/"

    fun localPath(requestPath: String): String? = when {
        requestPath.startsWith(PROXY_STATIC) -> LOCAL_STATIC + requestPath.removePrefix(PROXY_STATIC)
        requestPath.startsWith(LOCAL_STATIC) -> requestPath
        else -> null
    }
}
