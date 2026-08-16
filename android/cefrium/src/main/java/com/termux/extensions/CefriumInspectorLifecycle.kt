package com.termux.extensions

internal fun shouldStartCefriumInspector(
    enabled: Boolean,
    mainBrowserReady: Boolean,
    toolsVisible: Boolean,
    inspectorSelected: Boolean,
): Boolean = enabled && mainBrowserReady && toolsVisible && inspectorSelected

internal fun shouldDeliverCefriumInspectorGeneration(
    clientReady: Boolean,
    generation: Long,
    deliveredGeneration: Long,
): Boolean = clientReady && generation > 0L && generation != deliveredGeneration

internal fun shouldRequestCefriumInspectorClientReady(
    isLoading: Boolean,
    clientReady: Boolean,
): Boolean = !isLoading && !clientReady
