package com.termux.extensions

import java.io.Closeable
import org.json.JSONObject

/** Optional consumer runtime; existing Android clients install no implementation. */
interface AndroidLocalFrameworkRuntime : Closeable {
    fun execute(operation: () -> Unit)
    fun request(method: String, params: JSONObject): JSONObject
    fun subscribe(observer: (String, JSONObject) -> Unit): Closeable
    /** Optional Electron window effects; caller detachment never disposes the actor. */
    fun bindWindowEffects(apply: (JSONObject) -> Unit): Closeable =
        throw UnsupportedOperationException("Electron window effects unavailable")
    /** Explicit consumer app-entry startup; never invoked by service recreation. */
    fun beginStartup(onPreferredApp: (String, String) -> Unit, onError: (String) -> Unit): Closeable? = null
}

object AndroidLocalFrameworkRuntimeFactory {
    var create: ((PersistentNetworkService) -> AndroidLocalFrameworkRuntime)? = null
}
