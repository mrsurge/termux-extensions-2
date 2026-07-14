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

internal fun androidLogcatLevel(line: String): String =
    if (LOGCAT_ERROR_LEVEL.containsMatchIn(line)) "error" else "warn"

internal fun formatStartupFailure(message: String, error: Throwable?): String {
    if (error == null) return message
    val cause = error.message?.takeIf { it.isNotBlank() } ?: "no detail"
    return "$message (${error.javaClass.simpleName}: $cause)"
}

/**
 * On-demand diagnostics for the Android wrapper process. Logcat remains the
 * source of truth; this class adds a per-activity session boundary and JSON projection.
 */
class AndroidDiagnostics(private val context: Context) {
    private val sessionId = UUID.randomUUID().toString()
    private val sessionMarker = "$SESSION_MARKER_PREFIX$sessionId"

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
private val LOGCAT_ERROR_LEVEL = Regex("\\sE\\s")
