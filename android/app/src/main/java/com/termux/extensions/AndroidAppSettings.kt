package com.termux.extensions

import android.content.Context
import org.json.JSONObject

/** Android-owned connection and lifecycle settings used by both renderer flavors. */
data class AndroidAppSettings(
    val frameworkHost: String = DEFAULT_FRAMEWORK_HOST,
    val frameworkPort: Int = DEFAULT_FRAMEWORK_PORT,
    val persistentNetworkNotification: Boolean = false,
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
        put("frameworkHost", frameworkHost)
        put("frameworkPort", frameworkPort)
        put("frameworkBaseUrl", frameworkBaseUrl)
        put("persistentNetworkNotification", persistentNetworkNotification)
    }

    companion object {
        const val DEFAULT_FRAMEWORK_HOST = "127.0.0.1"
        const val DEFAULT_FRAMEWORK_PORT = 8089
    }
}

internal fun validatedAndroidAppSettings(
    frameworkHost: String,
    frameworkPort: Int,
    persistentNetworkNotification: Boolean,
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
            )
        } catch (_: IllegalArgumentException) {
            AndroidAppSettings()
        }
    }

    fun update(payload: JSONObject): AndroidAppSettings {
        val current = load()
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
        )

        preferences.edit()
            .putString(KEY_FRAMEWORK_HOST, updated.frameworkHost)
            .putInt(KEY_FRAMEWORK_PORT, updated.frameworkPort)
            .putBoolean(
                KEY_PERSISTENT_NETWORK_NOTIFICATION,
                updated.persistentNetworkNotification,
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
    }
}
