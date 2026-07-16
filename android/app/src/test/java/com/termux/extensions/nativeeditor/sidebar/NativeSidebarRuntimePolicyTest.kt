package com.termux.extensions.nativeeditor.sidebar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
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

    @Test
    fun rejectsActivationDeltaAsFullLedger() {
        assertNull(
            nativeSidebarLedgerState(
                mapOf(
                    "client_id" to "main_page",
                    "host_id" to "terminal:base",
                    "hostId" to "terminal:base",
                    "ts" to 123L,
                ),
            ),
        )
    }

    @Test
    fun acceptsDirectAndNestedFullLedgers() {
        val ledger = mapOf<String, Any?>(
            "slots" to mapOf("terminal:base" to mapOf("host_id" to "terminal:base")),
            "order" to listOf("launcher", "terminal:base"),
            "active_host_id" to "terminal:base",
        )

        assertSame(ledger, nativeSidebarLedgerState(ledger))
        assertEquals(ledger, nativeSidebarLedgerState(mapOf("state" to ledger)))
    }

    @Test
    fun activationDeltaPreservesSlotsAndChangesOnlyActiveFlags() {
        val explorer = item(hostId = "explorer", appId = "explorer", active = true)
        val terminal = item(hostId = "terminal", appId = "terminal")
        val items = listOf(explorer, terminal)

        val activated = nativeSidebarItemsAfterActivation(items, "terminal")

        assertEquals(listOf("explorer", "terminal"), activated.map { it.hostId })
        assertEquals(listOf(false, true), activated.map { it.active })
        assertEquals(items.map { it.url }, activated.map { it.url })
        assertSame(items, nativeSidebarItemsAfterActivation(items, "missing"))
    }

    private fun item(
        hostId: String,
        appId: String = "",
        active: Boolean = false,
    ): NativeSidebarItem = NativeSidebarItem(
        hostId = hostId,
        title = "Slot",
        url = "/app/$appId",
        active = active,
        kind = if (appId.isBlank()) "url" else "app",
        appId = appId,
        stateful = appId.isNotBlank(),
        load = "lazy",
        readinessStatus = "ready",
        readinessMessage = "",
    )
}
