package com.termux.extensions

import android.content.Context
import android.os.Build
import android.os.Process
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class AndroidLogcatDump(
    val lines: List<String>,
    val error: String? = null,
)

internal fun selectAndroidLogcatSession(
    rawOutput: String,
    sessionMarker: String,
): List<String> {
    val lines = rawOutput.lineSequence()
        .map { it.trimEnd() }
        .filter { it.isNotBlank() }
        .toList()
    val markerIndex = lines.indexOfLast { it.contains(sessionMarker) }
    val sessionLines = if (markerIndex >= 0) lines.drop(markerIndex + 1) else lines
    return sessionLines.takeLast(MAX_ANDROID_LOGCAT_LINES)
}

internal fun formatStartupFailure(message: String, error: Throwable?): String {
    if (error == null) return message
    val cause = error.message?.takeIf { it.isNotBlank() } ?: "no detail"
    return "$message (${error.javaClass.simpleName}: $cause)"
}

/**
 * Diagnostics subsystem for the Android wrapper process. Logcat remains the
 * source of truth; this class adds a per-activity boundary, JSON snapshots, and
 * one filtered live stream for the TE2 console worker.
 */
class AndroidDiagnostics(private val context: Context) {
    private val sessionId = UUID.randomUUID().toString()
    private val sessionMarker = "$SESSION_MARKER_PREFIX$sessionId"
    private val streamLock = Any()

    @Volatile
    private var consoleSink: ((String, String) -> Unit)? = null
    private var consoleProcess: java.lang.Process? = null
    private var consoleThread: Thread? = null

    fun beginSession() {
        Log.w(TAG, sessionMarker)
    }

    fun captureWarningsAndErrors(): AndroidLogcatDump {
        return try {
            val process = ProcessBuilder(
                "logcat",
                "-d",
                "-v",
                "threadtime",
                "-t",
                MAX_ANDROID_LOGCAT_LINES.toString(),
                "--pid=${Process.myPid()}",
                "*:W",
            )
                .redirectErrorStream(true)
                .start()
            val output = process.inputStream.bufferedReader().use { reader -> reader.readText() }
            val exitCode = process.waitFor()
            if (exitCode != 0) {
                AndroidLogcatDump(
                    lines = emptyList(),
                    error = output.trim().ifBlank { "logcat exited with status $exitCode" },
                )
            } else {
                AndroidLogcatDump(
                    lines = selectAndroidLogcatSession(output, sessionMarker),
                )
            }
        } catch (error: Exception) {
            AndroidLogcatDump(
                lines = emptyList(),
                error = "${error.javaClass.simpleName}: ${error.message ?: "logcat capture failed"}",
            )
        }
    }

    /**
     * Streams this process's editor/RPC diagnostics into the Android console
     * worker. The session marker prevents old process logs from being replayed.
     */
    fun startConsoleStream(sink: (level: String, line: String) -> Unit) {
        consoleSink = sink
        synchronized(streamLock) {
            if (consoleThread?.isAlive == true) return
            consoleThread = Thread(::runConsoleStream, "te2-android-logcat").apply {
                isDaemon = true
                start()
            }
        }
    }

    fun stopConsoleStream() {
        consoleSink = null
        synchronized(streamLock) {
            consoleProcess?.destroy()
            consoleProcess = null
            consoleThread?.interrupt()
            consoleThread = null
        }
    }

    private fun runConsoleStream() {
        try {
            val process = ProcessBuilder(
                "logcat",
                "-v",
                "threadtime",
                "--pid=${Process.myPid()}",
                "NativeEditor:D",
                "SocketIoJsonRpc:D",
                "UiIpcClient:I",
                "AndroidDiagnostics:I",
                "*:W",
            )
                .redirectErrorStream(true)
                .start()
            synchronized(streamLock) {
                consoleProcess = process
            }
            var sessionStarted = false
            process.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { rawLine ->
                    if (Thread.currentThread().isInterrupted) return@forEach
                    val line = rawLine.trimEnd()
                    if (line.isBlank()) return@forEach
                    if (!sessionStarted) {
                        sessionStarted = line.contains(sessionMarker)
                        return@forEach
                    }
                    consoleSink?.invoke(androidLogcatLevel(line), line)
                }
            }
        } catch (error: Exception) {
            if (!Thread.currentThread().isInterrupted) {
                consoleSink?.invoke(
                    "error",
                    "Android logcat stream failed: ${error.javaClass.simpleName}: ${error.message}",
                )
            }
        } finally {
            synchronized(streamLock) {
                consoleProcess = null
                consoleThread = null
            }
        }
    }

    fun snapshot(runtimeState: JSONObject): JSONObject {
        val dump = captureWarningsAndErrors()
        val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            packageInfo.versionCode.toLong()
        }
        return JSONObject().apply {
            put("sessionId", sessionId)
            put("capturedAtMs", System.currentTimeMillis())
            put("pid", Process.myPid())
            put("packageName", context.packageName)
            put("versionName", packageInfo.versionName ?: "unknown")
            put("versionCode", versionCode)
            put("renderEngine", context.packageName.substringAfterLast('.'))
            put("sdkInt", Build.VERSION.SDK_INT)
            put("runtime", runtimeState)
            put("warningsAndErrors", JSONArray(dump.lines))
            if (dump.error != null) put("captureError", dump.error)
        }
    }

    companion object {
        private const val TAG = "AndroidDiagnostics"
        private const val SESSION_MARKER_PREFIX = "TE2_ANDROID_SESSION:"
    }
}

private const val MAX_ANDROID_LOGCAT_LINES = 300
private val LOGCAT_LEVEL = Regex("\\s([VDIWEF])\\s")

internal fun androidLogcatLevel(line: String): String = when (
    LOGCAT_LEVEL.find(line)?.groupValues?.getOrNull(1)
) {
    "E", "F" -> "error"
    "W" -> "warn"
    "D", "V" -> "debug"
    else -> "info"
}
