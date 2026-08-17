package com.termux.extensions

import android.content.Context
import org.json.JSONObject

/** Android-owned connection and lifecycle settings used by both renderer flavors. */
data class AndroidAppSettings(
    val frameworkHost: String = DEFAULT_FRAMEWORK_HOST,
    val frameworkPort: Int = DEFAULT_FRAMEWORK_PORT,
    val persistentNetworkNotification: Boolean = false,
    val imeContextSwitchingEnabled: Boolean = true,
    val devToolsRunProfilesEnabled: Boolean = false,
    val devToolsDebugEnabled: Boolean = false,
) {
    val frameworkBaseUrl: String
        get() {
            val authorityHost = if (frameworkHost.contains(':') && !frameworkHost.startsWith('[')) {
                "[$frameworkHost]"
            } else {
                frameworkHost
            }
            return "http://$authorityHost:$frameworkPort"
        }

    fun toJson(): JSONObject = JSONObject().apply {
        put("nativeSettingsSchemaVersion", NATIVE_SETTINGS_SCHEMA_VERSION)
        put("frameworkHost", frameworkHost)
        put("frameworkPort", frameworkPort)
        put("frameworkBaseUrl", frameworkBaseUrl)
        put("persistentNetworkNotification", persistentNetworkNotification)
        put("imeContextSwitchingEnabled", imeContextSwitchingEnabled)
        put("devToolsRunProfilesEnabled", devToolsRunProfilesEnabled)
        put("devToolsDebugEnabled", devToolsDebugEnabled)
        put("devToolsInspectorEnabled", devToolsRunProfilesEnabled || devToolsDebugEnabled)
    }

    companion object {
        const val DEFAULT_FRAMEWORK_HOST = "127.0.0.1"
        const val DEFAULT_FRAMEWORK_PORT = 8089
        const val NATIVE_SETTINGS_SCHEMA_VERSION = 2
    }
}

internal fun validatedAndroidAppSettings(
    frameworkHost: String,
    frameworkPort: Int,
    persistentNetworkNotification: Boolean,
    imeContextSwitchingEnabled: Boolean = true,
    devToolsRunProfilesEnabled: Boolean = false,
    devToolsDebugEnabled: Boolean = false,
): AndroidAppSettings {
    val host = frameworkHost.trim().removeSurrounding("[", "]")
    require(host.isNotEmpty()) { "Framework host is required" }
    require(host.length <= 253) { "Framework host is too long" }
    require(!host.contains(Regex("[\\s/@?#]"))) {
        "Framework host must not contain a scheme, path, or whitespace"
    }
    require(host.matches(Regex("[A-Za-z0-9._:-]+"))) {
        "Framework host contains unsupported characters"
    }
    require(frameworkPort in 1..65535) { "Framework port must be between 1 and 65535" }

    return AndroidAppSettings(
        frameworkHost = host,
        frameworkPort = frameworkPort,
        persistentNetworkNotification = persistentNetworkNotification,
        imeContextSwitchingEnabled = imeContextSwitchingEnabled,
        devToolsRunProfilesEnabled = devToolsRunProfilesEnabled,
        devToolsDebugEnabled = devToolsDebugEnabled,
    )
}

/** SharedPreferences repository for settings that belong to the Android shell, not TE2. */
class AndroidAppSettingsStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    fun load(): AndroidAppSettings {
        return try {
            val legacyDevToolsEnabled = preferences.getBoolean(
                KEY_DEVTOOLS_INSPECTOR_ENABLED,
                false,
            )
            validatedAndroidAppSettings(
                frameworkHost = preferences.getString(
                    KEY_FRAMEWORK_HOST,
                    AndroidAppSettings.DEFAULT_FRAMEWORK_HOST,
                ) ?: AndroidAppSettings.DEFAULT_FRAMEWORK_HOST,
                frameworkPort = preferences.getInt(
                    KEY_FRAMEWORK_PORT,
                    AndroidAppSettings.DEFAULT_FRAMEWORK_PORT,
                ),
                persistentNetworkNotification = preferences.getBoolean(
                    KEY_PERSISTENT_NETWORK_NOTIFICATION,
                    false,
                ),
                imeContextSwitchingEnabled = preferences.getBoolean(
                    KEY_IME_CONTEXT_SWITCHING_ENABLED,
                    true,
                ),
                devToolsRunProfilesEnabled = preferences.getBoolean(
                    KEY_DEVTOOLS_RUN_PROFILES_ENABLED,
                    legacyDevToolsEnabled,
                ),
                devToolsDebugEnabled = preferences.getBoolean(
                    KEY_DEVTOOLS_DEBUG_ENABLED,
                    legacyDevToolsEnabled,
                ),
            )
        } catch (_: IllegalArgumentException) {
            AndroidAppSettings()
        }
    }

    fun update(payload: JSONObject): AndroidAppSettings {
        val current = load()
        val legacyDevToolsValue = if (payload.has("devToolsInspectorEnabled")) {
            payload.optBoolean(
                "devToolsInspectorEnabled",
                current.devToolsRunProfilesEnabled || current.devToolsDebugEnabled,
            )
        } else {
            null
        }
        val updated = validatedAndroidAppSettings(
            frameworkHost = if (payload.has("frameworkHost")) {
                payload.optString("frameworkHost", current.frameworkHost)
            } else {
                current.frameworkHost
            },
            frameworkPort = if (payload.has("frameworkPort")) {
                payload.optInt("frameworkPort", -1)
            } else {
                current.frameworkPort
            },
            persistentNetworkNotification = if (payload.has("persistentNetworkNotification")) {
                payload.optBoolean(
                    "persistentNetworkNotification",
                    current.persistentNetworkNotification,
                )
            } else {
                current.persistentNetworkNotification
            },
            imeContextSwitchingEnabled = if (payload.has("imeContextSwitchingEnabled")) {
                payload.optBoolean(
                    "imeContextSwitchingEnabled",
                    current.imeContextSwitchingEnabled,
                )
            } else {
                current.imeContextSwitchingEnabled
            },
            devToolsRunProfilesEnabled = if (payload.has("devToolsRunProfilesEnabled")) {
                payload.optBoolean(
                    "devToolsRunProfilesEnabled",
                    current.devToolsRunProfilesEnabled,
                )
            } else {
                legacyDevToolsValue ?: current.devToolsRunProfilesEnabled
            },
            devToolsDebugEnabled = if (payload.has("devToolsDebugEnabled")) {
                payload.optBoolean(
                    "devToolsDebugEnabled",
                    current.devToolsDebugEnabled,
                )
            } else {
                legacyDevToolsValue ?: current.devToolsDebugEnabled
            },
        )

        preferences.edit()
            .putString(KEY_FRAMEWORK_HOST, updated.frameworkHost)
            .putInt(KEY_FRAMEWORK_PORT, updated.frameworkPort)
            .putBoolean(
                KEY_PERSISTENT_NETWORK_NOTIFICATION,
                updated.persistentNetworkNotification,
            )
            .putBoolean(
                KEY_IME_CONTEXT_SWITCHING_ENABLED,
                updated.imeContextSwitchingEnabled,
            )
            .putBoolean(
                KEY_DEVTOOLS_RUN_PROFILES_ENABLED,
                updated.devToolsRunProfilesEnabled,
            )
            .putBoolean(
                KEY_DEVTOOLS_DEBUG_ENABLED,
                updated.devToolsDebugEnabled,
            )
            .putBoolean(
                KEY_DEVTOOLS_INSPECTOR_ENABLED,
                updated.devToolsRunProfilesEnabled || updated.devToolsDebugEnabled,
            )
            .apply()
        return updated
    }

    companion object {
        private const val PREFERENCES_NAME = "android_app_settings"
        private const val KEY_FRAMEWORK_HOST = "framework_host"
        private const val KEY_FRAMEWORK_PORT = "framework_port"
        private const val KEY_PERSISTENT_NETWORK_NOTIFICATION =
            "persistent_network_notification"
        private const val KEY_IME_CONTEXT_SWITCHING_ENABLED =
            "ime_context_switching_enabled"
        private const val KEY_DEVTOOLS_INSPECTOR_ENABLED =
            "devtools_inspector_enabled"
        private const val KEY_DEVTOOLS_RUN_PROFILES_ENABLED =
            "devtools_run_profiles_enabled"
        private const val KEY_DEVTOOLS_DEBUG_ENABLED =
            "devtools_debug_enabled"
    }
}
