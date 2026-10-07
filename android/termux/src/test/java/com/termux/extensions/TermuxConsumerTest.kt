package com.termux.extensions

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.*
import org.junit.Test

class TermuxConsumerTest {
    @Test fun buildHasDistinctIdentityAndSameRenderer() {
        assertTrue(BuildConfig.TE2_TERMUX)
        assertEquals("com.termux.extensions.te2termux", BuildConfig.APPLICATION_ID)
        assertTrue(File("../cefrium/src/main/java/com/termux/extensions/MainActivity.kt").isFile)
        assertFalse(File("src/main/java/com/termux/extensions/MainActivity.kt").exists())
    }
    @Test fun shellAllowlistRejectsEscapesAndUnlistedResources() {
        assertEquals("electromux_shell/host.js", TermuxShellAssets.assetPath("/electromux-shell/host.js"))
        for (file in listOf("chrome.html", "chrome.css", "chrome.js"))
            assertEquals("electromux_shell/$file", TermuxShellAssets.assetPath("/electromux-shell/$file"))
        for (path in listOf("/electromux-shell/../secret", "/electromux-shell/%2e%2e/secret",
            "/electromux-shell/unknown.js", "/api/apps/catalog")) assertNull(TermuxShellAssets.assetPath(path))
    }
    @Test fun sharedUidIsManifestLevelAndServiceRemainsPrivate() {
        val namespace = "http://schemas.android.com/apk/res/android"
        val document = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
            .newDocumentBuilder().parse(File("src/main/AndroidManifest.xml"))
        assertEquals("com.termux", document.documentElement.getAttributeNS(namespace, "sharedUserId"))
        val app = document.getElementsByTagName("application").item(0)
        assertNull(app.attributes.getNamedItemNS(namespace, "sharedUserId"))
        assertEquals("false", document.getElementsByTagName("service").item(0)
            .attributes.getNamedItemNS(namespace, "exported").nodeValue)
    }
    @Test fun generatedShellUsesActualDesktopSourceAndConsumerBootstrap() {
        val root = File("build/generated/termuxShellAssets/electromux_shell")
        for (page in listOf("index.html", "settings.html"))
            assertTrue(File(root, page).readText().contains("src=\"./electromux-bootstrap.js\""))
        assertEquals(File("../../desktop_client/android_shell/host.js").readText(), File(root, "host.js").readText())
        assertTrue(File(root, "electromux-platform.js").isFile)
        val chrome = File(root, "chrome.html").readText()
        assertTrue(chrome.contains("src=\"./electromux-bridge.js\""))
        assertTrue(chrome.contains("src=\"./chrome.js\""))
        assertEquals(File("../../desktop_client/android_shell/chrome.js").readText(), File(root, "chrome.js").readText())
    }
}
