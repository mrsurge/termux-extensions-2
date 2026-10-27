package com.termux.extensions

/** Static-only aliases shared by the native relay and Gecko's local asset server. */
internal object AlsProxyAssets {
    private const val PROXY_STATIC = "/api/app/als-rs/proxy/static/"
    private const val LOCAL_STATIC = "/apps/als_rs/frontend/static/"
    private const val CODEX_REQUEST_CARD = "/api/app/als-rs/proxy/api/extensions/codex/assets/ui/request_cards/codex_ext_request_card.js"
    private const val LOCAL_CODEX_REQUEST_CARD = "/apps/als_rs/frontend/static/extensions/codex/ui/request_cards/codex_ext_request_card.js"

    fun localPath(requestPath: String): String? = when {
        requestPath == CODEX_REQUEST_CARD -> LOCAL_CODEX_REQUEST_CARD
        requestPath.startsWith(PROXY_STATIC) -> LOCAL_STATIC + requestPath.removePrefix(PROXY_STATIC)
        requestPath.startsWith(LOCAL_STATIC) -> requestPath
        else -> null
    }
}
