package com.termux.extensions

import java.io.Closeable
import org.json.JSONObject

/** One app-entry sequence. Subscription reconnect/re-render never restarts it. */
internal class TermuxStartupCoordinator(
    private val settings: TermuxStartupSettings,
    private val runtime: AndroidLocalFrameworkRuntime,
    private val origin: () -> String,
    private val onPreferredApp: (String, String) -> Unit,
    private val onError: (String) -> Unit,
) : Closeable {
    private var subscription: Closeable? = null
    private var finished = false
    private var begun = false
    private val initialOrigin = origin()

    @Synchronized fun begin() {
        if (begun || finished) return
        begun = true
        if (!settings.startLocalFrameworkOnLaunch) { complete(initialOrigin); return }
        val observer = runtime.subscribe { name, frame ->
            if (name == "local-framework-state") frame.optJSONObject("data")?.let(::observe)
        }
        if (finished) observer.close() else subscription = observer
        runtime.execute {
            if (synchronized(this) { finished }) return@execute
            try { observe(runtime.request("start_local_framework", JSONObject())) }
            catch (error: Exception) { fail(error.message ?: "Automatic framework start failed") }
        }
    }

    @Synchronized private fun observe(state: JSONObject) {
        if (finished) return
        when (state.optString("phase")) {
            "running" -> {
                val local = state.optString("localOrigin")
                if (state.optBoolean("selected") && origin() == local) complete(local)
                else if (origin() != initialOrigin && origin() != local) close()
            }
            "failed", "exited" -> fail(state.optString("error", "Automatic framework start stopped"))
        }
    }

    @Synchronized private fun complete(expectedOrigin: String) {
        if (finished) return
        finished = true
        subscription?.close(); subscription = null
        if (settings.autostart && settings.preferredAppId.isNotEmpty() && origin() == expectedOrigin)
            onPreferredApp(settings.preferredAppId, expectedOrigin)
    }
    @Synchronized private fun fail(message: String) {
        if (finished) return
        close(); onError(message)
    }
    @Synchronized override fun close() {
        finished = true; subscription?.close(); subscription = null
        // Detach only: never stop an owned/external framework due to Activity teardown.
    }
}
