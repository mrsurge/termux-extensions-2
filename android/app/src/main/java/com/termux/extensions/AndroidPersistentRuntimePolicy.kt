package com.termux.extensions

internal fun shouldKeepAndroidRendererActive(
    persistentModeEnabled: Boolean,
    remoteAppActive: Boolean,
    frameworkBaseUrl: String,
): Boolean =
    persistentModeEnabled &&
        remoteAppActive &&
        !isAndroidConfiguredFrameworkLoopback(frameworkBaseUrl)

internal enum class AndroidColdRestoreDecision {
    LOAD_LAUNCHER,
    WAIT_FOR_FRESH_PROJECTION,
    LOAD_SAVED_APP,
}

internal fun androidColdRestoreDecision(
    hasSavedRemoteApp: Boolean,
    projectionReady: Boolean,
): AndroidColdRestoreDecision = when {
    !hasSavedRemoteApp -> AndroidColdRestoreDecision.LOAD_LAUNCHER
    projectionReady -> AndroidColdRestoreDecision.LOAD_SAVED_APP
    else -> AndroidColdRestoreDecision.WAIT_FOR_FRESH_PROJECTION
}
