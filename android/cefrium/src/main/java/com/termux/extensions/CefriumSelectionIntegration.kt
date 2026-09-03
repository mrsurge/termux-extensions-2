package com.termux.extensions

import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import com.cefrium.CefriumBrowser
import com.cefrium.Te2CefriumBrowserAccess
import org.chromium.content_public.browser.ActionModeCallback
import org.chromium.content_public.browser.ActionModeCallbackHelper
import org.chromium.content_public.browser.SelectionMenuItem
import org.chromium.content_public.browser.SelectionPopupController

internal class CefriumSelectionIntegration(
    private val browser: CefriumBrowser,
) {
    private val handler = Handler(Looper.getMainLooper())
    private var installedController: SelectionPopupController? = null
    private var installGeneration = 0

    fun installWhenReady() {
        val generation = ++installGeneration
        attemptInstall(generation, 0)
    }

    fun close() {
        installGeneration += 1
        handler.removeCallbacksAndMessages(null)
        installedController = null
    }

    private fun attemptInstall(generation: Int, attempt: Int) {
        if (generation != installGeneration) return
        if (install()) return
        if (attempt >= MAX_INSTALL_ATTEMPTS) return
        handler.postDelayed(
            { attemptInstall(generation, attempt + 1) },
            INSTALL_RETRY_DELAY_MS,
        )
    }

    private fun install(): Boolean {
        SelectionPopupController.setAllowSurfaceControlMagnifier()
        if (!Te2CefriumBrowserAccess.disablePageZoom(browser)) return false
        val webContents = Te2CefriumBrowserAccess.webContents(browser) ?: return false
        val controller = SelectionPopupController.fromWebContentsNoCreate(webContents)
            ?: try {
                SelectionPopupController.fromWebContents(webContents)
            } catch (_: AssertionError) {
                return false
            }
        if (controller === installedController) return true

        controller.setActionModeCallback(
            CefriumActionModeCallback(controller.actionModeCallbackHelper),
        )
        installedController = controller
        return true
    }

    private companion object {
        const val INSTALL_RETRY_DELAY_MS = 50L
        const val MAX_INSTALL_ATTEMPTS = 100
    }
}

private class CefriumActionModeCallback(
    private val helper: ActionModeCallbackHelper,
) : ActionModeCallback() {
    override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
        helper.onCreateActionMode(mode, menu)
        return true
    }

    override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean =
        helper.onPrepareActionMode(mode, menu)

    override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean =
        helper.onActionItemClicked(mode, item)

    override fun onDestroyActionMode(mode: ActionMode) {
        helper.onDestroyActionMode()
    }

    override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
        helper.onGetContentRect(mode, view, outRect)
    }

    override fun onDropdownItemClicked(item: SelectionMenuItem, finished: Boolean): Boolean {
        val handled = helper.onDropdownItemClicked(item, finished)
        if (finished) helper.dismissMenu()
        return handled
    }
}
