package com.termux.extensions

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.file.Files

class AndroidShellGatewayAssetTest {
    @Test
    fun normalizedIconIsServedLocallyWithoutAnUpstreamConnection() {
        val root = Files.createTempDirectory("te2-launcher-icon-").toFile()
        val path = "/apps/code_te2/static/icons/CODE_TE2.png"
        val icon = root.resolve(path.removePrefix("/"))
        requireNotNull(icon.parentFile).mkdirs()
        icon.writeText("packaged-icon")
        val relay = AndroidFrameworkRelay(
            assetRoot = root,
            assetPathResolver = { requestPath ->
                if (requestPath == path) requestPath else null
            },
        )
        try {
            // Nothing is listening at the configured upstream: only local delivery can succeed.
            relay.start("http://127.0.0.1:1")
            val app = AndroidShellGateway.normalizeAppAssets(
                JSONObject().put("icon_src", path), relay.configuredOrigin,
                relay::rewriteFrameworkUrl,
            )
            OkHttpClient().newCall(Request.Builder().url(app.getString("icon_src")).build())
                .execute().use { response ->
                    assertEquals(200, response.code)
                    assertEquals("packaged-icon", response.body?.string())
                }
        } finally {
            relay.stop()
            root.deleteRecursively()
        }
    }

    @Test
    fun launcherAssetsUseFrameworkRelayAndPreserveExternalUrls() {
        val upstream = "http://remote-server:8089"
        val relay = "http://127.0.0.1:35983"
        val rewrite: (String) -> String = { url ->
            if (url.startsWith("$upstream/")) relay + url.removePrefix(upstream) else url
        }
        val path = "/apps/code_te2/static/icons/CODE_TE2.png"
        for (source in listOf(path, "$upstream$path", "static/icons/CODE_TE2.png")) {
            val app = JSONObject().put("icon_src", source)
                .put("asset_base_url", "/apps/code_te2")
            val result = AndroidShellGateway.normalizeAppAssets(app, upstream, rewrite)
            assertEquals("$relay$path", result.getString("icon_src"))
            assertEquals("$relay/apps/code_te2", result.getString("asset_base_url"))
            assertEquals(source, app.getString("icon_src"))
        }
        val external = "https://example.org/icon.png?v=2#icon"
        val result = AndroidShellGateway.normalizeAppAssets(
            JSONObject().put("icon_src", external), upstream, rewrite,
        )
        assertEquals(external, result.getString("icon_src"))
    }
}
