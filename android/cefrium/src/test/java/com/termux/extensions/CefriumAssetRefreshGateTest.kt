package com.termux.extensions

import org.junit.Assert.*
import org.junit.Test

class CefriumAssetRefreshGateTest {
    private class Fixture(appliedRevision: String? = null, initiallyDirty: Boolean = false) {
        var revision = "no-store-v1:0.2.356"
        var applied = appliedRevision
        var reloads = 0
        var available = true
        val writes = mutableListOf<String>()
        val gate = CefriumAssetRefreshGate(
            revision = { revision }, readApplied = { applied },
            writeApplied = { applied = it; writes += it; true },
            reloadBypassingCache = { reloads += 1; available },
            initiallyDirty = initiallyDirty,
        )
    }

    @Test fun legacyCacheRequiresBypassStartAndCompletionBeforeAcknowledgment() {
        val f = Fixture()
        assertTrue(f.gate.onDocumentReady())
        assertEquals(1, f.reloads)
        assertTrue(f.gate.onDocumentReady())
        assertTrue(f.writes.isEmpty())
        assertEquals(1, f.reloads)
        f.gate.onLoadingStarted()
        assertFalse(f.gate.onDocumentReady())
        assertEquals(listOf(f.revision), f.writes)
        assertFalse(f.gate.onDocumentReady())
        assertEquals(1, f.reloads)
    }

    @Test fun migratedStartupDoesNotAddAnExtraReload() {
        val f = Fixture("no-store-v1:0.2.356")
        assertFalse(f.gate.onDocumentReady())
        assertEquals(0, f.reloads)
    }

    @Test fun newApkSeedAndSameVersionForceUpdateBothInvalidateMigration() {
        val f = Fixture("no-store-v1:0.2.356", initiallyDirty = true)
        assertTrue(f.gate.onDocumentReady())
        f.gate.onLoadingStarted()
        assertFalse(f.gate.onDocumentReady())
        f.gate.invalidate()
        assertTrue(f.gate.requestRefresh())
        f.gate.onLoadingStarted()
        assertFalse(f.gate.onDocumentReady())
        assertEquals(2, f.reloads)
        assertEquals(2, f.writes.size)
    }

    @Test fun updateDuringBypassCannotAcknowledgeAnOlderProjection() {
        val f = Fixture()
        assertTrue(f.gate.onDocumentReady())
        f.gate.onLoadingStarted()
        f.gate.invalidate()
        assertTrue(f.gate.onDocumentReady())
        assertTrue(f.writes.isEmpty())
        assertEquals(2, f.reloads)
        f.gate.onLoadingStarted()
        assertFalse(f.gate.onDocumentReady())
        assertEquals(listOf(f.revision), f.writes)
    }

    @Test fun revisionChangeDuringBypassRequiresTheNewRevision() {
        val f = Fixture()
        assertTrue(f.gate.onDocumentReady())
        f.gate.onLoadingStarted()
        f.revision = "no-store-v1:0.2.357"
        assertTrue(f.gate.onDocumentReady())
        assertTrue(f.writes.isEmpty())
        f.gate.onLoadingStarted()
        assertFalse(f.gate.onDocumentReady())
        assertEquals(listOf(f.revision), f.writes)
    }

    @Test fun unavailableRendererCannotReportSuccessfulMigration() {
        val f = Fixture()
        f.available = false
        assertTrue(f.gate.onDocumentReady())
        assertTrue(f.writes.isEmpty())
        f.available = true
        assertTrue(f.gate.onDocumentReady())
        f.gate.onLoadingStarted()
        assertFalse(f.gate.onDocumentReady())
        assertEquals(listOf(f.revision), f.writes)
    }
}
