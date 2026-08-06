package com.termux.extensions

import org.msgpack.core.MessagePack
import org.msgpack.value.ArrayValue
import org.msgpack.value.MapValue
import org.msgpack.value.Value
import org.json.JSONArray
import org.json.JSONObject

internal data class UiIpcRpcNotification(
    val jsonRpc: String,
    val method: String,
    val params: JSONObject,
) {
    val source: String?
        get() = params.optString("source").trim().ifEmpty { null }
}

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
        val paramsObject = if (params?.isMapValue == true) {
            jsonObject(params.asMapValue())
        } else {
            JSONObject()
        }
        return UiIpcRpcNotification(jsonRpc, method, paramsObject)
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

    private fun jsonObject(map: MapValue): JSONObject = JSONObject().apply {
        map.map().forEach { (key, value) ->
            if (key.isStringValue) {
                put(key.asStringValue().asString(), jsonValue(value))
            }
        }
    }

    private fun jsonArray(array: ArrayValue): JSONArray = JSONArray().apply {
        array.list().forEach { put(jsonValue(it)) }
    }

    private fun jsonValue(value: Value): Any = when {
        value.isNilValue -> JSONObject.NULL
        value.isBooleanValue -> value.asBooleanValue().boolean
        value.isIntegerValue -> value.asIntegerValue().toLong()
        value.isFloatValue -> value.asFloatValue().toDouble()
        value.isStringValue -> value.asStringValue().asString()
        value.isBinaryValue -> value.asBinaryValue().asByteArray()
        value.isArrayValue -> jsonArray(value.asArrayValue())
        value.isMapValue -> jsonObject(value.asMapValue())
        else -> value.toString()
    }
}
