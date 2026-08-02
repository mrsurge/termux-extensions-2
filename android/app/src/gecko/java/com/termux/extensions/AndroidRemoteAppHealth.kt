package com.termux.extensions

import org.json.JSONObject

enum class AndroidRemoteAppHealth {
    HEALTHY,
    UNHEALTHY,
    UNREACHABLE,
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
