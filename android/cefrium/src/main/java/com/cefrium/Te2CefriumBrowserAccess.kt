package com.cefrium

import org.chromium.content_public.browser.GestureListenerManager
import org.chromium.content_public.browser.WebContents

/** Exposes Cefrium's package-private WebContents for app-owned Chromium integrations. */
object Te2CefriumBrowserAccess {
    @JvmStatic
    fun ensureWebContentsConnected(browser: CefriumBrowser) {
        browser.connectWebContentsInternal()
    }

    @JvmStatic
    fun webContents(browser: CefriumBrowser): WebContents? = browser.webContents

    @JvmStatic
    fun disablePageZoom(browser: CefriumBrowser): Boolean {
        ensureWebContentsConnected(browser)
        val webContents = browser.webContents ?: return false
        if (
            webContents.viewAndroidDelegate == null ||
            webContents.topLevelNativeWindow == null
        ) {
            return false
        }

        GestureListenerManager.fromWebContents(webContents).apply {
            updateMultiTouchZoomSupport(false)
            updateDoubleTapSupport(false)
        }
        browser.setZoomLevel(0.0)
        return true
    }
}
