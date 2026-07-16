package com.termux.extensions.nativeeditor.explorer

import com.termux.extensions.rpc.SocketIoJsonRpcClient

internal interface NativeExplorerRpcTransport {
    val isConnected: Boolean

    fun notify(method: String, params: Map<String, Any?> = emptyMap()): Boolean

    fun request(
        method: String,
        params: Map<String, Any?> = emptyMap(),
        callback: (Result<Any?>) -> Unit,
    )
}

internal class SocketIoNativeExplorerRpcTransport(
    private val client: () -> SocketIoJsonRpcClient?,
) : NativeExplorerRpcTransport {
    override val isConnected: Boolean
        get() = client()?.isConnected == true

    override fun notify(method: String, params: Map<String, Any?>): Boolean =
        client()?.notify(method, params) == true

    override fun request(
        method: String,
        params: Map<String, Any?>,
        callback: (Result<Any?>) -> Unit,
    ) {
        client()?.request(method, params, callback = callback)
    }
}
