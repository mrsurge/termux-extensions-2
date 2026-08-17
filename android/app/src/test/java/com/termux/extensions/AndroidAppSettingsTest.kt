package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidAppSettingsTest {
    @Test
    fun defaultsResolveToLoopbackFramework() {
        val settings = AndroidAppSettings()

        assertEquals("http://127.0.0.1:8089", settings.frameworkBaseUrl)
        assertEquals(true, settings.imeContextSwitchingEnabled)
        assertEquals(false, settings.devToolsRunProfilesEnabled)
        assertEquals(false, settings.devToolsDebugEnabled)
    }

    @Test
    fun validationNormalizesHostAndPreservesLocalToggle() {
        val settings = validatedAndroidAppSettings(
            frameworkHost = " 100.108.128.8 ",
            frameworkPort = 8081,
            persistentNetworkNotification = true,
            imeContextSwitchingEnabled = false,
            devToolsRunProfilesEnabled = true,
            devToolsDebugEnabled = false,
        )

        assertEquals("100.108.128.8", settings.frameworkHost)
        assertEquals("http://100.108.128.8:8081", settings.frameworkBaseUrl)
        assertEquals(true, settings.persistentNetworkNotification)
        assertEquals(false, settings.imeContextSwitchingEnabled)
        assertEquals(true, settings.devToolsRunProfilesEnabled)
        assertEquals(false, settings.devToolsDebugEnabled)
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
    fun compatibilityJsonReportsAggregateInspectorState() {
        val settings = AndroidAppSettings(
            devToolsRunProfilesEnabled = true,
            devToolsDebugEnabled = false,
        )

        val json = settings.toJson()
        assertEquals(2, json.getInt("nativeSettingsSchemaVersion"))
        assertEquals(true, json.getBoolean("devToolsInspectorEnabled"))
        assertEquals(true, json.getBoolean("devToolsRunProfilesEnabled"))
        assertEquals(false, json.getBoolean("devToolsDebugEnabled"))
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
