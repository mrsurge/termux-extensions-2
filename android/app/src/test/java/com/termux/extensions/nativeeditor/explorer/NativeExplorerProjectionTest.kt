package com.termux.extensions.nativeeditor.explorer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeExplorerProjectionTest {
    @Test
    fun collapseEvictsDirectoryAndDescendantProjections() {
        val projection = nativeExplorerProjectionAfterToggle(
            listings = mapOf(
                "." to listOf(entry("src", "src", "dir")),
                "src" to listOf(entry("main", "src/main", "dir")),
                "src/main" to listOf(entry("App.kt", "src/main/App.kt", "file")),
            ),
            expandedDirectories = setOf("src", "src/main"),
            rel = "src",
        )

        assertEquals(setOf("."), projection.listings.keys)
        assertTrue(projection.expandedDirectories.isEmpty())
    }

    @Test
    fun refreshIncludesRootAndEveryOpenDirectoryShallowFirst() {
        assertEquals(
            listOf(".", "docs", "src", "src/main", "src/main/java"),
            nativeExplorerRefreshDirectories(setOf("src/main/java", "src", "docs", "src/main")),
        )
    }

    @Test
    fun backendOpenDirectoriesPruneClosedListings() {
        val projection = nativeExplorerProjectionAfterOpenDirectories(
            listings = mapOf(
                "." to emptyList(),
                "src" to emptyList(),
                "src/main" to emptyList(),
            ),
            openDirectories = setOf("src"),
        )

        assertEquals(setOf(".", "src"), projection.listings.keys)
        assertEquals(setOf("src"), projection.expandedDirectories)
    }

    @Test
    fun gitProjectionReplacesFileStatusAndAggregatesDirectoryFlags() {
        val listings = nativeExplorerListingsAfterGitDecorations(
            listings = mapOf(
                "." to listOf(entry("src", "src", "dir")),
                "src" to listOf(entry("App.kt", "src/App.kt", "file", gitStatus = "modified")),
            ),
            statuses = mapOf("src/App.kt" to "staged_modified", "README.md" to "untracked"),
        )

        val directory = listings.getValue(".").single()
        val file = listings.getValue("src").single()
        assertEquals(listOf("modified", "staged"), directory.gitFlags)
        assertEquals("staged_modified", file.gitStatus)
    }

    @Test
    fun draftProjectionClearsStaleFlagsAndAggregatesDirectories() {
        val listings = nativeExplorerListingsAfterDraftDecorations(
            listings = mapOf(
                "." to listOf(entry("src", "src", "dir")),
                "src" to listOf(
                    entry("App.kt", "src/App.kt", "file", hasDraft = true),
                    entry("Other.kt", "src/Other.kt", "file", hasDraft = true),
                ),
            ),
            draftPaths = setOf("src/Other.kt"),
        )

        assertTrue(listings.getValue(".").single().hasDraft)
        assertFalse(listings.getValue("src")[0].hasDraft)
        assertTrue(listings.getValue("src")[1].hasDraft)
    }

    @Test
    fun stickyScopesFollowDeepestDirectoryContainingTheProbe() {
        val root = entry("project", ".", "dir")
        val src = entry("src", "src", "dir")
        val main = entry("main", "src/main", "dir")

        val result = nativeExplorerStickyScopes(
            metrics = listOf(
                NativeExplorerScopeMetric(root, depth = 0, top = -200, bottom = 600),
                NativeExplorerScopeMetric(src, depth = 1, top = -160, bottom = 440),
                NativeExplorerScopeMetric(main, depth = 2, top = -80, bottom = 260),
            ),
            rowHeight = 40,
        )

        assertEquals(listOf(".", "src", "src/main"), result.scopes.map { it.entry.rel })
        assertEquals(0, result.bottomOffset)
    }

    @Test
    fun stickyBottomScopeIsPushedByItsSubtreeBoundary() {
        val result = nativeExplorerStickyScopes(
            metrics = listOf(
                NativeExplorerScopeMetric(entry("project", ".", "dir"), 0, -200, 500),
                NativeExplorerScopeMetric(entry("src", "src", "dir"), 1, -100, 65),
            ),
            rowHeight = 40,
        )

        assertEquals(listOf(".", "src"), result.scopes.map { it.entry.rel })
        assertEquals(-15, result.bottomOffset)
    }

    private fun entry(
        name: String,
        rel: String,
        kind: String,
        gitStatus: String = "",
        hasDraft: Boolean = false,
    ) = NativeExplorerEntry(name, rel, kind, gitStatus, emptyList(), hasDraft)
}
