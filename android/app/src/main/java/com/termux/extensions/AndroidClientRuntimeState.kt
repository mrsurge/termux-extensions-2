package com.termux.extensions

internal data class AndroidClientRuntimeControlSnapshot(
    val generation: Long,
    val frameworkBaseUrl: String,
    val projectionReady: Boolean,
    val projectionTransportAvailable: Boolean,
    val lastError: String?,
)

/**
 * Generation-fenced state for the service-owned Android control plane.
 *
 * Run Target routes themselves intentionally never live here. A service start
 * begins without projection authority, and only a fresh framework SSE snapshot
 * may make the current generation ready. A transient transport loss preserves
 * the last reconciled in-memory listener set until the reconnect snapshot
 * replaces it.
 */
internal class AndroidClientRuntimeState(initialFrameworkBaseUrl: String) {
    private var generation = 1L
    private var frameworkBaseUrl = initialFrameworkBaseUrl
    private var projectionReady = false
    private var projectionTransportAvailable = false
    private var lastError: String? = null

    @Synchronized
    fun configure(nextFrameworkBaseUrl: String): Boolean {
        if (frameworkBaseUrl == nextFrameworkBaseUrl) return false
        frameworkBaseUrl = nextFrameworkBaseUrl
        generation += 1
        projectionReady = false
        projectionTransportAvailable = false
        lastError = null
        return true
    }

    @Synchronized
    fun generation(): Long = generation

    @Synchronized
    fun projectionApplied(candidateGeneration: Long): Boolean {
        if (candidateGeneration != generation) return false
        projectionReady = true
        projectionTransportAvailable = true
        lastError = null
        return true
    }

    @Synchronized
    fun projectionFailed(candidateGeneration: Long, error: Throwable): Boolean {
        if (candidateGeneration != generation) return false
        projectionReady = false
        projectionTransportAvailable = true
        lastError = error.message ?: "Run Target relay reconciliation failed"
        return true
    }

    @Synchronized
    fun transportUnavailable(candidateGeneration: Long, error: Throwable?): Boolean {
        if (candidateGeneration != generation) return false
        projectionTransportAvailable = false
        if (!projectionReady) {
            lastError = error?.message ?: "Run Target projection unavailable"
        }
        return true
    }

    @Synchronized
    fun snapshot(): AndroidClientRuntimeControlSnapshot = AndroidClientRuntimeControlSnapshot(
        generation = generation,
        frameworkBaseUrl = frameworkBaseUrl,
        projectionReady = projectionReady,
        projectionTransportAvailable = projectionTransportAvailable,
        lastError = lastError,
    )
}
