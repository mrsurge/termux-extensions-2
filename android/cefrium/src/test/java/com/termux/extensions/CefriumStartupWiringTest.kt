package com.termux.extensions

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test

/** Source wiring guard; provider ordering and renderer launch also need device testing. */
class CefriumStartupWiringTest {
    @Test
    fun applicationIsRegisteredOnlyInCefrium() {
        val document = DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = true
        }.newDocumentBuilder().parse(File("src/main/AndroidManifest.xml"))
        val application = document.getElementsByTagName("application").item(0)
        assertEquals(
            ".CefriumApplication",
            application.attributes.getNamedItemNS(
                "http://schemas.android.com/apk/res/android", "name"
            ).nodeValue
        )
        assertFalse(File("../app/src/main/AndroidManifest.xml").readText().contains("CefriumApplication"))
    }

    @Test
    fun rendererChoiceIsSetBeforeProvidersWithoutResettingExistingSwitches() {
        val source = File("src/main/java/com/termux/extensions/CefriumApplication.kt").readText()
        assertTrue(source.contains("override fun attachBaseContext(base: Context)"))
        assertTrue(source.contains("if (!CommandLine.isInitialized())"))
        assertTrue(source.contains("appendSwitchWithValue(\"javaless-renderers\", \"disabled\")"))
        assertFalse(source.contains("override fun onCreate"))
        assertFalse(source.contains("Cefrium.initialize("))
        assertFalse(source.contains("CommandLine.reset("))
    }

    @Test
    fun minimizedBuildKeepsChromiumWindowLayoutCallbackAbi() {
        val rules = File("proguard-rules.pro").readText()
        val externalConsumer = "androidx.window.extensions.core.util.function.Consumer"

        assertTrue(rules.contains("-keep,allowobfuscation class * implements $externalConsumer"))
        assertTrue(rules.substringAfter("implements $externalConsumer").contains("accept(java.lang.Object)"))
    }
}
