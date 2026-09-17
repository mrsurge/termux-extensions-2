package com.termux.extensions

import org.json.JSONObject

// Release/staging link only this inert seam, never the reflection dispatcher.
internal object NativeRuntimeDebug {
    fun register(name: String, value: Any) = Unit
    fun unregister(name: String, value: Any) = Unit
    fun tryDispatch(code: String, completion: (Result<JSONObject>) -> Unit): Boolean = false
}
