package com.termux.extensions.nativeeditor.sidebar

internal data class NativeSidebarItem(
    val hostId: String,
    val title: String,
    val url: String,
    val active: Boolean,
    val kind: String,
    val appId: String,
    val stateful: Boolean,
    val load: String,
    val readinessStatus: String,
    val readinessMessage: String,
)

internal data class NativeSidebarCatalogItem(
    val appId: String,
    val title: String,
)

internal data class NativeSidebarUiState(
    val items: List<NativeSidebarItem> = emptyList(),
    val catalog: List<NativeSidebarCatalogItem> = emptyList(),
    val activeUrl: String = "",
    val loadedUrls: Map<String, String> = emptyMap(),
    val loading: Boolean = false,
    val message: String = "Select a sidebar app",
    val error: String? = null,
)

internal data class NativeSidebarProjection(
    val activeHostId: String,
    val loadedUrls: Map<String, String>,
    val loading: Boolean,
    val message: String,
    val error: String? = null,
)

internal data class NativeSidebarSlotPlan(
    val item: NativeSidebarItem,
    val startRequired: Boolean,
)
