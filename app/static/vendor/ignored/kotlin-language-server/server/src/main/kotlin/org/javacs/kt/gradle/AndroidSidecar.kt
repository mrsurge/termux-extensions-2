package org.javacs.kt.gradle

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import org.eclipse.lsp4j.Diagnostic
import org.eclipse.lsp4j.DiagnosticSeverity
import org.eclipse.lsp4j.Position
import org.eclipse.lsp4j.Range
import org.eclipse.lsp4j.jsonrpc.messages.Either
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption

/**
 * Minimal persisted cache for Android Gradle diagnostics.
 *
 * This is intentionally dumb/simple:
 * - keyed by TE2-provided lspProjectId
 * - stores lastKnownRepoFingerprint + file diagnostics (serializable)
 */

data class AndroidSidecarV1(
    val version: Int = 1,
    val lspProjectId: String,
    val projectRoot: String,
    val lastKnownRepoFingerprint: String? = null,
    val updatedAtMs: Long? = null,
    val diagnosticsByUri: Map<String, List<CachedDiagnostic>> = emptyMap(),
)

data class CachedPosition(val line: Int, val character: Int)

data class CachedRange(val start: CachedPosition, val end: CachedPosition)

data class CachedDiagnostic(
    val range: CachedRange,
    val severity: Int? = null,
    val code: String? = null,
    val source: String? = null,
    val message: String,
)

object AndroidSidecarIO {
    private val gson: Gson = GsonBuilder().disableHtmlEscaping().create()

    fun load(path: Path): AndroidSidecarV1? {
        if (!Files.exists(path)) return null
        return try {
            val content = Files.readString(path)
            gson.fromJson(content, AndroidSidecarV1::class.java)
        } catch (_: Exception) {
            null
        }
    }

    fun save(path: Path, sidecar: AndroidSidecarV1) {
        Files.createDirectories(path.parent)
        val tmp = path.parent.resolve(path.fileName.toString() + ".tmp")
        val payload = gson.toJson(sidecar)
        Files.writeString(
            tmp,
            payload,
            Charsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE,
        )
        Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }
}

fun Diagnostic.toCached(): CachedDiagnostic {
    val r = this.range
    val start = r.start
    val end = r.end

    val codeStr = try {
        when (val c = this.code) {
            is Either<*, *> -> {
                val left = c.left
                val right = c.right
                (left ?: right)?.toString()
            }
            else -> c?.toString()
        }
    } catch (_: Exception) {
        null
    }

    return CachedDiagnostic(
        range = CachedRange(
            CachedPosition(start.line, start.character),
            CachedPosition(end.line, end.character)
        ),
        severity = this.severity?.value,
        code = codeStr,
        source = this.source,
        message = this.message ?: "",
    )
}

fun CachedDiagnostic.toLspDiagnostic(): Diagnostic {
    val range = Range(
        Position(range.start.line, range.start.character),
        Position(range.end.line, range.end.character)
    )

    val diag = Diagnostic()
    diag.range = range
    diag.message = message
    diag.source = source

    if (severity != null) {
        diag.severity = DiagnosticSeverity.forValue(severity)
    }

    if (!code.isNullOrBlank()) {
        diag.code = Either.forLeft(code)
    }

    return diag
}
