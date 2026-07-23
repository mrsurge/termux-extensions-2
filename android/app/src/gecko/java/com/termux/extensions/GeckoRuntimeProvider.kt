package com.termux.extensions

import android.content.Context
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings
import java.io.File

/**
 * Lazily provides a shared GeckoRuntime instance so we avoid repeated start-up
 * costs when the activity is recreated.
 */
object GeckoRuntimeProvider {

    @Volatile
    private var runtime: GeckoRuntime? = null

    private const val DEFAULT_FONT_SCALE = 0.8f

    fun get(appContext: Context, secureContextHost: String): GeckoRuntime {
        return runtime ?: synchronized(this) {
            runtime ?: GeckoRuntime.create(
                appContext,
                buildSettings(writeRuntimeConfig(appContext, secureContextHost)),
            ).also {
                runtime = it
            }
        }
    }

    private fun writeRuntimeConfig(appContext: Context, secureContextHost: String): File {
        val config = File(appContext.filesDir, "geckoview-runtime-config.yaml")
        config.writeText(renderGeckoRuntimeConfig(secureContextHost))
        return config
    }

    private fun buildSettings(config: File): GeckoRuntimeSettings {
        return GeckoRuntimeSettings.Builder()
            .configFilePath(config.absolutePath)
            .automaticFontSizeAdjustment(false)
            .fontSizeFactor(DEFAULT_FONT_SCALE)
            .inputAutoZoomEnabled(false)
            .doubleTapZoomingEnabled(false)
            .forceUserScalableEnabled(false)
            .javaScriptEnabled(true)
            .consoleOutput(true)
            .build()
    }
}

internal fun renderGeckoRuntimeConfig(secureContextHost: String): String {
    val quotedHost = secureContextHost
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
    return """prefs:
  dom.securecontext.allowlist: "$quotedHost"
"""
}
