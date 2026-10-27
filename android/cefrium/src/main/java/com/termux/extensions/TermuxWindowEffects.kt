package com.termux.extensions

import org.json.JSONObject

/** Only TE2's existing main surface is admitted; no page-controlled new windows. */
internal object TermuxWindowEffects {
    fun apply(effect: JSONObject, launcher: String, register: () -> Unit,
              home: () -> Unit, reload: () -> Unit) {
        require(effect.getInt("windowId") == 1) { "Unknown native window" }
        when (effect.getString("kind")) {
            "window.create" -> {
                require(effect.length() == 3 && effect.getJSONObject("options").length() == 0)
                register()
            }
            "window.load" -> {
                require(effect.length() == 4 && effect.getString("source") == "url" &&
                    effect.getString("value") == launcher) { "Packaged launcher required" }
                home()
            }
            "webContents" -> {
                require(effect.length() == 3 && effect.getString("action") == "reload")
                reload()
            }
            else -> error("Unsupported Electron window effect")
        }
    }
}
