package com.termux.extensions

internal data class CefriumDevToolsPolicy(
    val runProfilesEnabled: Boolean,
    val debugTargetsEnabled: Boolean,
    val surfaces: Map<String, AndroidDevRuntimeSurface>,
)

internal fun cefriumDevToolsPolicy(
    runProfilesEnabled: Boolean,
    debugTargetsEnabled: Boolean,
    surfaces: List<AndroidDevRuntimeSurface>,
): CefriumDevToolsPolicy = CefriumDevToolsPolicy(
    runProfilesEnabled = runProfilesEnabled,
    debugTargetsEnabled = debugTargetsEnabled,
    surfaces = surfaces
        .filter { it.devRuntime || (runProfilesEnabled && it.devTools) }
        .associateBy(AndroidDevRuntimeSurface::surfaceId),
)

internal fun shouldReconcileCefriumDevToolsPolicy(
    current: CefriumDevToolsPolicy,
    next: CefriumDevToolsPolicy,
): Boolean = current != next

internal fun shouldStartCefriumInspector(
    enabled: Boolean,
    mainBrowserReady: Boolean,
    appShellActive: Boolean,
): Boolean = enabled && mainBrowserReady && appShellActive

internal fun shouldStartCefriumDevToolsRuntime(
    inspectorEnabled: Boolean,
    hasDevRuntimeSurface: Boolean,
    mainBrowserReady: Boolean,
    appShellActive: Boolean,
): Boolean =
    (inspectorEnabled || hasDevRuntimeSurface) && mainBrowserReady && appShellActive

internal fun shouldResumeCefriumInspectorBrowser(
    activityResumed: Boolean,
    browserCreated: Boolean,
    resumeExisting: Boolean,
): Boolean = activityResumed && (browserCreated || resumeExisting)

internal fun shouldDeliverCefriumInspectorGeneration(
    clientReady: Boolean,
    generation: Long,
    deliveredGeneration: Long,
    forceReplay: Boolean = false,
): Boolean =
    clientReady &&
        generation > 0L &&
        (forceReplay || generation != deliveredGeneration)

internal fun shouldRequestCefriumInspectorClientReady(
    isLoading: Boolean,
    clientReady: Boolean,
): Boolean = !isLoading && !clientReady
