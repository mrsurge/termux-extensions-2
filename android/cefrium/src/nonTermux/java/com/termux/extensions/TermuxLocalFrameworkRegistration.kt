package com.termux.extensions

/** Existing Cefrium remains remote-only and has no Electromux dependency. */
internal object TermuxLocalFrameworkRegistration { fun install() {} }

internal class TermuxLocalPageBridge(service: PersistentNetworkService, evaluate: (String) -> Unit,
                                   currentPage: () -> String) : java.io.Closeable {
    fun beginNavigation() {}
    fun changePage(page: String?) {}
    fun pageReady() {}
    fun handle(request: String, origin: String, callback: com.cefrium.CefriumBrowser.QueryCallback) = false
    override fun close() {}
}
