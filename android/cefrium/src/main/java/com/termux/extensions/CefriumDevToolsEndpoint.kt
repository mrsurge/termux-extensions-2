package com.termux.extensions

/** One exact process-owned name shared by Chromium's server and our relay. */
internal class CefriumDevToolsEndpoint(processId: Int) {
    init {
        require(processId > 0) { "DevTools requires a live process identity" }
    }

    // Chromium otherwise falls back to <name>_<pid> when a sibling APK already
    // owns the base socket. Connecting to that sibling is both wrong and denied
    // by Android's app security boundary. Avoid the collision before binding.
    val prefix = "te2_cefrium_$processId"
    val socketName = "${prefix}_devtools_remote"
}
