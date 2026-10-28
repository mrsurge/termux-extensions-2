package com.termux.extensions

import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.nio.file.Paths
import org.junit.Assert.*
import org.junit.Test

class AndroidFrameworkRelayAssetCacheTest {
    @Test fun replacedLocalAssetsDoNotInheritAnOlderFrameworkVersionsImmutableCache() {
        val temporary = Paths.get(System.getenv("TMPDIR") ?: System.getProperty("java.io.tmpdir"))
        val root = Files.createTempDirectory(temporary, "te2-relay-assets-").toFile()
        val relative = "apps/code_te2/static/dist/host.js"
        val asset = File(root, relative).apply { parentFile.mkdirs(); writeText("older bytes") }
        val relay = AndroidFrameworkRelay(
            assetRoot = root,
            assetPathResolver = { path ->
                when (path) {
                    "/apps/by-id/code_te2/static/dist/host.js", "/$relative" -> "/$relative"
                    else -> null
                }
            },
        )
        try {
            relay.start("http://127.0.0.1:1")
            val url = URL(relay.url("/apps/by-id/code_te2/static/dist/host.js?v=0.2.354"))
            fun get(): String {
                val connection = url.openConnection() as HttpURLConnection
                connection.useCaches = false
                try {
                    assertEquals(200, connection.responseCode)
                    assertEquals("no-store", connection.getHeaderField("Cache-Control"))
                    assertEquals(LOCAL_ASSET_CACHE_CONTROL, connection.getHeaderField("Cache-Control"))
                    assertEquals("files-dir", connection.getHeaderField("X-TE2-Android-Asset-Source"))
                    return connection.inputStream.bufferedReader().use { it.readText() }
                } finally { connection.disconnect() }
            }
            assertEquals("older bytes", get())
            asset.writeText("new APK/OTA bytes")
            assertEquals("new APK/OTA bytes", get())
        } finally { relay.stop(); root.deleteRecursively() }
    }
}
