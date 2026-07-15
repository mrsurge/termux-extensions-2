package com.termux.extensions.nativeeditor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeSidebarRuntimePolicyTest {
    @Test
    fun plansEveryOpenSlotRegardlessOfVisibilityOrLoadMode() {
        val inactiveUrl = item(hostId = "url", appId = "")
        val inactiveLazyApp = item(hostId = "agent", appId = "agent")
        val runningApp = item(hostId = "terminal", appId = "terminal")

        val plans = nativeSidebarPersistencePlan(
            listOf(inactiveUrl, inactiveLazyApp, runningApp),
            setOf("terminal"),
        )

        assertEquals(listOf("url", "agent", "terminal"), plans.map { it.item.hostId })
        assertTrue(plans.single { it.item.hostId == "agent" }.startRequired)
        assertEquals(false, plans.single { it.item.hostId == "url" }.startRequired)
        assertEquals(false, plans.single { it.item.hostId == "terminal" }.startRequired)
    }

    @Test
    fun retainsLoadedUrlAcrossProjectionChanges() {
        assertEquals(
            "http://localhost/app/terminal?te2_host_id=terminal:base",
            nativeSidebarRetainedLoadUrl(
                currentUrl = "http://localhost/app/terminal?te2_host_id=terminal:base",
                projectedUrl = "http://localhost/app/terminal?te2_host_id=terminal:base&cwd=/next",
            ),
        )
        assertEquals(
            "http://localhost/app/terminal?te2_host_id=terminal:base",
            nativeSidebarRetainedLoadUrl(
                currentUrl = null,
                projectedUrl = "http://localhost/app/terminal?te2_host_id=terminal:base",
            ),
        )
    }

    private fun item(
        hostId: String,
        appId: String = "",
    ): NativeSidebarItem = NativeSidebarItem(
        hostId = hostId,
        title = "Slot",
        url = "/app/$appId",
        active = false,
        kind = if (appId.isBlank()) "url" else "app",
        appId = appId,
        stateful = appId.isNotBlank(),
        load = "lazy",
        readinessStatus = "ready",
        readinessMessage = "",
    )
}
