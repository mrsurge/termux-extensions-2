package com.termux.extensions.nativeeditor.explorer

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.termux.extensions.nativeeditor.NativeDiagnostic

internal object NativeExplorerColors {
    val background = Color(0xFF0B1220)
    val card = Color(0xFF111827)
    val border = Color(0xFF1F2937)
    val directoryBorder = Color(0x5960A5FA)
    val primaryText = Color(0xFFE5E7EB)
    val secondaryText = Color(0xFF94A3B8)
    val folder = Color(0xFF60A5FA)
    val active = Color(0xFF38BDF8)
    val draft = Color(0xFFFACC15)
    val error = Color(0xFFF87171)
}

internal object NativeExplorerDimensions {
    val rowHeight = 40.dp
    val cardShape = RoundedCornerShape(
        topStart = 8.dp,
        topEnd = 1.dp,
        bottomEnd = 1.dp,
        bottomStart = 8.dp,
    )
}

@Composable
internal fun NativeExplorerTree(
    state: NativeExplorerUiState,
    projectPath: String,
    diagnostics: Map<String, List<NativeDiagnostic>>,
    onToggleDirectory: (String) -> Unit,
    onOpenFile: (String) -> Unit,
) {
    val rootEntry = NativeExplorerEntry(
        name = projectPath.substringAfterLast('/').ifBlank { "Explorer" },
        rel = ".",
        kind = "dir",
        gitStatus = "",
        gitFlags = emptyList(),
        hasDraft = state.listings.values.flatten().any { it.hasDraft },
    )
    val activeRelative = state.activeFile.removePrefix(projectPath.trimEnd('/') + "/")
    NativeExplorerDirectoryCard(
        entry = rootEntry,
        depth = 0,
        diagnosticCount = nativeExplorerDiagnosticCount(".", projectPath, diagnostics),
        onClick = null,
    ) {
        NativeExplorerChildren(
            cwd = ".",
            depth = 1,
            state = state,
            projectPath = projectPath,
            activeRelative = activeRelative,
            diagnostics = diagnostics,
            onToggleDirectory = onToggleDirectory,
            onOpenFile = onOpenFile,
        )
    }
}

@Composable
private fun NativeExplorerChildren(
    cwd: String,
    depth: Int,
    state: NativeExplorerUiState,
    projectPath: String,
    activeRelative: String,
    diagnostics: Map<String, List<NativeDiagnostic>>,
    onToggleDirectory: (String) -> Unit,
    onOpenFile: (String) -> Unit,
) {
    state.listings[cwd].orEmpty().forEach { entry ->
        val diagnosticCount = nativeExplorerDiagnosticCount(entry.rel, projectPath, diagnostics)
        if (entry.isDirectory && entry.rel in state.expandedDirectories) {
            NativeExplorerDirectoryCard(
                entry = entry,
                depth = depth,
                diagnosticCount = diagnosticCount,
                onClick = { onToggleDirectory(entry.rel) },
            ) {
                NativeExplorerChildren(
                    cwd = entry.rel,
                    depth = depth + 1,
                    state = state,
                    projectPath = projectPath,
                    activeRelative = activeRelative,
                    diagnostics = diagnostics,
                    onToggleDirectory = onToggleDirectory,
                    onOpenFile = onOpenFile,
                )
            }
        } else {
            NativeExplorerLeafCard(
                entry = entry,
                selected = !entry.isDirectory && activeRelative == entry.rel,
                diagnosticCount = diagnosticCount,
                onClick = {
                    if (entry.isDirectory) onToggleDirectory(entry.rel) else onOpenFile(entry.rel)
                },
            )
        }
    }
}

@Composable
private fun NativeExplorerDirectoryCard(
    entry: NativeExplorerEntry,
    depth: Int,
    diagnosticCount: Int,
    onClick: (() -> Unit)?,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = if (depth == 0) 7.dp else 4.dp, vertical = 3.dp),
        color = nativeExplorerCardColor(entry),
        contentColor = NativeExplorerColors.primaryText,
        shape = NativeExplorerDimensions.cardShape,
        border = BorderStroke(1.dp, nativeExplorerBorderColor(entry)),
    ) {
        Column {
            NativeExplorerCardRow(entry, diagnosticCount, onClick)
            Column(modifier = Modifier.fillMaxWidth().padding(start = 4.dp, bottom = 3.dp)) {
                content()
            }
        }
    }
}

@Composable
private fun NativeExplorerLeafCard(
    entry: NativeExplorerEntry,
    selected: Boolean,
    diagnosticCount: Int,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
        color = nativeExplorerCardColor(entry),
        contentColor = NativeExplorerColors.primaryText,
        shape = NativeExplorerDimensions.cardShape,
        border = BorderStroke(1.dp, nativeExplorerBorderColor(entry)),
    ) {
        Box {
            NativeExplorerCardRow(entry, diagnosticCount, onClick)
            if (selected) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .height(2.dp)
                        .background(NativeExplorerColors.active),
                )
            }
        }
    }
}

@Composable
private fun NativeExplorerCardRow(
    entry: NativeExplorerEntry,
    diagnosticCount: Int,
    onClick: (() -> Unit)?,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(NativeExplorerDimensions.rowHeight)
            .then(if (onClick == null) Modifier else Modifier.clickable(onClick = onClick)),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().fillMaxHeight().padding(start = 10.dp, end = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                if (entry.isDirectory) Icons.Default.Folder else Icons.Default.InsertDriveFile,
                contentDescription = null,
                tint = if (entry.isDirectory) NativeExplorerColors.folder else NativeExplorerColors.secondaryText,
                modifier = Modifier.size(18.dp),
            )
            Text(
                text = entry.name,
                color = NativeExplorerColors.primaryText,
                fontSize = 13.sp,
                fontWeight = if (entry.isDirectory) FontWeight.Medium else FontWeight.Normal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
            NativeExplorerIndicators(entry, diagnosticCount)
        }
        if (entry.hasDraft) {
            Box(
                modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(2.dp)
                    .background(NativeExplorerColors.draft.copy(alpha = if (entry.isDirectory) 0.55f else 1f)),
            )
        }
        val accent = nativeExplorerGitAccent(entry)
        if (accent != Color.Transparent) {
            Box(
                modifier = Modifier.align(Alignment.CenterStart).fillMaxHeight().width(3.dp).background(accent),
            )
        }
    }
}

@Composable
internal fun NativeExplorerIndicators(entry: NativeExplorerEntry, diagnosticCount: Int) {
    if (entry.gitStatus.isNotBlank()) {
        Text(
            text = nativeExplorerGitLabel(entry.gitStatus),
            color = nativeExplorerGitAccent(entry).takeUnless { it == Color.Transparent }
                ?: NativeExplorerColors.secondaryText,
            fontSize = 10.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
    if (diagnosticCount > 0) {
        Spacer(Modifier.width(7.dp))
        Text(
            text = diagnosticCount.toString(),
            color = NativeExplorerColors.error,
            fontSize = 10.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

internal fun nativeExplorerCardColor(entry: NativeExplorerEntry): Color = when {
    entry.gitStatus in setOf("modified", "staged_modified") -> Color(0xB39B5A16)
    entry.gitStatus == "untracked" -> Color(0xFF133D80)
    entry.gitStatus in setOf("added", "staged") -> Color(0xB3206F52)
    entry.isDirectory && "untracked" in entry.gitFlags && "staged" in entry.gitFlags -> Color(0xFF073D49)
    entry.isDirectory && "untracked" in entry.gitFlags -> Color(0xFF0D2354)
    entry.isDirectory && "staged" in entry.gitFlags -> Color(0xFF003A2B)
    else -> NativeExplorerColors.card
}

internal fun nativeExplorerBorderColor(entry: NativeExplorerEntry): Color = when {
    entry.gitStatus == "conflict" || "conflict" in entry.gitFlags -> Color(0xFFEF4444)
    entry.gitStatus in setOf("modified", "staged_modified") || "modified" in entry.gitFlags -> Color(0xFF955011)
    entry.gitStatus == "untracked" || "untracked" in entry.gitFlags -> Color(0xFF2563EB)
    entry.gitStatus in setOf("added", "staged") || "staged" in entry.gitFlags -> Color(0xFF10B981)
    entry.isDirectory -> NativeExplorerColors.directoryBorder
    else -> NativeExplorerColors.border
}

private fun nativeExplorerGitAccent(entry: NativeExplorerEntry): Color = when (entry.gitStatus) {
    "modified", "staged_modified" -> Color(0xFFF97316)
    "staged", "added" -> Color(0xFF34D399)
    "untracked" -> Color(0xFF00AAFF)
    "deleted", "conflict" -> Color(0xFFF87171)
    "renamed" -> Color(0xFFFACC15)
    "ignored" -> Color(0xFF6B7280)
    else -> Color.Transparent
}

private fun nativeExplorerGitLabel(status: String): String = when (status) {
    "modified" -> "M"
    "staged" -> "S"
    "staged_modified" -> "SM"
    "added" -> "A"
    "deleted" -> "D"
    "renamed" -> "R"
    "untracked" -> "U"
    "conflict" -> "!"
    "ignored" -> "I"
    else -> ""
}

private fun nativeExplorerDiagnosticCount(
    rel: String,
    projectPath: String,
    diagnostics: Map<String, List<NativeDiagnostic>>,
): Int {
    val prefix = if (rel == ".") "" else "$rel/"
    return diagnostics.entries.sumOf { (path, items) ->
        val relative = path.removePrefix(projectPath.trimEnd('/') + "/")
        if (relative == rel || prefix.isEmpty() || relative.startsWith(prefix)) items.size else 0
    }
}
