package com.termux.extensions

import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val ConsoleBg = Color(0xFF1A1A2E)
private val ConsolePanel = Color(0xFF16213E)
private val ConsoleEval = Color(0xFF0F3460)
private val ConsoleBorder = Color(0xFF274060)
private val ConsoleText = Color(0xFFE0E0E0)
private val ConsoleMuted = Color(0xFF9AA3B2)
private val ConsoleDim = Color(0xFF596271)
private val LevelLogColor = Color(0xFF6BCB77)
private val LevelWarnColor = Color(0xFFFFD93D)
private val LevelErrorColor = Color(0xFFFF6B6B)
private val LevelInfoColor = Color(0xFF7FC8F8)

private val TimeFormatter = SimpleDateFormat("HH:mm:ss", Locale.US)

enum class ConsoleLevelFilter {
    ALL,
    LOG,
    WARN,
    ERROR;

    fun matches(level: String): Boolean = when (this) {
        ALL -> true
        LOG -> level == "log" || level == "info" || level == "debug"
        WARN -> level == "warn"
        ERROR -> level == "error"
    }
}

data class ConsoleEntry(
    val level: String,
    val workerId: String,
    val message: String,
    val timestampLabel: String,
)

@Stable
class ComposeConsoleState(
    private val maxEntries: Int = 500,
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    val entries = mutableStateListOf<ConsoleEntry>()
    private val knownWorkerIds = mutableStateListOf<String>()

    var activeWorkerFilter by mutableStateOf("all")
    var activeLevelFilter by mutableStateOf(ConsoleLevelFilter.ALL)
    var searchQuery by mutableStateOf("")
    var evalInput by mutableStateOf("")

    fun bind(
        composeView: ComposeView,
        onSendEval: (String, String) -> Unit,
        onRequestClear: () -> Unit,
    ) {
        composeView.setViewCompositionStrategy(
            ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed
        )
        composeView.setContent {
            MaterialTheme {
                ComposeConsoleOverlay(
                    state = this,
                    onSendEval = onSendEval,
                    onRequestClear = onRequestClear,
                )
            }
        }
    }

    fun onConsoleEvent(eventName: String, data: JSONObject) {
        mainHandler.post {
            when (eventName) {
                "console:log" -> appendLogEntry(data)
                "console:evalResult" -> appendEvalResult(data)
                "console:workers" -> updateWorkers(data)
                "console:clear", "console:cleared" -> clearEntries()
            }
        }
    }

    fun clearEntries() {
        entries.clear()
    }

    fun resetSession() {
        entries.clear()
        knownWorkerIds.clear()
        activeWorkerFilter = "all"
        activeLevelFilter = ConsoleLevelFilter.ALL
        searchQuery = ""
        evalInput = ""
    }

    fun submitEval(onSendEval: (String, String) -> Unit) {
        val code = evalInput.trim()
        if (code.isEmpty()) return
        val targetWorker = defaultEvalTarget()
        evalInput = ""
        appendEntry(
            ConsoleEntry(
                level = "debug",
                workerId = "eval",
                message = "→ $code",
                timestampLabel = TimeFormatter.format(Date()),
            )
        )
        onSendEval(code, targetWorker)
    }

    private fun defaultEvalTarget(): String {
        if (activeWorkerFilter != "all") return activeWorkerFilter
        return knownWorkerIds.firstOrNull { it.startsWith("editor_iframe:") }
            ?: knownWorkerIds.firstOrNull { it == "main_page" }
            ?: knownWorkerIds.firstOrNull()
            ?: "editor_iframe"
    }

    fun workerOptions(): List<String> {
        return listOf("all") + knownWorkerIds.sorted()
    }

    private fun updateWorkers(data: JSONObject) {
        val workers = data.optJSONArray("workers") ?: return
        val next = buildList {
            for (i in 0 until workers.length()) {
                val worker = workers.optString(i).trim()
                if (worker.isNotEmpty()) add(worker)
            }
        }.distinct().sorted()
        knownWorkerIds.clear()
        knownWorkerIds.addAll(next)
        if (activeWorkerFilter != "all" && activeWorkerFilter !in knownWorkerIds) {
            activeWorkerFilter = "all"
        }
    }

    private fun appendLogEntry(data: JSONObject) {
        val level = data.optString("level", "log")
        val workerId = data.optString("workerId", "?")
        val args = data.optJSONArray("args")
        val ts = if (data.has("ts")) data.optLong("ts") else System.currentTimeMillis()
        val message = formatArgs(args)
        if (workerId.isNotBlank() && workerId != "?" && workerId !in knownWorkerIds) {
            knownWorkerIds.add(workerId)
            knownWorkerIds.sort()
        }
        appendEntry(
            ConsoleEntry(
                level = level,
                workerId = workerId,
                message = message,
                timestampLabel = TimeFormatter.format(Date(ts)),
            )
        )
    }

    private fun appendEvalResult(data: JSONObject) {
        val ok = data.optBoolean("ok", false)
        val payload = if (ok) data.opt("value") else data.opt("error")
        appendEntry(
            ConsoleEntry(
                level = if (ok) "info" else "error",
                workerId = "eval",
                message = if (ok) "← ${formatJsonValue(payload)}" else "✗ ${formatJsonValue(payload)}",
                timestampLabel = TimeFormatter.format(Date()),
            )
        )
    }

    private fun appendEntry(entry: ConsoleEntry) {
        entries.add(entry)
        while (entries.size > maxEntries) {
            entries.removeAt(0)
        }
    }

    private fun formatArgs(args: JSONArray?): String {
        if (args == null || args.length() == 0) return ""
        return buildList {
            for (i in 0 until args.length()) {
                add(formatJsonValue(args.opt(i)))
            }
        }.joinToString(" ")
    }

    private fun formatJsonValue(value: Any?): String {
        return when (value) {
            null, JSONObject.NULL -> "null"
            is JSONObject -> value.toString(2)
            is JSONArray -> value.toString(2)
            else -> value.toString()
        }
    }
}

@Composable
private fun ComposeConsoleOverlay(
    state: ComposeConsoleState,
    onSendEval: (String, String) -> Unit,
    onRequestClear: () -> Unit,
) {
    val filteredEntries by remember(state) {
        derivedStateOf {
            val query = state.searchQuery.trim().lowercase(Locale.US)
            state.entries.filter { entry ->
                if (state.activeWorkerFilter != "all" && entry.workerId != state.activeWorkerFilter) {
                    return@filter false
                }
                if (!state.activeLevelFilter.matches(entry.level)) {
                    return@filter false
                }
                if (query.isNotEmpty() && !entry.message.lowercase(Locale.US).contains(query)) {
                    return@filter false
                }
                true
            }
        }
    }
    val scrollState = rememberScrollState()
    var workerMenuOpen by remember { mutableStateOf(false) }

    LaunchedEffect(filteredEntries.size) {
        scrollState.animateScrollTo(scrollState.maxValue)
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = ConsoleBg,
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ConsolePanel)
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Console",
                    color = ConsoleText,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.width(10.dp))
                Box {
                    Surface(
                        modifier = Modifier.clickable { workerMenuOpen = true },
                        color = ConsoleEval,
                        shape = RoundedCornerShape(6.dp),
                        border = androidx.compose.foundation.BorderStroke(1.dp, ConsoleBorder),
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = if (state.activeWorkerFilter == "all") "All sources" else state.activeWorkerFilter,
                                color = ConsoleText,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                fontSize = 11.sp,
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(text = "▾", color = ConsoleMuted, fontSize = 11.sp)
                        }
                    }
                    DropdownMenu(
                        expanded = workerMenuOpen,
                        onDismissRequest = { workerMenuOpen = false },
                    ) {
                        state.workerOptions().forEach { worker ->
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        if (worker == "all") "All sources" else worker,
                                        fontSize = 12.sp,
                                    )
                                },
                                onClick = {
                                    state.activeWorkerFilter = worker
                                    workerMenuOpen = false
                                },
                            )
                        }
                    }
                }
                Spacer(modifier = Modifier.weight(1f))
                Text(
                    text = filteredEntries.size.toString(),
                    color = ConsoleMuted,
                    fontSize = 11.sp,
                )
                Spacer(modifier = Modifier.width(8.dp))
                ConsoleActionPill(
                    label = "Clear",
                    active = false,
                    activeColor = ConsoleMuted,
                    onClick = {
                        state.clearEntries()
                        onRequestClear()
                    },
                )
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ConsolePanel.copy(alpha = 0.82f))
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ConsoleActionPill(
                    label = "All",
                    active = state.activeLevelFilter == ConsoleLevelFilter.ALL,
                    activeColor = ConsoleText,
                    onClick = { state.activeLevelFilter = ConsoleLevelFilter.ALL },
                )
                ConsoleActionPill(
                    label = "Log",
                    active = state.activeLevelFilter == ConsoleLevelFilter.LOG,
                    activeColor = LevelLogColor,
                    onClick = { state.activeLevelFilter = ConsoleLevelFilter.LOG },
                )
                ConsoleActionPill(
                    label = "Warn",
                    active = state.activeLevelFilter == ConsoleLevelFilter.WARN,
                    activeColor = LevelWarnColor,
                    onClick = { state.activeLevelFilter = ConsoleLevelFilter.WARN },
                )
                ConsoleActionPill(
                    label = "Error",
                    active = state.activeLevelFilter == ConsoleLevelFilter.ERROR,
                    activeColor = LevelErrorColor,
                    onClick = { state.activeLevelFilter = ConsoleLevelFilter.ERROR },
                )
            }

            OutlinedTextField(
                value = state.searchQuery,
                onValueChange = { state.searchQuery = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                label = { Text("Filter", fontSize = 12.sp) },
                singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(
                    color = ConsoleText,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                ),
            )

            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp)
                    .background(Color(0x1416213E), RoundedCornerShape(10.dp))
            ) {
                if (filteredEntries.isEmpty()) {
                    Text(
                        text = "No console output yet",
                        color = ConsoleDim,
                        modifier = Modifier.align(Alignment.Center),
                        fontSize = 12.sp,
                    )
                } else {
                    SelectionContainer {
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .verticalScroll(scrollState)
                                .padding(8.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            filteredEntries.forEach { entry ->
                                ConsoleEntryRow(entry)
                            }
                        }
                    }
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ConsoleEval)
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "›",
                    color = ConsoleMuted,
                    fontSize = 16.sp,
                    fontFamily = FontFamily.Monospace,
                )
                Spacer(modifier = Modifier.width(6.dp))
                OutlinedTextField(
                    value = state.evalInput,
                    onValueChange = { state.evalInput = it },
                    modifier = Modifier.weight(1f),
                    label = { Text("eval", fontSize = 12.sp) },
                    singleLine = true,
                    textStyle = androidx.compose.ui.text.TextStyle(
                        color = ConsoleText,
                        fontSize = 12.sp,
                        fontFamily = FontFamily.Monospace,
                    ),
                    keyboardActions = KeyboardActions(
                        onDone = { state.submitEval(onSendEval) }
                    ),
                )
                Spacer(modifier = Modifier.width(8.dp))
                ConsoleActionPill(
                    label = "Send",
                    active = false,
                    activeColor = LevelInfoColor,
                    onClick = { state.submitEval(onSendEval) },
                )
            }
        }
    }
}

@Composable
private fun ConsoleEntryRow(entry: ConsoleEntry) {
    val levelColor = when (entry.level) {
        "error" -> LevelErrorColor
        "warn" -> LevelWarnColor
        "info" -> LevelInfoColor
        "debug" -> ConsoleDim
        else -> LevelLogColor
    }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color.Transparent,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = entry.timestampLabel,
                    color = ConsoleDim,
                    fontSize = 10.sp,
                    fontFamily = FontFamily.Monospace,
                )
                ConsoleLevelBadge(level = entry.level, color = levelColor)
                Text(
                    text = entry.workerId,
                    color = ConsoleMuted,
                    fontSize = 10.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                text = entry.message,
                color = ConsoleText,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                lineHeight = 16.sp,
            )
        }
    }
}

@Composable
private fun ConsoleLevelBadge(level: String, color: Color) {
    Surface(
        color = color.copy(alpha = 0.18f),
        shape = RoundedCornerShape(999.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, color.copy(alpha = 0.35f)),
    ) {
        Text(
            text = level.uppercase(Locale.US),
            color = color,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            fontSize = 9.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun ConsoleActionPill(
    label: String,
    active: Boolean,
    activeColor: Color,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.clickable(onClick = onClick),
        color = if (active) activeColor.copy(alpha = 0.18f) else Color.Transparent,
        shape = RoundedCornerShape(999.dp),
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (active) activeColor.copy(alpha = 0.35f) else ConsoleBorder
        ),
    ) {
        Text(
            text = label,
            color = if (active) activeColor else ConsoleText,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            fontSize = 11.sp,
            fontWeight = if (active) FontWeight.Bold else FontWeight.Normal,
        )
    }
}
