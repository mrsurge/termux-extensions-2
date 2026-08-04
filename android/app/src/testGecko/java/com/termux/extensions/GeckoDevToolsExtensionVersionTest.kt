package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class GeckoDevToolsExtensionVersionTest {
    @Test
    fun nativeRevisionMatchesPackagedExtensionManifest() {
        val manifest = File("src/main/assets/devtools_inspector/manifest.json")
        assertTrue("Missing developer-tools extension manifest", manifest.isFile)

        val version = Regex(""""version"\s*:\s*"([^"]+)"""")
            .find(manifest.readText())
            ?.groupValues
            ?.get(1)

        assertEquals(GeckoDevToolsInspector.EXTENSION_VERSION, version)
    }
}
