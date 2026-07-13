package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UiIpcMessagePackDecoderTest {
    @Test
    fun decodesMsgspecNotificationFixture() {
        val payload = hex(
            "83a76a736f6e727063a3322e30a66d6574686f64ac75692e696d652e666f637573" +
                "a6706172616d7381a6736f75726365a6656469746f72"
        )

        assertEquals(
            UiIpcRpcNotification("2.0", "ui.ime.focus", "editor"),
            UiIpcMessagePackDecoder.decode(payload)
        )
    }

    @Test
    fun rejectsNonBinaryAndNonMapPayloads() {
        assertNull(UiIpcMessagePackDecoder.decode("{}"))
        assertNull(UiIpcMessagePackDecoder.decode(byteArrayOf(0x90.toByte())))
    }

    private fun hex(value: String): ByteArray {
        return ByteArray(value.length / 2) { index ->
            value.substring(index * 2, index * 2 + 2).toInt(16).toByte()
        }
    }
}
