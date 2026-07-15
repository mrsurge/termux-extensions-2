package com.termux.extensions.nativeeditor

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Typeface
import android.view.View
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.ViewSidebar
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import io.github.rosemoe.sora.event.ContentChangeEvent
import io.github.rosemoe.sora.lang.diagnostic.DiagnosticDetail
import io.github.rosemoe.sora.lang.diagnostic.DiagnosticRegion
import io.github.rosemoe.sora.lang.diagnostic.DiagnosticsContainer
import io.github.rosemoe.sora.widget.CodeEditor
import io.github.rosemoe.sora.widget.subscribeAlways
import com.termux.extensions.nativeeditor.explorer.NativeExplorerOverlay
import com.termux.extensions.nativeeditor.structure.NativeEditorStructureBlock
import com.termux.extensions.nativeeditor.structure.NativeStructureLanguage
import kotlin.math.max

private val Background = Color(0xFF0D1117)
private val Panel = Color(0xFF161B22)
private val Raised = Color(0xFF21262D)
private val Border = Color(0xFF30363D)
private val PrimaryText = Color(0xFFF0F6FC)
private val SecondaryText = Color(0xFF8B949E)
private val Accent = Color(0xFF58A6FF)
private val Error = Color(0xFFF85149)
private val Warning = Color(0xFFD29922)
private val Success = Color(0xFF3FB950)

@Composable
internal fun NativeCodeTe2Screen(
    controller: NativeEditorController,
    onHome: () -> Unit,
    onReload: () -> Unit,
    onQuit: () -> Unit,
    onTools: () -> Unit,
) {
    val state by controller.state
    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = Background) {
            Column(modifier = Modifier.fillMaxSize()) {
                NativeEditorToolbar(
                    state = state,
                    controller = controller,
                    onHome = onHome,
                    onReload = onReload,
                    onQuit = onQuit,
                    onTools = onTools,
                )
                Divider(color = Border)
                Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    NativeSoraEditor(controller, state)
                    NativeOverlay(controller, state)
                    PersistentSidebarLayer(controller, state)
                    if (state.projectSwitching) {
                        Box(
                            modifier = Modifier.fillMaxSize().background(Color(0xAA0D1117)),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(color = Accent)
                        }
                    }
                }
                NativeStatusBar(state)
            }
        }
    }
}

@Composable
private fun NativeEditorToolbar(
    state: NativeEditorUiState,
    controller: NativeEditorController,
    onHome: () -> Unit,
    onReload: () -> Unit,
    onQuit: () -> Unit,
    onTools: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier.fillMaxWidth().height(48.dp).background(Panel),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = { controller.setOverlay(NativeEditorOverlay.EXPLORER) }) {
            Icon(Icons.Default.Folder, "Explorer", tint = overlayTint(state, NativeEditorOverlay.EXPLORER))
        }
        IconButton(onClick = { controller.setOverlay(NativeEditorOverlay.SEARCH) }) {
            Icon(Icons.Default.Search, "Search", tint = overlayTint(state, NativeEditorOverlay.SEARCH))
        }
        IconButton(onClick = { controller.setOverlay(NativeEditorOverlay.PROBLEMS) }) {
            Icon(Icons.Default.ErrorOutline, "Problems", tint = overlayTint(state, NativeEditorOverlay.PROBLEMS))
        }
        IconButton(onClick = { controller.setOverlay(NativeEditorOverlay.SIDEBAR) }) {
            Icon(Icons.Default.ViewSidebar, "Sidebar", tint = overlayTint(state, NativeEditorOverlay.SIDEBAR))
        }
        Text(
            text = state.document?.relativePath?.substringAfterLast('/') ?: "Code TE2",
            color = PrimaryText,
            fontSize = 13.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).padding(horizontal = 6.dp),
        )
        if (state.document?.unsaved == true) {
            Text("●", color = Accent, fontSize = 10.sp)
        }
        IconButton(onClick = controller::save, enabled = state.document != null) {
            Icon(Icons.Default.Save, "Save", tint = if (state.document != null) PrimaryText else SecondaryText)
        }
        IconButton(onClick = controller::runActiveFile, enabled = state.document != null) {
            Icon(Icons.Default.PlayArrow, "Run", tint = if (state.document != null) Success else SecondaryText)
        }
        Box {
            IconButton(onClick = { menuOpen = true }) {
                Icon(Icons.Default.MoreVert, "More", tint = PrimaryText)
            }
            DropdownMenu(
                expanded = menuOpen,
                onDismissRequest = { menuOpen = false },
            ) {
                DropdownMenuItem(
                    text = { Text("Home") },
                    leadingIcon = { Icon(Icons.Default.Home, null) },
                    onClick = { menuOpen = false; onHome() },
                )
                DropdownMenuItem(
                    text = { Text("Reconnect") },
                    leadingIcon = { Icon(Icons.Default.Refresh, null) },
                    onClick = { menuOpen = false; onReload() },
                )
                DropdownMenuItem(
                    text = { Text("Tools") },
                    leadingIcon = { Icon(Icons.Default.Settings, null) },
                    onClick = { menuOpen = false; onTools() },
                )
                DropdownMenuItem(
                    text = { Text("Quit Code TE2") },
                    leadingIcon = { Icon(Icons.Default.Close, null) },
                    onClick = { menuOpen = false; onQuit() },
                )
            }
        }
    }
}

@Composable
private fun NativeSoraEditor(controller: NativeEditorController, state: NativeEditorUiState) {
    AndroidView(
        factory = { context -> NativeSoraEditorView(context, controller) },
        modifier = Modifier.fillMaxSize(),
        update = { editor ->
            editor.render(
                state.document,
                state.document?.let { state.diagnostics[it.path] }.orEmpty(),
                state.textMateReady,
                state.structureBlocks,
            )
        },
        onRelease = { editor -> editor.release() },
    )
}

private class NativeSoraEditorView(
    context: Context,
    private val controller: NativeEditorController,
) : CodeEditor(context) {
    private var applyingBackendText = false
    private var activePath = ""
    private var activeLanguageId = ""
    private var activeStructureLanguage: NativeStructureLanguage? = null
    private var textMateSchemeInstalled = false

    init {
        setTypefaceText(Typeface.MONOSPACE)
        setTextSize(14f)
        isLineNumberEnabled = true
        isWordwrap = false
        props.stickyScroll = true
        props.stickyScrollMaxLines = 4
        props.stickyScrollPreferInnerScope = true
        subscribeAlways<ContentChangeEvent> { event ->
            if (!applyingBackendText && event.action != ContentChangeEvent.ACTION_SET_NEW_TEXT) {
                controller.onDocumentChanged(text.toString())
            }
        }
    }

    fun render(
        document: NativeDocument?,
        diagnostics: List<NativeDiagnostic>,
        textMateReady: Boolean,
        structureBlocks: List<NativeEditorStructureBlock>,
    ) {
        if (textMateReady && !textMateSchemeInstalled) {
            controller.textMate.install()?.let {
                colorScheme = it
                textMateSchemeInstalled = true
            }
        }
        if (document == null) {
            activeStructureLanguage?.updateStructureBlocks(emptyList())
            if (activePath.isNotEmpty()) {
                applyingBackendText = true
                setText("")
                applyingBackendText = false
                activePath = ""
            }
            setDiagnostics(null)
            return
        }
        val nextLanguageId = "${document.languageId}:$textMateReady"
        if (activeLanguageId != nextLanguageId) {
            val language = controller.textMate.language(document.languageId, controller::completions)
            activeStructureLanguage = language
            setEditorLanguage(language)
            activeLanguageId = nextLanguageId
        }
        activeStructureLanguage?.updateStructureBlocks(structureBlocks)
        if (activePath != document.path) {
            applyingBackendText = true
            try {
                setText(document.content)
            } finally {
                applyingBackendText = false
            }
            activePath = document.path
        } else if (text.toString() != document.content) {
            replaceProjectedContent(document.content)
        }
        applyDiagnostics(diagnostics)
    }

    /** Applies a same-document backend projection as one edit without losing selection. */
    private fun replaceProjectedContent(content: String) {
        val leftIndex = cursor.left.coerceIn(0, content.length)
        val rightIndex = cursor.right.coerceIn(0, content.length)
        applyingBackendText = true
        text.beginBatchEdit()
        try {
            text.replace(0, text.length, content)
        } finally {
            text.endBatchEdit()
            applyingBackendText = false
        }
        val left = text.indexer.getCharPosition(leftIndex)
        val right = text.indexer.getCharPosition(rightIndex)
        setSelectionRegion(left.line, left.column, right.line, right.column)
    }

    private fun applyDiagnostics(items: List<NativeDiagnostic>) {
        if (items.isEmpty()) {
            setDiagnostics(null)
            return
        }
        val container = DiagnosticsContainer(false)
        items.forEachIndexed { index, item ->
            try {
                val startLine = (item.startLine - 1).coerceIn(0, max(0, text.lineCount - 1))
                val endLine = (item.endLine - 1).coerceIn(startLine, max(0, text.lineCount - 1))
                val startColumn = (item.startColumn - 1).coerceIn(0, text.getColumnCount(startLine))
                val endColumn = (item.endColumn - 1).coerceIn(0, text.getColumnCount(endLine))
                val startIndex = text.getCharIndex(startLine, startColumn)
                val endIndex = max(startIndex + 1, text.getCharIndex(endLine, endColumn))
                val severity = when (item.severity) {
                    8 -> DiagnosticRegion.SEVERITY_ERROR
                    4 -> DiagnosticRegion.SEVERITY_WARNING
                    2 -> DiagnosticRegion.SEVERITY_TYPO
                    else -> DiagnosticRegion.SEVERITY_NONE
                }
                container.addDiagnostic(
                    DiagnosticRegion(
                        startIndex,
                        endIndex.coerceAtMost(text.length),
                        severity,
                        index.toLong(),
                        DiagnosticDetail(item.message, item.message),
                    ),
                )
            } catch (_: Exception) {
            }
        }
        setDiagnostics(container)
    }
}

@Composable
private fun NativeOverlay(controller: NativeEditorController, state: NativeEditorUiState) {
    if (state.overlay == NativeEditorOverlay.NONE || state.overlay == NativeEditorOverlay.SIDEBAR) return
    Box(
        modifier = Modifier.fillMaxSize().background(Color(0x66000000))
            .clickable(onClick = controller::closeOverlay),
    ) {
        Surface(
            modifier = Modifier.fillMaxHeight().fillMaxWidth(0.9f).clickable {},
            color = Panel,
            shadowElevation = 8.dp,
        ) {
            when (state.overlay) {
                NativeEditorOverlay.EXPLORER -> {
                    val explorerState by controller.explorer.state
                    NativeExplorerOverlay(
                        state = explorerState,
                        projectPath = state.projectPath,
                        diagnostics = state.diagnostics,
                        onClose = controller::closeOverlay,
                        onRefresh = controller::refreshExplorer,
                        onToggleDirectory = controller::toggleDirectory,
                        onOpenFile = { controller.openFile(it) },
                    )
                }
                NativeEditorOverlay.SEARCH -> SearchOverlay(controller, state)
                NativeEditorOverlay.PROBLEMS -> ProblemsOverlay(controller, state)
                NativeEditorOverlay.SIDEBAR -> Unit
                NativeEditorOverlay.NONE -> Unit
            }
        }
    }
}

@Composable
private fun OverlayHeader(title: String, onClose: () -> Unit, action: (@Composable () -> Unit)? = null) {
    Row(
        modifier = Modifier.fillMaxWidth().height(48.dp).padding(start = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, color = PrimaryText, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        action?.invoke()
        IconButton(onClick = onClose) {
            Icon(Icons.Default.Close, "Close", tint = SecondaryText)
        }
    }
    Divider(color = Border)
}

@Composable
private fun SearchOverlay(controller: NativeEditorController, state: NativeEditorUiState) {
    Column(modifier = Modifier.fillMaxSize()) {
        OverlayHeader("Search", controller::closeOverlay)
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(
                selected = state.searchMode == "content",
                onClick = { controller.setSearchMode("content") },
                label = { Text("Content") },
            )
            FilterChip(
                selected = state.searchMode == "name",
                onClick = { controller.setSearchMode("name") },
                label = { Text("Files") },
            )
        }
        OutlinedTextField(
            value = state.searchQuery,
            onValueChange = controller::setSearchQuery,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            singleLine = true,
            label = { Text("Search project") },
            trailingIcon = {
                IconButton(onClick = { if (state.searchRunning) controller.cancelSearch() else controller.runSearch() }) {
                    Icon(if (state.searchRunning) Icons.Default.Stop else Icons.Default.Search, if (state.searchRunning) "Cancel" else "Search")
                }
            },
        )
        Spacer(Modifier.height(8.dp))
        LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth()) {
            items(state.searchResults) { result ->
                Column(
                    modifier = Modifier.fillMaxWidth()
                        .clickable { controller.openFile(result.path.ifBlank { result.relativePath }, result.line, result.column) }
                        .padding(horizontal = 14.dp, vertical = 9.dp),
                ) {
                    Text(result.relativePath, color = PrimaryText, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (result.preview.isNotBlank()) {
                        Text(
                            result.preview.trim(),
                            color = SecondaryText,
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Divider(color = Border)
            }
            if (state.searchNextCursor.isNotBlank()) {
                item {
                    Button(
                        onClick = controller::loadMoreSearch,
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                    ) { Text("Load more") }
                }
            }
        }
    }
}

@Composable
private fun ProblemsOverlay(controller: NativeEditorController, state: NativeEditorUiState) {
    val diagnostics = state.diagnostics.values.flatten().sortedWith(
        compareByDescending<NativeDiagnostic> { it.severity }.thenBy { it.path }.thenBy { it.startLine },
    )
    Column(modifier = Modifier.fillMaxSize()) {
        OverlayHeader("Problems (${diagnostics.size})", controller::closeOverlay)
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            items(diagnostics) { diagnostic ->
                Row(
                    modifier = Modifier.fillMaxWidth()
                        .clickable { controller.openFile(diagnostic.path, diagnostic.startLine, diagnostic.startColumn) }
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Icon(
                        if (diagnostic.isError) Icons.Default.ErrorOutline else Icons.Default.BugReport,
                        null,
                        tint = if (diagnostic.isError) Error else Warning,
                        modifier = Modifier.size(18.dp),
                    )
                    Column(modifier = Modifier.weight(1f).padding(start = 9.dp)) {
                        Text(diagnostic.message, color = PrimaryText, fontSize = 13.sp)
                        Text(
                            "${diagnostic.path.substringAfterLast('/')} · ${diagnostic.startLine}:${diagnostic.startColumn}",
                            color = SecondaryText,
                            fontSize = 11.sp,
                        )
                    }
                }
                Divider(color = Border)
            }
        }
    }
}

/**
 * Persistent native counterpart to the browser sidebar iframe stack. It stays
 * mounted while the editor is active so background sidebar apps retain their
 * document, socket, and query-state sessions when the drawer is closed.
 */
@Composable
@OptIn(ExperimentalFoundationApi::class)
private fun PersistentSidebarLayer(controller: NativeEditorController, state: NativeEditorUiState) {
    val visible = state.overlay == NativeEditorOverlay.SIDEBAR
    val activeItem = state.sidebarItems.firstOrNull { it.active }
    var appMenuOpen by remember { mutableStateOf(false) }
    var contextHostId by remember { mutableStateOf<String?>(null) }
    Surface(
        modifier = if (visible) Modifier.fillMaxSize() else Modifier.size(1.dp),
        color = if (visible) Panel else Color.Transparent,
        shadowElevation = if (visible) 8.dp else 0.dp,
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            PersistentSidebarWebViewPool(
                items = state.sidebarItems,
                loadedUrls = state.sidebarLoadedUrls,
                activeHostId = activeItem?.hostId.orEmpty(),
                visible = visible,
                modifier = if (visible) {
                    Modifier.fillMaxSize().padding(start = 57.dp, top = 49.dp)
                } else {
                    Modifier.size(1.dp)
                },
            )
            if (visible) {
                OverlayHeader(
                    activeItem?.title ?: "Sidebar",
                    controller::closeOverlay,
                    action = {
                        Box {
                            IconButton(onClick = { appMenuOpen = true }) {
                                Icon(Icons.Default.Add, "Open sidebar app", tint = SecondaryText)
                            }
                            DropdownMenu(
                                expanded = appMenuOpen,
                                onDismissRequest = { appMenuOpen = false },
                            ) {
                                state.sidebarCatalog
                                    .filter { catalog ->
                                        state.sidebarItems.none { item -> item.appId == catalog.appId }
                                    }
                                    .forEach { app ->
                                        DropdownMenuItem(
                                            text = { Text(app.title) },
                                            onClick = {
                                                appMenuOpen = false
                                                controller.openSidebarApp(app.appId)
                                            },
                                        )
                                    }
                            }
                        }
                    },
                )
                LazyColumn(
                    modifier = Modifier.padding(top = 49.dp).width(56.dp).fillMaxHeight()
                        .background(Raised).padding(vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    items(state.sidebarItems, key = { it.hostId }) { item ->
                        Box(
                            modifier = Modifier.fillMaxWidth().height(48.dp)
                                .background(if (item.active) Accent.copy(alpha = 0.2f) else Color.Transparent),
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(
                                modifier = Modifier.fillMaxSize().combinedClickable(
                                    onClick = { controller.activateSidebar(item.hostId) },
                                    onLongClick = { contextHostId = item.hostId },
                                ),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    item.title.trim().take(1).uppercase().ifBlank { "S" },
                                    color = if (item.active) Accent else SecondaryText,
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
                                        controller.closeSidebar(item.hostId)
                                    },
                                )
                            }
                        }
                    }
                }
                if (state.activeSidebarUrl.isBlank()) {
                    Box(
                        modifier = Modifier.fillMaxSize().padding(start = 57.dp, top = 49.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            if (state.sidebarLoading) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                            }
                            Text(
                                state.sidebarError ?: state.sidebarMessage,
                                color = if (state.sidebarError == null) SecondaryText else Error,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Owns one attached WebView for every backend sidebar slot. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun PersistentSidebarWebViewPool(
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

@Composable
private fun NativeStatusBar(state: NativeEditorUiState) {
    Row(
        modifier = Modifier.fillMaxWidth().height(28.dp).background(Raised).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ConnectionDot(state.editorConnected)
        ConnectionDot(state.explorerConnected)
        ConnectionDot(state.wbaConnected)
        Text(
            state.errorMessage ?: state.statusMessage,
            color = if (state.errorMessage == null) SecondaryText else Error,
            fontSize = 11.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).padding(start = 7.dp),
        )
        state.document?.let {
            Text(it.languageId, color = SecondaryText, fontSize = 11.sp)
        }
    }
}

@Composable
private fun ConnectionDot(connected: Boolean) {
    Box(
        modifier = Modifier.padding(end = 3.dp).size(6.dp)
            .background(if (connected) Success else Error),
    )
}

private fun overlayTint(state: NativeEditorUiState, overlay: NativeEditorOverlay): Color =
    if (state.overlay == overlay) Accent else SecondaryText
