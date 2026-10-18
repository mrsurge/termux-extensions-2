package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AlsProxyAssetsTest {
    @Test fun mapsOnlyStaticTrees() {
        for (path in listOf("dist/codex_agent.js", "vendor/tree-sitter-bash/tree-sitter-bash.wasm", "vendor/fonts/jetbrains-mono.css")) {
            val local = "/apps/als_rs/frontend/static/$path"
            assertEquals(local, AlsProxyAssets.localPath("/api/app/als-rs/proxy/static/$path"))
            assertEquals(local, AlsProxyAssets.localPath(local))
        }
        for (path in listOf("/api/app/als-rs/proxy/", "/api/app/als-rs/proxy/agent-log",
            "/api/app/als-rs/proxy/api/health", "/api/app/als-rs/proxy/socket.io/",
            "/api/app/als-rs/proxy/api/extensions/codex/assets/ui/main.js")) {
            assertNull(AlsProxyAssets.localPath(path))
        }
    }
}
