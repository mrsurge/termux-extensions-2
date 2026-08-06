package com.termux.extensions

import java.net.URI

internal enum class AndroidClientStartupPhase {
    LOCKED,
    FRAMEWORK_RELAY_PENDING,
    ROUTE_SNAPSHOT_PENDING,
    RUN_TARGETS_RECONCILING,
    READY,
}

internal sealed interface AndroidClientStartupAction {
    data class RestoreSession(val health: AndroidRemoteAppHealth) : AndroidClientStartupAction

    data class Navigate(val url: String) : AndroidClientStartupAction

    data object LoadHome : AndroidClientStartupAction
}

/**
 * Event-driven startup gate for remote Gecko sessions.
 *
 * A saved page may be restored only after the configured framework relay is
 * ready and a fresh framework-owned Run Target projection has been reconciled
 * into native loopback listeners.
 */
internal class AndroidClientStartupState {
    private val lock = Any()
    private var generation = 0L
    private var phase = AndroidClientStartupPhase.LOCKED
    private var restoreRequested = false
    private var restoreHealth: AndroidRemoteAppHealth? = null
    private var pendingNavigationUrl: String? = null
    private var loadHomeRequested = false

    fun begin(
        restoreSavedSession: Boolean,
        loadHomeWhenReady: Boolean = false,
    ): Long = synchronized(lock) {
        generation += 1
        phase = AndroidClientStartupPhase.FRAMEWORK_RELAY_PENDING
        restoreRequested = restoreSavedSession
        restoreHealth = null
        pendingNavigationUrl = null
        loadHomeRequested = loadHomeWhenReady
        generation
    }

    fun isCurrent(candidate: Long): Boolean = synchronized(lock) {
        candidate == generation
    }

    fun markFrameworkRelayReady(candidate: Long): Boolean = synchronized(lock) {
        if (
            candidate != generation ||
            phase != AndroidClientStartupPhase.FRAMEWORK_RELAY_PENDING
        ) {
            return@synchronized false
        }
        phase = AndroidClientStartupPhase.ROUTE_SNAPSHOT_PENDING
        true
    }

    fun markProjectionReceived(candidate: Long): Boolean = synchronized(lock) {
        if (candidate != generation) return@synchronized false
        if (
            phase != AndroidClientStartupPhase.ROUTE_SNAPSHOT_PENDING &&
            phase != AndroidClientStartupPhase.RUN_TARGETS_RECONCILING &&
            phase != AndroidClientStartupPhase.READY
        ) return@synchronized false
        phase = AndroidClientStartupPhase.RUN_TARGETS_RECONCILING
        true
    }

    fun markProjectionReady(candidate: Long): AndroidClientStartupAction? = synchronized(lock) {
        if (
            candidate != generation ||
            phase != AndroidClientStartupPhase.RUN_TARGETS_RECONCILING
        ) {
            return@synchronized null
        }
        phase = AndroidClientStartupPhase.READY
        drainReadyActionLocked()
    }

    fun markProjectionFailed(candidate: Long) = synchronized(lock) {
        if (
            candidate == generation &&
            phase == AndroidClientStartupPhase.RUN_TARGETS_RECONCILING
        ) {
            phase = AndroidClientStartupPhase.ROUTE_SNAPSHOT_PENDING
        }
    }

    fun markAuthorityUnavailable(candidate: Long) = synchronized(lock) {
        if (
            candidate == generation &&
            phase != AndroidClientStartupPhase.LOCKED &&
            phase != AndroidClientStartupPhase.FRAMEWORK_RELAY_PENDING
        ) {
            phase = AndroidClientStartupPhase.ROUTE_SNAPSHOT_PENDING
        }
    }

    fun recordRestoreHealth(
        candidate: Long,
        health: AndroidRemoteAppHealth,
    ): AndroidClientStartupAction? = synchronized(lock) {
        if (candidate != generation || !restoreRequested) return@synchronized null
        restoreHealth = health
        if (phase == AndroidClientStartupPhase.READY) drainReadyActionLocked() else null
    }

    /** Returns true when navigation was retained behind the startup gate. */
    fun gateAppNavigation(url: String): Boolean = synchronized(lock) {
        // The launcher is intentionally usable while the framework projection
        // stream is reconnecting. Only a real cold-session restore owns a
        // navigation gate; ordinary launcher/Recents app opens must not wait.
        if (phase == AndroidClientStartupPhase.READY || !restoreRequested) {
            return@synchronized false
        }
        pendingNavigationUrl = url
        restoreRequested = false
        restoreHealth = null
        true
    }

    fun cancelPendingRestore() = synchronized(lock) {
        restoreRequested = false
        restoreHealth = null
        pendingNavigationUrl = null
        loadHomeRequested = false
    }

    fun isReady(): Boolean = synchronized(lock) {
        phase == AndroidClientStartupPhase.READY
    }

    fun phaseName(): String = synchronized(lock) { phase.name }

    private fun drainReadyActionLocked(): AndroidClientStartupAction? {
        pendingNavigationUrl?.let { url ->
            pendingNavigationUrl = null
            return AndroidClientStartupAction.Navigate(url)
        }
        if (restoreRequested) {
            val health = restoreHealth ?: return null
            restoreRequested = false
            restoreHealth = null
            return AndroidClientStartupAction.RestoreSession(health)
        }
        if (loadHomeRequested) {
            loadHomeRequested = false
            return AndroidClientStartupAction.LoadHome
        }
        return null
    }
}

internal fun androidSavedAppOrigin(url: String?): String? {
    if (url.isNullOrBlank()) return null
    return runCatching {
        val uri = URI(url)
        val path = uri.path.orEmpty()
        require(uri.scheme in setOf("http", "https"))
        require(uri.host != null)
        require(path == "/app" || path.startsWith("/app/"))
        URI(uri.scheme, null, uri.host, uri.port, null, null, null).toASCIIString()
    }.getOrNull()
}

internal fun androidSavedLauncherOrigin(serializedState: String?): String? {
    if (serializedState.isNullOrBlank()) return null
    return ANDROID_LAUNCHER_ORIGIN_PATTERN.find(
        serializedState.replace("\\/", "/"),
    )?.value
}

internal fun rewriteAndroidSavedSessionPayload(
    serializedState: String,
    previousFrameworkOrigin: String?,
    currentFrameworkOrigin: String,
    previousLauncherOrigin: String?,
    currentLauncherOrigin: String?,
): String {
    var rewritten = serializedState
    val replacements = listOf(
        previousFrameworkOrigin to currentFrameworkOrigin,
        previousLauncherOrigin to currentLauncherOrigin,
    ).filter { (previous, current) ->
        !previous.isNullOrBlank() && !current.isNullOrBlank() && previous != current
    }.sortedByDescending { (previous, _) -> previous.orEmpty().length }
    replacements.forEach { (previous, current) ->
        val oldOrigin = checkNotNull(previous)
        val newOrigin = checkNotNull(current)
        rewritten = rewritten
            .replace(oldOrigin.replace("/", "\\/"), newOrigin.replace("/", "\\/"))
            .replace(oldOrigin, newOrigin)
    }
    return rewritten
}

internal fun androidSavedSessionOriginsMatch(
    previousFrameworkOrigin: String?,
    currentFrameworkOrigin: String?,
    previousLauncherOrigin: String?,
    currentLauncherOrigin: String?,
): Boolean =
    !previousFrameworkOrigin.isNullOrBlank() &&
        !currentFrameworkOrigin.isNullOrBlank() &&
        !previousLauncherOrigin.isNullOrBlank() &&
        !currentLauncherOrigin.isNullOrBlank() &&
        previousFrameworkOrigin == currentFrameworkOrigin &&
        previousLauncherOrigin == currentLauncherOrigin

private val ANDROID_LAUNCHER_ORIGIN_PATTERN = Regex(
    """https?://(?:127\.0\.0\.1|localhost|\[::1])(?::\d+)?(?=/android-shell/)""",
    RegexOption.IGNORE_CASE,
)
