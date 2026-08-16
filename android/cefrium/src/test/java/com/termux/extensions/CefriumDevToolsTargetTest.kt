package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CefriumDevToolsTargetTest {
    @Test
    fun preferredTargetWins() {
        val targets = listOf(
            target("app", "http://127.0.0.1/app/code_te2"),
            target("processes", "http://127.0.0.1/fws"),
        )

        assertEquals(
            "processes",
            chooseCefriumDevToolsTarget(targets, "processes")?.targetId,
        )
    }

    @Test
    fun appTargetIsTheDefault() {
        val targets = listOf(
            target("processes", "http://127.0.0.1/fws"),
            target("app", "http://127.0.0.1/app/code_te2"),
        )

        assertEquals("app", chooseCefriumDevToolsTarget(targets, null)?.targetId)
    }

    @Test
    fun ordinaryPageWinsOverProcesses() {
        val targets = listOf(
            target("processes", "http://127.0.0.1/fws"),
            target("page", "https://example.test/preview"),
        )

        assertEquals("page", chooseCefriumDevToolsTarget(targets, null)?.targetId)
    }

    @Test
    fun emptyTargetSetHasNoSelection() {
        assertNull(chooseCefriumDevToolsTarget(emptyList(), null))
    }

    @Test
    fun cefriumOtherTargetCanBeSelected() {
        val target = CefriumDevToolsTarget(
            targetId = "settings",
            title = "Android Settings",
            url = "http://127.0.0.1/android-shell/settings.html",
            type = "other",
        )

        assertTrue(isInspectableCefriumDevToolsTarget(target))
    }

    @Test
    fun inspectorDocumentIsNotInspectable() {
        val target = CefriumDevToolsTarget(
            targetId = "inspector",
            title = "Inspector",
            url = "file:///android_asset/devtools_inspector/index.html",
            type = "other",
        )

        assertFalse(isInspectableCefriumDevToolsTarget(target))
    }

    @Test
    fun loopbackInspectorDocumentIsNotInspectable() {
        val target = CefriumDevToolsTarget(
            targetId = "inspector",
            title = "Inspector",
            url = "http://127.0.0.1:45000/android-cefrium-devtools/inspector.html",
            type = "other",
        )

        assertFalse(isInspectableCefriumDevToolsTarget(target))
    }

    @Test
    fun targetWithoutUrlIsNotInspectable() {
        val target = CefriumDevToolsTarget(
            targetId = "pending",
            title = "",
            url = "",
            type = "other",
        )

        assertFalse(isInspectableCefriumDevToolsTarget(target))
    }

    private fun target(id: String, url: String) = CefriumDevToolsTarget(
        targetId = id,
        title = id,
        url = url,
        type = "page",
    )
}
