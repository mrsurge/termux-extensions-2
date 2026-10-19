package com.termux.extensions

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.cefrium.CefriumBrowser
import com.cefrium.Te2CefriumBrowserAccess
import java.io.Closeable
import kotlin.math.ln

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
    private val layoutScale: () -> Int = { CefriumViewportPolicy.DEFAULT_SCALE },
) : Closeable {
    private val handler = Handler(Looper.getMainLooper())
    private var generation = 0
    private var closed = false

    fun suspend() {
        generation += 1
        handler.removeCallbacksAndMessages(null)
    }

    fun reapply() {
        if (closed) return
        suspend()
        // SDK policy also covers documents before their WebContents is attached.
        browser.setPinchToZoomEnabled(false)
        attempt(generation, 0)
    }

    private fun attempt(ticket: Int, count: Int) {
        if (closed || ticket != generation) return
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
        closed = true
        suspend()
    }
}
