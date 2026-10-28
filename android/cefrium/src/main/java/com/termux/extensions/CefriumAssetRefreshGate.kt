package com.termux.extensions

/** Acknowledge an asset revision only after a real bypass navigation completes. */
internal class CefriumAssetRefreshGate(
    private val revision: () -> String,
    private val readApplied: () -> String?,
    private val writeApplied: (String) -> Boolean,
    private val reloadBypassingCache: () -> Boolean,
    initiallyDirty: Boolean = false,
) {
    private data class Refresh(val revision: String, val generation: Long, var started: Boolean = false)
    private var applied = if (initiallyDirty) null else readApplied()
    private var generation = 0L
    private var dirty = initiallyDirty
    private var pending: Refresh? = null

    fun invalidate() {
        generation += 1
        dirty = true
    }

    fun onLoadingStarted() {
        pending?.started = true
    }

    fun requestRefresh(): Boolean {
        if (pending != null) return true
        pending = Refresh(revision(), generation)
        if (reloadBypassingCache()) return true
        pending = null
        return false
    }

    /** True holds normal page-ready publication while the bypass is pending. */
    fun onDocumentReady(): Boolean {
        val refresh = pending
        if (refresh != null) {
            if (!refresh.started) return true
            pending = null
            if (refresh.revision == revision() && refresh.generation == generation) {
                applied = refresh.revision
                dirty = false
                // If persistence fails, this process is still fresh. The next
                // process retries migration rather than marking it durable.
                writeApplied(refresh.revision)
                return false
            }
        }
        if (dirty || applied != revision()) {
            requestRefresh()
            return true
        }
        return false
    }
}
