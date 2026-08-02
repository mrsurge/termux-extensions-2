package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidToolsStateTest {
    @Test
    fun storedTabNamesRoundTrip() {
        NativeToolsTab.entries.forEach { tab ->
            assertEquals(tab, NativeToolsTab.fromStorage(tab.storageValue))
        }
    }

    @Test
    fun unknownStoredTabFallsBackToConsole() {
        assertEquals(NativeToolsTab.CONSOLE, NativeToolsTab.fromStorage("unknown"))
        assertEquals(NativeToolsTab.CONSOLE, NativeToolsTab.fromStorage(null))
    }
}
