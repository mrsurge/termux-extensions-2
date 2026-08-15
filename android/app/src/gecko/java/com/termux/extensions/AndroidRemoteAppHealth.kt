package com.termux.extensions

import org.json.JSONObject

enum class AndroidRemoteAppHealth {
    HEALTHY,
    UNHEALTHY,
    UNREACHABLE,
}

internal data class AndroidRemoteAppFallbackDecision(
    val consecutiveUnhealthyCount: Int,
    val loadHome: Boolean,
)

/**
 * Only an authoritative running-app projection may evict a remote app.
 * Transport failure preserves the current presentation and breaks any
 * consecutive authoritative-failure sequence.
 */
internal fun evaluateRemoteAppFallback(
    health: AndroidRemoteAppHealth,
    consecutiveUnhealthyCount: Int,
    failureLimit: Int,
): AndroidRemoteAppFallbackDecision {
    require(failureLimit > 0) { "failureLimit must be positive" }
    val nextCount = when (health) {
        AndroidRemoteAppHealth.UNHEALTHY -> consecutiveUnhealthyCount.coerceAtLeast(0) + 1
        AndroidRemoteAppHealth.HEALTHY,
        AndroidRemoteAppHealth.UNREACHABLE,
        -> 0
    }
    return AndroidRemoteAppFallbackDecision(
        consecutiveUnhealthyCount = nextCount,
        loadHome = health == AndroidRemoteAppHealth.UNHEALTHY && nextCount >= failureLimit,
    )
}

/** Interpret the framework's authoritative running-app projection. */
fun evaluateRunningAppsPayload(payload: String, appId: String): AndroidRemoteAppHealth {
    return try {
        val root = JSONObject(payload)
        if (!root.optBoolean("ok", false)) return AndroidRemoteAppHealth.UNREACHABLE
        val running = root.optJSONArray("data") ?: return AndroidRemoteAppHealth.UNREACHABLE
        for (index in 0 until running.length()) {
            val app = running.optJSONObject(index) ?: continue
            if (app.optString("app_id") != appId) continue
            val readiness = app.optJSONObject("readiness")
            val status = readiness?.optString("status")?.trim()?.lowercase().orEmpty()
            return if (status == "error" || status == "stopped") {
                AndroidRemoteAppHealth.UNHEALTHY
            } else {
                AndroidRemoteAppHealth.HEALTHY
            }
        }
        AndroidRemoteAppHealth.UNHEALTHY
    } catch (_: Exception) {
        AndroidRemoteAppHealth.UNREACHABLE
    }
}
