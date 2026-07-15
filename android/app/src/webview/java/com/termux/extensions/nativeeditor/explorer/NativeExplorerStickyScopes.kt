package com.termux.extensions.nativeeditor.explorer

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal data class NativeExplorerScopeMetric(
    val entry: NativeExplorerEntry,
    val depth: Int,
    val top: Int,
    val bottom: Int,
    val diagnosticCount: Int = 0,
)

internal data class NativeExplorerStickyResult(
    val scopes: List<NativeExplorerScopeMetric>,
    val bottomOffset: Int,
)

internal fun nativeExplorerStickyScopes(
    metrics: Collection<NativeExplorerScopeMetric>,
    rowHeight: Int,
    topPadding: Int = 0,
): NativeExplorerStickyResult {
    if (metrics.isEmpty() || rowHeight <= 0) return NativeExplorerStickyResult(emptyList(), 0)
    var assumedCount = 1
    var scopes = emptyList<NativeExplorerScopeMetric>()
    repeat(5) {
        val probe = topPadding + assumedCount * rowHeight
        val focus = metrics
            .asSequence()
            .filter { it.top <= probe && it.bottom > probe }
            .maxWithOrNull(compareBy<NativeExplorerScopeMetric>({ it.depth }, { it.top }))
            ?: return@repeat
        scopes = metrics
            .filter { metric -> nativeExplorerIsScopeAncestor(metric.entry.rel, focus.entry.rel) }
            .sortedBy { it.depth }
        if (scopes.size == assumedCount) return@repeat
        assumedCount = scopes.size.coerceAtLeast(1)
    }
    val deepest = scopes.lastOrNull() ?: return NativeExplorerStickyResult(emptyList(), 0)
    val stackBottom = topPadding + scopes.size * rowHeight
    val bottomOffset = (deepest.bottom - stackBottom).coerceIn(-rowHeight, 0)
    return NativeExplorerStickyResult(scopes, bottomOffset)
}

private fun nativeExplorerIsScopeAncestor(ancestor: String, descendant: String): Boolean =
    ancestor == "." || ancestor == descendant || descendant.startsWith("$ancestor/")

@Composable
internal fun NativeExplorerStickyScopeStack(
    result: NativeExplorerStickyResult,
) {
    if (result.scopes.isEmpty()) return
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(NativeExplorerColors.background)
            .shadow(4.dp),
    ) {
        result.scopes.forEachIndexed { index, scope ->
            val offset = if (index == result.scopes.lastIndex) result.bottomOffset else 0
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(NativeExplorerDimensions.rowHeight)
                    .padding(
                        start = (7 + scope.depth * 4).dp,
                        end = 12.dp,
                        bottom = 2.dp,
                    )
                    .then(
                        if (offset == 0) Modifier else Modifier.offset { IntOffset(0, offset) },
                    ),
                color = nativeExplorerCardColor(scope.entry),
                contentColor = NativeExplorerColors.primaryText,
                shape = NativeExplorerDimensions.cardShape,
                border = BorderStroke(1.dp, nativeExplorerBorderColor(scope.entry)),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.Folder,
                        contentDescription = null,
                        tint = NativeExplorerColors.folder,
                        modifier = Modifier.size(17.dp),
                    )
                    Text(
                        text = scope.entry.name,
                        color = NativeExplorerColors.primaryText,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f).padding(start = 8.dp),
                    )
                    NativeExplorerIndicators(scope.entry, scope.diagnosticCount)
                }
            }
        }
    }
}
