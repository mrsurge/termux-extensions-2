package com.termux.extensions

import java.io.Closeable
import org.json.JSONObject

/** Optional consumer runtime; existing Android clients install no implementation. */
interface AndroidLocalFrameworkRuntime : Closeable {
    fun execute(operation: () -> Unit)
    fun request(method: String, params: JSONObject): JSONObject
    fun subscribe(observer: (String, JSONObject) -> Unit): Closeable
}

object AndroidLocalFrameworkRuntimeFactory {
    var create: ((PersistentNetworkService) -> AndroidLocalFrameworkRuntime)? = null
}
