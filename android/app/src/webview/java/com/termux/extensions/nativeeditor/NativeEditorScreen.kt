package com.termux.extensions.nativeeditor

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Typeface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.KeyboardArrowRight
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
    private var textMateSchemeInstalled = false

    init {
        setTypefaceText(Typeface.MONOSPACE)
        setTextSize(14f)
        isLineNumberEnabled = true
        isWordwrap = false
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
    ) {
        if (textMateReady && !textMateSchemeInstalled) {
            controller.textMate.install()?.let {
                colorScheme = it
                textMateSchemeInstalled = true
            }
        }
        if (document == null) {
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
            setEditorLanguage(
                controller.textMate.language(document.languageId, controller::completions),
            )
            activeLanguageId = nextLanguageId
        }
        if (activePath != document.path || text.toString() != document.content) {
            applyingBackendText = true
            setText(document.content)
            applyingBackendText = false
            activePath = document.path
        }
        applyDiagnostics(diagnostics)
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
    if (state.overlay == NativeEditorOverlay.NONE) return
    val fullScreen = state.overlay == NativeEditorOverlay.SIDEBAR
    Box(
        modifier = Modifier.fillMaxSize().background(Color(0x66000000))
            .clickable(onClick = controller::closeOverlay),
    ) {
        Surface(
            modifier = if (fullScreen) {
                Modifier.fillMaxSize().clickable {}
            } else {
                Modifier.fillMaxHeight().fillMaxWidth(0.9f).clickable {}
            },
            color = Panel,
            shadowElevation = 8.dp,
        ) {
            when (state.overlay) {
                NativeEditorOverlay.EXPLORER -> ExplorerOverlay(controller, state)
                NativeEditorOverlay.SEARCH -> SearchOverlay(controller, state)
                NativeEditorOverlay.PROBLEMS -> ProblemsOverlay(controller, state)
                NativeEditorOverlay.SIDEBAR -> SidebarOverlay(controller, state)
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

private data class ExplorerRow(val entry: NativeExplorerEntry, val depth: Int)

@Composable
private fun ExplorerOverlay(controller: NativeEditorController, state: NativeEditorUiState) {
    val rows = remember(state.listings, state.expandedDirectories) {
        flattenExplorerRows(state.listings, state.expandedDirectories)
    }
    Column(modifier = Modifier.fillMaxSize()) {
        OverlayHeader(
            title = state.projectPath.substringAfterLast('/').ifBlank { "Explorer" },
            onClose = controller::closeOverlay,
            action = {
                IconButton(onClick = { controller.requestDirectory(".") }) {
                    Icon(Icons.Default.Refresh, "Refresh", tint = SecondaryText)
                }
            },
        )
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            items(rows, key = { it.entry.rel }) { row ->
                val entry = row.entry
                val selected = state.activeFile == entry.rel || state.activeFile.endsWith("/${entry.rel}")
                val problemCount = state.diagnostics.entries
                    .firstOrNull { it.key.endsWith("/${entry.rel}") || it.key == entry.rel }
                    ?.value?.size ?: 0
                Row(
                    modifier = Modifier.fillMaxWidth()
                        .background(if (selected) Raised else Color.Transparent)
                        .clickable {
                            if (entry.isDirectory) controller.toggleDirectory(entry.rel)
                            else controller.openFile(entry.rel)
                        }
                        .padding(start = (8 + row.depth * 16).dp, end = 10.dp)
                        .height(40.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (entry.isDirectory) {
                        Icon(
                            if (entry.rel in state.expandedDirectories) Icons.Default.ExpandMore else Icons.Default.KeyboardArrowRight,
                            null,
                            tint = SecondaryText,
                            modifier = Modifier.size(18.dp),
                        )
                        Icon(Icons.Default.Folder, null, tint = Accent, modifier = Modifier.size(18.dp))
                    } else {
                        Spacer(Modifier.width(18.dp))
                        Icon(Icons.Default.InsertDriveFile, null, tint = SecondaryText, modifier = Modifier.size(18.dp))
                    }
                    Text(
                        entry.name,
                        color = gitColor(entry.gitStatus),
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f).padding(start = 7.dp),
                    )
                    if (entry.hasDraft) Text("D", color = Accent, fontSize = 10.sp)
                    if (problemCount > 0) Text(problemCount.toString(), color = Error, fontSize = 11.sp, modifier = Modifier.padding(start = 8.dp))
                }
            }
        }
    }
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

@Composable
private fun SidebarOverlay(controller: NativeEditorController, state: NativeEditorUiState) {
    Column(modifier = Modifier.fillMaxSize()) {
        OverlayHeader("Sidebar", controller::closeOverlay)
        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            state.sidebarItems.forEach { item ->
                FilterChip(
                    selected = item.active,
                    onClick = { controller.activateSidebar(item.hostId) },
                    label = { Text(item.title, maxLines = 1) },
                )
            }
            state.sidebarCatalog
                .filter { catalog -> state.sidebarItems.none { it.title == catalog.title } }
                .forEach { app ->
                    FilterChip(
                        selected = false,
                        onClick = { controller.openSidebarApp(app.appId) },
                        leadingIcon = { Icon(Icons.Default.Add, null, modifier = Modifier.size(16.dp)) },
                        label = { Text(app.title, maxLines = 1) },
                    )
                }
        }
        Divider(color = Border)
        if (state.activeSidebarUrl.isBlank()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Select a sidebar app", color = SecondaryText)
            }
        } else {
            SidebarWebView(state.activeSidebarUrl)
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun SidebarWebView(url: String) {
    var webView: WebView? by remember { mutableStateOf(null) }
    AndroidView(
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.cacheMode = WebSettings.LOAD_DEFAULT
                webViewClient = WebViewClient()
                webView = this
                loadUrl(url)
            }
        },
        update = { view -> if (view.url != url) view.loadUrl(url) },
        modifier = Modifier.fillMaxSize(),
    )
    DisposableEffect(Unit) {
        onDispose {
            webView?.stopLoading()
            webView?.destroy()
            webView = null
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

private fun gitColor(status: String): Color = when (status) {
    "added", "untracked", "staged" -> Success
    "modified", "staged_modified" -> Warning
    "deleted", "conflict" -> Error
    else -> PrimaryText
}

private fun flattenExplorerRows(
    listings: Map<String, List<NativeExplorerEntry>>,
    expanded: Set<String>,
): List<ExplorerRow> {
    val rows = mutableListOf<ExplorerRow>()
    val seen = mutableSetOf<String>()
    fun append(cwd: String, depth: Int) {
        listings[cwd].orEmpty().forEach { entry ->
            if (!seen.add(entry.rel)) return@forEach
            rows += ExplorerRow(entry, depth)
            if (entry.isDirectory && entry.rel in expanded) append(entry.rel, depth + 1)
        }
    }
    append(".", 0)
    return rows
}
