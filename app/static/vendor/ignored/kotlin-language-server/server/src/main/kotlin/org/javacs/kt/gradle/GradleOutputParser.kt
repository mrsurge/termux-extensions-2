package org.javacs.kt.gradle

import org.eclipse.lsp4j.Diagnostic
import org.eclipse.lsp4j.DiagnosticSeverity
import org.eclipse.lsp4j.Position
import org.eclipse.lsp4j.Range
import java.net.URI
import java.nio.file.Path

/**
 * Parses Gradle/kotlinc output to extract diagnostics.
 * 
 * Kotlin compiler outputs errors in the format:
 *   e: /path/to/File.kt:42:15: Unresolved reference: foo
 *   w: /path/to/File.kt:10:1: Deprecated API usage
 * 
 * AAPT2 outputs errors differently:
 *   ERROR: /path/to/res/layout/activity_main.xml:5: AAPT: error: resource drawable/missing not found
 *   
 * Java compiler (javac) format:
 *   /path/to/File.java:10: error: cannot find symbol
 */
object GradleOutputParser {
    
    // Kotlin compiler error formats:
    //   Modern (Gradle 8+): e: file:///path/to/File.kt:42:15 message
    //   Legacy:             e: /path/to/File.kt:42:15: message
    private val KOTLIN_ERROR_PATTERN = Regex("""^e:\s+(?:file://)?(.+):(\d+):(\d+):?\s+(.+)$""")
    
    // Kotlin compiler warning formats:
    //   Modern (Gradle 8+): w: file:///path/to/File.kt:10:1 message
    //   Legacy:             w: /path/to/File.kt:10:1: message
    private val KOTLIN_WARNING_PATTERN = Regex("""^w:\s+(?:file://)?(.+):(\d+):(\d+):?\s+(.+)$""")
    
    // AAPT2 error: ERROR: /path:line: AAPT: message
    // or: /path:line: error: message
    private val AAPT_ERROR_PATTERN = Regex("""^(?:ERROR:\s+)?(.+):(\d+):\s*(?:AAPT:\s*)?error:\s*(.+)$""", RegexOption.IGNORE_CASE)
    
    // AAPT2 warning
    private val AAPT_WARNING_PATTERN = Regex("""^(?:WARNING:\s+)?(.+):(\d+):\s*(?:AAPT:\s*)?warn(?:ing)?:\s*(.+)$""", RegexOption.IGNORE_CASE)
    
    // Java compiler error: /path/to/File.java:10: error: message
    private val JAVA_ERROR_PATTERN = Regex("""^(.+\.java):(\d+):\s*error:\s*(.+)$""")
    
    // Java compiler warning
    private val JAVA_WARNING_PATTERN = Regex("""^(.+\.java):(\d+):\s*warning:\s*(.+)$""")
    
    // Gradle task failure (for context, not a file diagnostic)
    private val TASK_FAILED_PATTERN = Regex("""^> Task :([\w:]+) FAILED$""")
    
    /**
     * Parse Gradle build output and extract file-level diagnostics.
     * 
     * @param output The combined stdout/stderr from Gradle
     * @param shadowRoot Optional shadow workspace root for path remapping
     * @param realRoot The real project root to map shadow paths back to
     * @return List of (URI, Diagnostic) pairs
     */
    fun parse(
        output: String,
        shadowRoot: Path? = null,
        realRoot: Path? = null
    ): List<Pair<URI, Diagnostic>> {
        val diagnostics = mutableListOf<Pair<URI, Diagnostic>>()
        
        output.lines().forEach lineLoop@{ line ->
            // Try each pattern in order of specificity
            KOTLIN_ERROR_PATTERN.find(line)?.let { match ->
                diagnostics.add(createKotlinDiagnostic(match, DiagnosticSeverity.Error, shadowRoot, realRoot))
                return@lineLoop
            }
            
            KOTLIN_WARNING_PATTERN.find(line)?.let { match ->
                diagnostics.add(createKotlinDiagnostic(match, DiagnosticSeverity.Warning, shadowRoot, realRoot))
                return@lineLoop
            }
            
            AAPT_ERROR_PATTERN.find(line)?.let { match ->
                diagnostics.add(createAaptDiagnostic(match, DiagnosticSeverity.Error, shadowRoot, realRoot))
                return@lineLoop
            }
            
            AAPT_WARNING_PATTERN.find(line)?.let { match ->
                diagnostics.add(createAaptDiagnostic(match, DiagnosticSeverity.Warning, shadowRoot, realRoot))
                return@lineLoop
            }
            
            JAVA_ERROR_PATTERN.find(line)?.let { match ->
                diagnostics.add(createJavaDiagnostic(match, DiagnosticSeverity.Error, shadowRoot, realRoot))
                return@lineLoop
            }
            
            JAVA_WARNING_PATTERN.find(line)?.let { match ->
                diagnostics.add(createJavaDiagnostic(match, DiagnosticSeverity.Warning, shadowRoot, realRoot))
                return@lineLoop
            }
        }
        
        return diagnostics
    }
    
    private fun createKotlinDiagnostic(
        match: MatchResult,
        severity: DiagnosticSeverity,
        shadowRoot: Path?,
        realRoot: Path?
    ): Pair<URI, Diagnostic> {
        val (path, lineStr, colStr, message) = match.destructured
        val line = lineStr.toIntOrNull()?.minus(1) ?: 0  // LSP is 0-indexed
        val col = colStr.toIntOrNull()?.minus(1) ?: 0
        
        val uri = remapPath(path, shadowRoot, realRoot)
        val range = Range(Position(line, col), Position(line, col + 10))  // Approximate end
        val diagnostic = Diagnostic(range, message, severity, "kotlinc")
        
        return uri to diagnostic
    }
    
    private fun createAaptDiagnostic(
        match: MatchResult,
        severity: DiagnosticSeverity,
        shadowRoot: Path?,
        realRoot: Path?
    ): Pair<URI, Diagnostic> {
        val groups = match.groupValues
        val path = groups[1]
        val lineStr = groups[2]
        val message = groups[3]
        
        val line = lineStr.toIntOrNull()?.minus(1) ?: 0
        
        val uri = remapPath(path, shadowRoot, realRoot)
        val range = Range(Position(line, 0), Position(line, 100))  // AAPT doesn't give column
        val diagnostic = Diagnostic(range, message, severity, "aapt2")
        
        return uri to diagnostic
    }
    
    private fun createJavaDiagnostic(
        match: MatchResult,
        severity: DiagnosticSeverity,
        shadowRoot: Path?,
        realRoot: Path?
    ): Pair<URI, Diagnostic> {
        val (path, lineStr, message) = match.destructured
        val line = lineStr.toIntOrNull()?.minus(1) ?: 0
        
        val uri = remapPath(path, shadowRoot, realRoot)
        val range = Range(Position(line, 0), Position(line, 100))  // javac column is on next line
        val diagnostic = Diagnostic(range, message, severity, "javac")
        
        return uri to diagnostic
    }
    
    /**
     * Remap a path from shadow workspace back to real project root.
     */
    private fun remapPath(pathStr: String, shadowRoot: Path?, realRoot: Path?): URI {
        val path = Path.of(pathStr)
        
        if (shadowRoot != null && realRoot != null && path.startsWith(shadowRoot)) {
            val relative = shadowRoot.relativize(path)
            return realRoot.resolve(relative).toUri()
        }
        
        return path.toUri()
    }
    
    /**
     * Extract failed task names from Gradle output (for debugging/logging).
     */
    fun extractFailedTasks(output: String): List<String> {
        return output.lines()
            .mapNotNull { TASK_FAILED_PATTERN.find(it)?.groupValues?.get(1) }
    }
}
