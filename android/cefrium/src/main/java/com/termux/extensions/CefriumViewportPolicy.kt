package com.termux.extensions

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import com.cefrium.CefriumBrowser
import com.cefrium.Te2CefriumBrowserAccess
import java.io.Closeable
import kotlin.math.ln
import org.chromium.content_public.browser.GlobalRenderFrameHostId
import org.chromium.content_public.browser.Page
import org.chromium.content_public.browser.WebContents
import org.chromium.content_public.browser.WebContentsObserver
import org.chromium.ui.base.WindowAndroid

/** Native page scaling is independent of user-controlled pinch/double-tap zoom. */
internal object CefriumViewportPolicy {
    const val DEFAULT_SCALE = 100
    const val MIN_SCALE = 60
    const val MAX_SCALE = 180
    const val SCALE_STEP = 10

    fun normalizeScale(value: Int): Int = value.coerceIn(MIN_SCALE, MAX_SCALE)

    // Cefrium uses Chromium's logarithmic zoom levels: factor = 1.2^level.
    fun zoomLevel(value: Int): Double = ln(normalizeScale(value) / 100.0) / ln(1.2)
}

/** Owns bounded WebContents readiness, including resume/recreated renderers. */
internal class CefriumViewportController(
    private val browser: CefriumBrowser,
    private val observeRendererLifecycle: Boolean = false,
    private val layoutScale: () -> Int = { CefriumViewportPolicy.DEFAULT_SCALE },
) : Closeable {
    private val handler = Handler(Looper.getMainLooper())
    private val gate = CefriumViewportRestoreGate()
    private var observedContents: WebContents? = null
    private var contentsObserver: WebContentsObserver? = null
    private var surfaceHolder: SurfaceHolder? = null
    private var restorePosted = false
    private val restoreAfterRenderer = Runnable {
        restorePosted = false
        if (gate.active) attempt(gate.generation, 0)
    }
    private val surfaceCallback = object : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) {
            if (holder === surfaceHolder) rendererChanged()
        }
        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            if (holder === surfaceHolder) rendererChanged()
        }
        override fun surfaceDestroyed(holder: SurfaceHolder) {
            if (holder === surfaceHolder) cancelPending()
        }
    }
    private val attachListener = object : View.OnAttachStateChangeListener {
        override fun onViewAttachedToWindow(view: View) = rendererChanged()
        override fun onViewDetachedFromWindow(view: View) {
            cancelPending()
        }
    }

    init {
        if (observeRendererLifecycle) browser.surfaceContainer.addOnAttachStateChangeListener(attachListener)
    }

    private fun cancelPending() {
        gate.invalidate()
        restorePosted = false
        handler.removeCallbacksAndMessages(null)
    }

    fun suspend() {
        gate.suspend()
        cancelPending()
    }

    fun reapply() {
        if (!gate.activate()) return
        cancelPending()
        // The SDK method asynchronously rewrites viewport metadata. Termux sets
        // it once before loading; native gesture guards suffice on reattachment.
        if (!observeRendererLifecycle) browser.setPinchToZoomEnabled(false)
        attempt(gate.generation, 0)
    }

    private fun rendererChanged() {
        if (!gate.active) return
        // Our surface callback is registered after Chromium's own callback.
        // Restore synchronously, then once at the end of its UI-thread handoff.
        attempt(gate.generation, 0)
        if (!restorePosted) {
            restorePosted = true
            handler.post(restoreAfterRenderer)
        }
    }

    private fun observeRenderer() {
        val contents = Te2CefriumBrowserAccess.webContents(browser)
        if (contents !== observedContents) {
            contentsObserver?.observe(null)
            observedContents = contents
            contentsObserver = contents?.let { next ->
                object : WebContentsObserver(next) {
                    private fun changed() {
                        if (observedContents === next) rendererChanged()
                    }
                    override fun onVisibilityChanged(visibility: Int) {
                        if (observedContents !== next) return
                        if (visibility == 2) changed() else cancelPending()
                    }
                    override fun onTopLevelNativeWindowChanged(window: WindowAndroid?) = changed()
                    override fun renderFrameCreated(id: GlobalRenderFrameHostId) = changed()
                    override fun primaryPageChanged(page: Page) = changed()
                    override fun webContentsDestroyed() {
                        if (observedContents !== next) return
                        cancelPending()
                        observedContents = null
                        contentsObserver = null
                    }
                }
            }
        }
        val holder = findSurface(browser.surfaceContainer)?.holder
        if (holder !== surfaceHolder) {
            surfaceHolder?.removeCallback(surfaceCallback)
            surfaceHolder = holder
            holder?.addCallback(surfaceCallback)
        }
    }

    private fun attempt(ticket: Int, count: Int) {
        if (!gate.accepts(ticket)) return
        if (observeRendererLifecycle) {
            Te2CefriumBrowserAccess.ensureWebContentsConnected(browser)
            observeRenderer()
        }
        if (Te2CefriumBrowserAccess.setAccessibilityPageZoom(
                browser, CefriumViewportPolicy.zoomLevel(layoutScale()),
            )) return
        if (count < 100) {
            handler.postDelayed({ attempt(ticket, count + 1) }, 50L)
        } else {
            Log.w("CefriumViewport", "WebContents zoom guard readiness timed out")
        }
    }

    override fun close() {
        gate.close()
        suspend()
        contentsObserver?.observe(null)
        contentsObserver = null
        observedContents = null
        surfaceHolder?.removeCallback(surfaceCallback)
        surfaceHolder = null
        if (observeRendererLifecycle) browser.surfaceContainer.removeOnAttachStateChangeListener(attachListener)
    }

    private fun findSurface(view: View): SurfaceView? {
        if (view is SurfaceView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) {
            findSurface(view.getChildAt(index))?.let { return it }
        }
        return null
    }
}
