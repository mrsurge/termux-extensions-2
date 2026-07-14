package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidAppSettingsTest {
    @Test
    fun defaultsResolveToLoopbackFramework() {
        val settings = AndroidAppSettings()

        assertEquals("http://127.0.0.1:8089", settings.frameworkBaseUrl)
    }

    @Test
    fun validationNormalizesHostAndPreservesLocalToggle() {
        val settings = validatedAndroidAppSettings(
            frameworkHost = " 100.108.128.8 ",
            frameworkPort = 8081,
            persistentNetworkNotification = true,
        )

        assertEquals("100.108.128.8", settings.frameworkHost)
        assertEquals("http://100.108.128.8:8081", settings.frameworkBaseUrl)
        assertEquals(true, settings.persistentNetworkNotification)
    }

    @Test
    fun validationFormatsIpv6Authority() {
        val settings = validatedAndroidAppSettings(
            frameworkHost = "[::1]",
            frameworkPort = 8089,
            persistentNetworkNotification = false,
        )

        assertEquals("::1", settings.frameworkHost)
        assertEquals("http://[::1]:8089", settings.frameworkBaseUrl)
    }

    @Test
    fun validationRejectsUrlInsteadOfHost() {
        assertThrows(IllegalArgumentException::class.java) {
            validatedAndroidAppSettings(
                frameworkHost = "http://example.test",
                frameworkPort = 8089,
                persistentNetworkNotification = false,
            )
        }
    }

    @Test
    fun validationRejectsInvalidPort() {
        assertThrows(IllegalArgumentException::class.java) {
            validatedAndroidAppSettings(
                frameworkHost = "example.test",
                frameworkPort = 0,
                persistentNetworkNotification = false,
            )
        }
    }
}
