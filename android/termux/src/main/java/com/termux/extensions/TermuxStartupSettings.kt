package com.termux.extensions

import android.content.Context
import org.json.JSONObject

/** Electron-shaped consumer settings; remote app gateway cannot write these. */
internal data class TermuxStartupSettings(
    val startLocalFrameworkOnLaunch: Boolean = false,
    val autostart: Boolean = false,
    val preferredAppId: String = "",
) {
    fun merge(base: JSONObject): JSONObject = base
        .put("startLocalFrameworkOnLaunch", startLocalFrameworkOnLaunch)
        .put("autostart", autostart).put("preferredAppId", preferredAppId)

    companion object {
        fun parse(value: JSONObject): TermuxStartupSettings {
            for (key in listOf("startLocalFrameworkOnLaunch", "autostart"))
                require(!value.has(key) || value.get(key) is Boolean) { "Invalid startup setting" }
            require(!value.has("preferredAppId") || value.get("preferredAppId") is String) { "Invalid preferred app" }
            val id = value.optString("preferredAppId").trim()
            require(id.length <= 128 && (id.isEmpty() || id.matches(Regex("[A-Za-z0-9._-]+")))) { "Invalid preferred app" }
            return TermuxStartupSettings(value.optBoolean("startLocalFrameworkOnLaunch"),
                value.optBoolean("autostart"), id)
        }
    }
}

internal class TermuxStartupSettingsStore(context: Context) {
    private val prefs = context.getSharedPreferences("electromux_startup", Context.MODE_PRIVATE)
    fun load() = TermuxStartupSettings(prefs.getBoolean("startLocalFrameworkOnLaunch", false),
        prefs.getBoolean("autostart", false), prefs.getString("preferredAppId", "") ?: "")
    fun save(value: TermuxStartupSettings) {
        check(prefs.edit().putBoolean("startLocalFrameworkOnLaunch", value.startLocalFrameworkOnLaunch)
            .putBoolean("autostart", value.autostart).putString("preferredAppId", value.preferredAppId).commit()) {
            "Startup settings could not be saved"
        }
    }
}
