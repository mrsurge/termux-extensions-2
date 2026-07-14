package com.termux.extensions.rpc

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class MessagePackRpcCodecTest {
    @Test
    fun decodesMsgspecNotificationFixture() {
        val payload = hex(
            "83a76a736f6e727063a3322e30a66d6574686f64ac75692e696d652e666f637573" +
                "a6706172616d7381a6736f75726365a6656469746f72",
        )

        assertEquals(
            mapOf(
                "jsonrpc" to "2.0",
                "method" to "ui.ime.focus",
                "params" to mapOf("source" to "editor"),
            ),
            MessagePackRpcCodec.decode(payload),
        )
    }

    @Test
    fun roundTripsRecursiveJsonValuesAndBinary() {
        val payload = mapOf(
            "null" to null,
            "bool" to true,
            "integer" to 7,
            "float" to 1.5,
            "text" to "value",
            "binary" to byteArrayOf(1, 2, 3),
            "items" to listOf("a", false, 9),
            "object" to mapOf("nested" to "yes"),
        )
        val decoded = MessagePackRpcCodec.decode(MessagePackRpcCodec.encode(payload)).asStringMap()!!

        assertNull(decoded["null"])
        assertEquals(true, decoded["bool"])
        assertEquals(7L, decoded["integer"])
        assertEquals(1.5, decoded["float"])
        assertEquals("value", decoded["text"])
        assertArrayEquals(byteArrayOf(1, 2, 3), decoded["binary"] as ByteArray)
        assertEquals(listOf("a", false, 9L), decoded["items"])
        assertEquals(mapOf("nested" to "yes"), decoded["object"])
    }

    @Test
    fun rejectsNonBinaryPayload() {
        assertThrows(IllegalArgumentException::class.java) {
            MessagePackRpcCodec.decode("{}")
        }
    }

    private fun hex(value: String): ByteArray = ByteArray(value.length / 2) { index ->
        value.substring(index * 2, index * 2 + 2).toInt(16).toByte()
    }
}
