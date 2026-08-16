package com.cefrium

import org.chromium.content_public.browser.WebContents

/** Exposes Cefrium's package-private WebContents for app-owned Chromium integrations. */
object Te2CefriumBrowserAccess {
    @JvmStatic
    fun ensureWebContentsConnected(browser: CefriumBrowser) {
        browser.connectWebContentsInternal()
    }

    @JvmStatic
    fun webContents(browser: CefriumBrowser): WebContents? = browser.webContents
}
