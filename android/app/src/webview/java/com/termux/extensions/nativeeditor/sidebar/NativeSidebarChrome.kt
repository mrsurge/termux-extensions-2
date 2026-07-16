package com.termux.extensions.nativeeditor.sidebar

import android.annotation.SuppressLint
import android.view.View
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView

private val SidebarPanel = Color(0xFF161B22)
private val SidebarRaised = Color(0xFF21262D)
private val SidebarPrimaryText = Color(0xFFF0F6FC)
private val SidebarSecondaryText = Color(0xFF8B949E)
private val SidebarAccent = Color(0xFF58A6FF)
private val SidebarError = Color(0xFFF85149)

/** Persistent native counterpart to the browser sidebar iframe stack. */
@Composable
@OptIn(ExperimentalFoundationApi::class)
internal fun NativeSidebarLayer(
    controller: NativeSidebarRpcController,
    state: NativeSidebarUiState,
    visible: Boolean,
    onClose: () -> Unit,
) {
    val activeItem = state.items.firstOrNull { it.active }
    var appMenuOpen by remember { mutableStateOf(false) }
    var contextHostId by remember { mutableStateOf<String?>(null) }
    Surface(
        modifier = if (visible) Modifier.fillMaxSize() else Modifier.size(1.dp),
        color = if (visible) SidebarPanel else Color.Transparent,
        shadowElevation = if (visible) 8.dp else 0.dp,
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            NativeSidebarWebViewPool(
                items = state.items,
                loadedUrls = state.loadedUrls,
                activeHostId = activeItem?.hostId.orEmpty(),
                visible = visible,
                modifier = if (visible) {
                    Modifier.fillMaxSize().padding(start = 57.dp, top = 49.dp)
                } else {
                    Modifier.size(1.dp)
                },
            )
            if (visible) {
                SidebarHeader(
                    title = activeItem?.title ?: "Sidebar",
                    onClose = onClose,
                    action = {
                        Box {
                            IconButton(onClick = { appMenuOpen = true }) {
                                Icon(Icons.Default.Add, "Open sidebar app", tint = SidebarSecondaryText)
                            }
                            DropdownMenu(
                                expanded = appMenuOpen,
                                onDismissRequest = { appMenuOpen = false },
                            ) {
                                state.catalog
                                    .filter { catalog ->
                                        state.items.none { item -> item.appId == catalog.appId }
                                    }
                                    .forEach { app ->
                                        DropdownMenuItem(
                                            text = { Text(app.title) },
                                            onClick = {
                                                appMenuOpen = false
                                                controller.openApp(app.appId)
                                            },
                                        )
                                    }
                            }
                        }
                    },
                )
                LazyColumn(
                    modifier = Modifier.padding(top = 49.dp).width(56.dp).fillMaxHeight()
                        .background(SidebarRaised).padding(vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    items(state.items, key = { it.hostId }) { item ->
                        Box(
                            modifier = Modifier.fillMaxWidth().height(48.dp)
                                .background(
                                    if (item.active) SidebarAccent.copy(alpha = 0.2f) else Color.Transparent,
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(
                                modifier = Modifier.fillMaxSize().combinedClickable(
                                    onClick = { controller.activate(item.hostId) },
                                    onLongClick = { contextHostId = item.hostId },
                                ),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    item.title.trim().take(1).uppercase().ifBlank { "S" },
                                    color = if (item.active) SidebarAccent else SidebarSecondaryText,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                            DropdownMenu(
                                expanded = contextHostId == item.hostId,
                                onDismissRequest = { contextHostId = null },
                            ) {
                                DropdownMenuItem(
                                    text = { Text("Close ${item.title}") },
                                    leadingIcon = { Icon(Icons.Default.Close, null) },
                                    onClick = {
                                        contextHostId = null
                                        controller.close(item.hostId)
                                    },
                                )
                            }
                        }
                    }
                }
                if (state.activeUrl.isBlank()) {
                    Box(
                        modifier = Modifier.fillMaxSize().padding(start = 57.dp, top = 49.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            if (state.loading) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                            }
                            Text(
                                state.error ?: state.message,
                                color = if (state.error == null) SidebarSecondaryText else SidebarError,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SidebarHeader(
    title: String,
    onClose: () -> Unit,
    action: @Composable (() -> Unit),
) {
    Row(
        modifier = Modifier.fillMaxWidth().height(49.dp).background(SidebarPanel)
            .padding(start = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            color = SidebarPrimaryText,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        action()
        IconButton(onClick = onClose) {
            Icon(Icons.Default.Close, "Close sidebar", tint = SidebarSecondaryText)
        }
    }
}

/** Owns one attached WebView for every backend sidebar slot. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun NativeSidebarWebViewPool(
    items: List<NativeSidebarItem>,
    loadedUrls: Map<String, String>,
    activeHostId: String,
    visible: Boolean,
    modifier: Modifier,
) {
    val webViews = remember { linkedMapOf<String, WebView>() }
    AndroidView(
        factory = { FrameLayout(it) },
        update = { container ->
            val desiredHostIds = items.mapTo(mutableSetOf()) { it.hostId }
            webViews.keys.filter { it !in desiredHostIds }.forEach { hostId ->
                webViews.remove(hostId)?.let { view ->
                    container.removeView(view)
                    view.stopLoading()
                    view.destroy()
                }
            }
            items.forEach { item ->
                val view = webViews.getOrPut(item.hostId) {
                    WebView(container.context).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.cacheMode = WebSettings.LOAD_DEFAULT
                        webViewClient = WebViewClient()
                        visibility = View.INVISIBLE
                        container.addView(
                            this,
                            FrameLayout.LayoutParams(
                                FrameLayout.LayoutParams.MATCH_PARENT,
                                FrameLayout.LayoutParams.MATCH_PARENT,
                            ),
                        )
                    }
                }
                val targetUrl = loadedUrls[item.hostId].orEmpty()
                if (targetUrl.isNotBlank() && view.tag != targetUrl) {
                    view.tag = targetUrl
                    view.loadUrl(targetUrl)
                }
                view.visibility = if (visible && item.hostId == activeHostId && targetUrl.isNotBlank()) {
                    View.VISIBLE
                } else {
                    View.INVISIBLE
                }
            }
        },
        modifier = modifier,
    )
    DisposableEffect(Unit) {
        onDispose {
            webViews.values.forEach { view ->
                (view.parent as? FrameLayout)?.removeView(view)
                view.stopLoading()
                view.destroy()
            }
            webViews.clear()
        }
    }
}
