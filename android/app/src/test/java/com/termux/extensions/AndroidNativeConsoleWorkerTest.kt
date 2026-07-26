package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidNativeConsoleWorkerTest {
    @Test
    fun parsesAllowlistedForceUpdateCommand() {
        assertEquals(
            AndroidNativeConsoleCommand.FORCE_UPDATE_AND_RELOAD,
            parseAndroidNativeConsoleCommand(
                """
                {
                  "jsonrpc": "2.0",
                  "method": "android.assets.forceUpdateAndReload",
                  "params": {}
                }
                """.trimIndent(),
            ),
        )
    }

    @Test
    fun rejectsArbitraryEvaluationAndUnknownMethods() {
        assertThrows(IllegalArgumentException::class.java) {
            parseAndroidNativeConsoleCommand("1 + 1")
        }
        assertThrows(IllegalArgumentException::class.java) {
            parseAndroidNativeConsoleCommand(
                """{"jsonrpc":"2.0","method":"android.runtime.eval","params":{}}""",
            )
        }
    }

    @Test
    fun rejectsNonObjectParams() {
        assertThrows(IllegalArgumentException::class.java) {
            parseAndroidNativeConsoleCommand(
                """
                {
                  "jsonrpc": "2.0",
                  "method": "android.assets.forceUpdateAndReload",
                  "params": []
                }
                """.trimIndent(),
            )
        }
    }
}
