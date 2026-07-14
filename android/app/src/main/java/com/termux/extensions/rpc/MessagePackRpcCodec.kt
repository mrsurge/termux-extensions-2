package com.termux.extensions.rpc

import org.msgpack.core.MessagePack
import org.msgpack.core.MessagePacker
import org.msgpack.value.Value

/** Binary boundary shared by the native Android Code TE2 RPC lanes. */
internal object MessagePackRpcCodec {
    fun encode(value: Any?): ByteArray {
        val packer = MessagePack.newDefaultBufferPacker()
        packer.use {
            packValue(it, value)
        }
        return packer.toByteArray()
    }

    fun decode(payload: Any?): Any? {
        val bytes = payload as? ByteArray
            ?: throw IllegalArgumentException("Expected binary MessagePack payload")
        return MessagePack.newDefaultUnpacker(bytes).use { unpacker ->
            unpackValue(unpacker.unpackValue())
        }
    }

    private fun packValue(packer: MessagePacker, value: Any?) {
        when (value) {
            null -> packer.packNil()
            is Boolean -> packer.packBoolean(value)
            is Byte -> packer.packInt(value.toInt())
            is Short -> packer.packInt(value.toInt())
            is Int -> packer.packInt(value)
            is Long -> packer.packLong(value)
            is Float -> packer.packFloat(value)
            is Double -> packer.packDouble(value)
            is String -> packer.packString(value)
            is ByteArray -> packer.packBinaryHeader(value.size).writePayload(value)
            is Map<*, *> -> {
                val entries = value.entries.filter { it.key is String }
                packer.packMapHeader(entries.size)
                entries.forEach { (key, item) ->
                    packer.packString(key as String)
                    packValue(packer, item)
                }
            }
            is Iterable<*> -> {
                val items = value.toList()
                packer.packArrayHeader(items.size)
                items.forEach { packValue(packer, it) }
            }
            is Array<*> -> {
                packer.packArrayHeader(value.size)
                value.forEach { packValue(packer, it) }
            }
            else -> throw IllegalArgumentException(
                "Unsupported MessagePack value: ${value::class.java.name}",
            )
        }
    }

    private fun unpackValue(value: Value): Any? = when {
        value.isNilValue -> null
        value.isBooleanValue -> value.asBooleanValue().boolean
        value.isIntegerValue -> value.asIntegerValue().toLong()
        value.isFloatValue -> value.asFloatValue().toDouble()
        value.isStringValue -> value.asStringValue().asString()
        value.isBinaryValue -> value.asBinaryValue().asByteArray()
        value.isArrayValue -> value.asArrayValue().list().map(::unpackValue)
        value.isMapValue -> buildMap {
            value.asMapValue().map().forEach { (key, item) ->
                if (key.isStringValue) {
                    put(key.asStringValue().asString(), unpackValue(item))
                }
            }
        }
        else -> throw IllegalArgumentException("Unsupported MessagePack value type: ${value.valueType}")
    }
}
