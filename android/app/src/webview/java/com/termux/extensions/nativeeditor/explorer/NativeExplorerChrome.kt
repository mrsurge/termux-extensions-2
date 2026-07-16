package com.termux.extensions.nativeeditor.explorer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.termux.extensions.nativeeditor.NativeDiagnostic

@Composable
internal fun NativeExplorerOverlay(
    state: NativeExplorerUiState,
    projectPath: String,
    diagnostics: Map<String, List<NativeDiagnostic>>,
    onClose: () -> Unit,
    onRefresh: () -> Unit,
    onToggleDirectory: (String) -> Unit,
    onOpenFile: (String) -> Unit,
) {
    val scrollState = rememberScrollState()

    Column(modifier = Modifier.fillMaxSize().background(NativeExplorerColors.background)) {
        Row(
            modifier = Modifier.fillMaxWidth().height(48.dp).padding(start = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = projectPath.substringAfterLast('/').ifBlank { "Explorer" },
                color = NativeExplorerColors.primaryText,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onRefresh) {
                Icon(Icons.Default.Refresh, "Refresh Explorer", tint = NativeExplorerColors.secondaryText)
            }
            IconButton(onClick = onClose) {
                Icon(Icons.Default.Close, "Close Explorer", tint = NativeExplorerColors.secondaryText)
            }
        }
        Divider(color = NativeExplorerColors.border)
        Box(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier.fillMaxSize().verticalScroll(scrollState).padding(vertical = 5.dp),
            ) {
                NativeExplorerTree(
                    state = state,
                    projectPath = projectPath,
                    diagnostics = diagnostics,
                    onToggleDirectory = onToggleDirectory,
                    onOpenFile = onOpenFile,
                )
            }
        }
    }
}
