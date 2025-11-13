package com.termux.extensions

import android.content.Context
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings

/**
 * Lazily provides a shared GeckoRuntime instance so we avoid repeated start-up
 * costs when the activity is recreated.
 */
object GeckoRuntimeProvider {

    @Volatile
    private var runtime: GeckoRuntime? = null

    private const val DEFAULT_FONT_SCALE = 0.8f

    fun get(appContext: Context): GeckoRuntime {
        return runtime ?: synchronized(this) {
            runtime ?: GeckoRuntime.create(appContext, buildSettings()).also {
                runtime = it
            }
        }
    }

    private fun buildSettings(): GeckoRuntimeSettings {
        return GeckoRuntimeSettings.Builder()
            .automaticFontSizeAdjustment(false)
            .fontSizeFactor(DEFAULT_FONT_SCALE)
            .javaScriptEnabled(true)
            .consoleOutput(true)
            .build()
    }
}
