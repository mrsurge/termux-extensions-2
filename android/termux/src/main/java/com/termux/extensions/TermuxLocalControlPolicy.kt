package com.termux.extensions

import dev.mrsurge.electromux.host.ConsumerDescriptor
import org.json.JSONObject

internal object TermuxLocalControlPolicy {
    val methods = setOf("get_settings", "save_settings", "get_android_settings", "save_android_settings",
        "open_power_settings", "open_notification_settings", "get_local_framework_config", "save_local_framework_config",
        "get_local_framework_state", "refresh_local_framework", "start_local_framework",
        "stop_local_framework", "use_local_framework", "install_local_framework", "cancel_local_framework_install")
    fun descriptor(origin: String) = ConsumerDescriptor("te2-termux", "TE2 Termux",
        "$origin/electromux-shell/index.html", setOf("electromux-shell/index.html", "electromux-shell/settings.html"),
        mapOf("$origin/electromux-shell/index.html" to "electromux-shell/index.html",
            "$origin/electromux-shell/settings.html" to "electromux-shell/settings.html"),
        methods, setOf("local-framework-state"), origin)
}

/** An actor state refresh cannot select an endpoint; only a newly armed intent can. */
internal class TermuxLocalSelectionFence {
    private var armedOrigin: String? = null
    private var revision = 0L
    @Synchronized fun reset() { armedOrigin = null; revision = 0 }
    @Synchronized fun observe(current: Long) { revision = maxOf(revision, current) }
    @Synchronized fun arm(origin: String) { armedOrigin = origin }
    @Synchronized fun consume(state: JSONObject): Pair<Int, String>? {
        val next = state.optLong("selectionRevision")
        if (next <= revision) return null
        revision = next
        val expected = armedOrigin ?: return null
        armedOrigin = null
        val match = Regex("http://127\\.0\\.0\\.1:([0-9]{1,5})")
            .matchEntire(state.optString("selectedOrigin")) ?: return null
        val port = match.groupValues[1].toIntOrNull() ?: return null
        return if (port in 1..65535) port to expected else null
    }
}
