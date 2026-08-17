package com.termux.extensions

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
