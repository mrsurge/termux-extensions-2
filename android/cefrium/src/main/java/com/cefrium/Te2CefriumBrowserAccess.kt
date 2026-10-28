package com.cefrium

import org.chromium.content_public.browser.GestureListenerManager
import org.chromium.content_public.browser.HostZoomMap
import org.chromium.content_public.browser.WebContents

/** Exposes Cefrium's package-private WebContents for app-owned Chromium integrations. */
object Te2CefriumBrowserAccess {
    @JvmStatic
    fun ensureWebContentsConnected(browser: CefriumBrowser) {
        browser.connectWebContentsInternal()
    }

    @JvmStatic
    fun webContents(browser: CefriumBrowser): WebContents? = browser.webContents

    /** Actual Chromium hard reload; CefriumBrowser.reload() uses CefBrowser::Reload. */
    @JvmStatic
    fun reloadBypassingCache(browser: CefriumBrowser): Boolean {
        val contents = browser.webContents ?: return false
        if (contents.isDestroyed) return false
        contents.navigationController.reloadBypassingCache(true)
        return true
    }

    @JvmStatic
    fun disableGestureZoom(browser: CefriumBrowser): Boolean {
        ensureWebContentsConnected(browser)
        val webContents = browser.webContents ?: return false
        if (webContents.isDestroyed) return false
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
        return true
    }

    /** Chrome Android accessibility page zoom, not CefBrowserHost desktop zoom. */
    @JvmStatic
    fun setAccessibilityPageZoom(browser: CefriumBrowser, level: Double): Boolean {
        if (!disableGestureZoom(browser)) return false
        val webContents = browser.webContents ?: return false
        HostZoomMap.setZoomLevel(webContents, level)
        return true
    }
}
