package com.termux.extensions

import org.msgpack.core.MessagePack
import org.msgpack.value.MapValue
import org.msgpack.value.Value

internal data class UiIpcRpcNotification(
    val jsonRpc: String,
    val method: String,
    val source: String?
)

/** Strict MessagePack boundary for native consumers of UI IPC notifications. */
internal object UiIpcMessagePackDecoder {
    fun decode(payload: Any?): UiIpcRpcNotification? {
        if (payload !is ByteArray) return null

        val root = MessagePack.newDefaultUnpacker(payload).use { unpacker ->
            unpacker.unpackValue()
        }
        if (!root.isMapValue) return null

        val envelope = root.asMapValue()
        val jsonRpc = stringField(envelope, "jsonrpc") ?: return null
        val method = stringField(envelope, "method") ?: return null
        val params = field(envelope, "params")
        val source = if (params?.isMapValue == true) {
            stringField(params.asMapValue(), "source")
        } else {
            null
        }
        return UiIpcRpcNotification(jsonRpc, method, source)
    }

    private fun stringField(map: MapValue, name: String): String? {
        val value = field(map, name) ?: return null
        return if (value.isStringValue) value.asStringValue().asString() else null
    }

    private fun field(map: MapValue, name: String): Value? {
        return map.map().entries.firstOrNull { (key, _) ->
            key.isStringValue && key.asStringValue().asString() == name
        }?.value
    }
}
