package com.termux.extensions.nativeeditor.explorer

internal fun nativeExplorerProjectionAfterToggle(
    listings: Map<String, List<NativeExplorerEntry>>,
    expandedDirectories: Set<String>,
    rel: String,
): NativeExplorerProjection {
    if (rel in expandedDirectories) {
        val prefix = "$rel/"
        return NativeExplorerProjection(
            listings = listings.filterKeys { key -> key != rel && !key.startsWith(prefix) },
            expandedDirectories = expandedDirectories.filterNot { key ->
                key == rel || key.startsWith(prefix)
            }.toSet(),
        )
    }
    return NativeExplorerProjection(listings, expandedDirectories + rel)
}

internal fun nativeExplorerProjectionAfterOpenDirectories(
    listings: Map<String, List<NativeExplorerEntry>>,
    openDirectories: Set<String>,
): NativeExplorerProjection = NativeExplorerProjection(
    listings = listings.filterKeys { key -> key == "." || key in openDirectories },
    expandedDirectories = openDirectories,
)

internal fun nativeExplorerRefreshDirectories(expandedDirectories: Set<String>): List<String> =
    buildList {
        add(".")
        addAll(
            expandedDirectories
                .asSequence()
                .filter { it.isNotBlank() && it != "." }
                .sortedWith(compareBy<String>({ it.count { ch -> ch == '/' } }, { it }))
                .toList(),
        )
    }

internal fun nativeExplorerListingsAfterGitDecorations(
    listings: Map<String, List<NativeExplorerEntry>>,
    statuses: Map<String, String>,
): Map<String, List<NativeExplorerEntry>> = listings.mapValues { (_, entries) ->
    entries.map { entry ->
        val status = statuses[entry.rel].orEmpty()
        val flags = if (entry.isDirectory) {
            statuses.asSequence()
                .filter { (path, value) ->
                    value.isNotBlank() && (path == entry.rel || path.startsWith("${entry.rel}/"))
                }
                .map { it.value }
                .flatMap(::nativeExplorerAggregateGitFlags)
                .toSortedSet()
                .toList()
        } else {
            emptyList()
        }
        entry.copy(gitStatus = status, gitFlags = flags)
    }
}

internal fun nativeExplorerListingsAfterDraftDecorations(
    listings: Map<String, List<NativeExplorerEntry>>,
    draftPaths: Set<String>,
): Map<String, List<NativeExplorerEntry>> = listings.mapValues { (_, entries) ->
    entries.map { entry ->
        val hasDraft = if (entry.isDirectory) {
            draftPaths.any { path -> path == entry.rel || path.startsWith("${entry.rel}/") }
        } else {
            entry.rel in draftPaths
        }
        entry.copy(hasDraft = hasDraft)
    }
}

private fun nativeExplorerAggregateGitFlags(status: String): Sequence<String> = when (status) {
    "added", "staged" -> sequenceOf("staged")
    "modified", "deleted", "renamed" -> sequenceOf("modified")
    "staged_modified" -> sequenceOf("staged", "modified")
    "untracked" -> sequenceOf("untracked")
    "conflict" -> sequenceOf("conflict")
    else -> emptySequence()
}
