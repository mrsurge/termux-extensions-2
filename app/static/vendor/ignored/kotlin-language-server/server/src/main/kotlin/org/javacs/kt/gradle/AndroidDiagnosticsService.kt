package org.javacs.kt.gradle

import org.eclipse.lsp4j.*
import org.eclipse.lsp4j.services.LanguageClient
import org.javacs.kt.LOG
import org.javacs.kt.util.AsyncExecutor
import org.javacs.kt.util.Debouncer
import java.net.URI
import java.nio.file.Path
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap

/**
 * Configuration for the Android pseudo-LSP diagnostics service.
 */
data class AndroidDiagnosticsConfig(
    val debounceTimeMs: Long = 2000,  // Wait 2s after last edit before compiling
    val module: String = "app",
    val variant: String = "Debug",
    val useFullAssemble: Boolean = false,  // If true, run assemble instead of compileKotlin
    val compileTimeoutSeconds: Long = 300
)

/**
 * Manages diagnostics for Android projects by delegating to Gradle.
 * 
 * This replaces fwcd's Kotlin compiler-based diagnostics with Gradle compilation.
 * The flow is:
 *   1. didOpen/didChange triggers a debounced compile
 *   2. On compile, run ./gradlew :app:compileDebugKotlin
 *   3. Parse output for errors/warnings
 *   4. Emit publishDiagnostics to the client
 * 
 * For now, this works on the real project files (save-then-compile).
 * Shadow workspace support will be added later.
 */
class AndroidDiagnosticsService(
    private val projectRoot: Path,
    private val config: AndroidDiagnosticsConfig = AndroidDiagnosticsConfig()
) {
    private lateinit var client: LanguageClient
    private val async = AsyncExecutor()
    
    private var debouncer = Debouncer(Duration.ofMillis(config.debounceTimeMs))
    
    private val gradleCompiler = GradleCompiler(
        projectRoot,
        GradleCompilerConfig(
            module = config.module,
            variant = config.variant,
            timeoutSeconds = config.compileTimeoutSeconds
        )
    )
    
    // Track open files
    private val openFiles = ConcurrentHashMap<URI, OpenFileState>()
    
    // Track last diagnostics per file for clearing
    private val lastDiagnostics = ConcurrentHashMap<URI, List<Diagnostic>>()
    
    // Build state tracking
    private var lastBuildId = 0
    private var currentBuildId = 0
    
    data class OpenFileState(
        val uri: URI,
        val version: Int,
        val isDirty: Boolean = false
    )
    
    fun connect(client: LanguageClient) {
        this.client = client
        LOG.info("AndroidDiagnosticsService connected to client")
    }
    
    fun didOpen(uri: URI, version: Int) {
        openFiles[uri] = OpenFileState(uri, version, isDirty = false)
        LOG.info("Opened: $uri")
        
        // Trigger initial diagnostics
        scheduleCompile()
    }
    
    fun didChange(uri: URI, version: Int) {
        openFiles[uri] = OpenFileState(uri, version, isDirty = true)
        LOG.debug("Changed: $uri v$version")
        
        // Debounce compilation
        scheduleCompile()
    }
    
    fun didSave(uri: URI) {
        openFiles[uri]?.let { state ->
            openFiles[uri] = state.copy(isDirty = false)
        }
        LOG.info("Saved: $uri")
        
        // Compile immediately on save
        compileNow()
    }
    
    fun didClose(uri: URI) {
        openFiles.remove(uri)
        clearDiagnostics(uri)
        LOG.info("Closed: $uri")
    }
    
    private fun scheduleCompile() {
        debouncer.schedule { cancelled ->
            if (!cancelled.invoke()) {
                doCompile()
            }
        }
    }
    
    private fun compileNow() {
        debouncer.submitImmediately { cancelled ->
            if (!cancelled.invoke()) {
                doCompile()
            }
        }
    }
    
    private fun doCompile() {
        currentBuildId++
        val buildId = currentBuildId
        
        LOG.info("Starting Gradle compile (build #$buildId)")
        
        // Cancel any in-flight build
        if (gradleCompiler.isRunning()) {
            gradleCompiler.cancel()
        }
        
        // Run compilation
        val result = if (config.useFullAssemble) {
            gradleCompiler.assemble()
        } else {
            gradleCompiler.compileKotlin()
        }
        
        // Check if this build is still current
        if (buildId != currentBuildId) {
            LOG.info("Build #$buildId superseded by #$currentBuildId, discarding results")
            return
        }
        
        if (result.wasCancelled) {
            LOG.info("Build #$buildId was cancelled")
            return
        }
        
        LOG.info("Build #$buildId completed in ${result.durationMs}ms, exit=${result.exitCode}")
        
        // Parse diagnostics
        val diagnostics = GradleOutputParser.parse(result.output)
        
        // Group by file
        val byFile = diagnostics.groupBy({ it.first }, { it.second })
        
        // Publish diagnostics for files with errors
        for ((uri, diags) in byFile) {
            publishDiagnostics(uri, diags)
        }
        
        // Clear diagnostics for open files that had errors before but don't now
        val filesWithErrors = byFile.keys
        for (uri in lastDiagnostics.keys) {
            if (uri !in filesWithErrors) {
                clearDiagnostics(uri)
            }
        }
        
        // Log summary
        val errors = diagnostics.count { it.second.severity == DiagnosticSeverity.Error }
        val warnings = diagnostics.count { it.second.severity == DiagnosticSeverity.Warning }
        LOG.info("Diagnostics: $errors errors, $warnings warnings in ${byFile.size} files")
        
        lastBuildId = buildId
    }
    
    private fun publishDiagnostics(uri: URI, diagnostics: List<Diagnostic>) {
        lastDiagnostics[uri] = diagnostics
        client.publishDiagnostics(PublishDiagnosticsParams(uri.toString(), diagnostics))
        LOG.debug("Published ${diagnostics.size} diagnostics for $uri")
    }
    
    private fun clearDiagnostics(uri: URI) {
        lastDiagnostics.remove(uri)
        client.publishDiagnostics(PublishDiagnosticsParams(uri.toString(), emptyList()))
        LOG.debug("Cleared diagnostics for $uri")
    }
    
    /**
     * Force a full rebuild (useful for manual trigger from UI).
     */
    fun forceRebuild() {
        LOG.info("Force rebuild requested")
        compileNow()
    }
    
    /**
     * Update configuration (e.g., change module/variant).
     */
    fun updateConfig(newConfig: AndroidDiagnosticsConfig) {
        // Would need to recreate the compiler with new config
        // For now, this is a placeholder
    }
    
    fun shutdown() {
        gradleCompiler.cancel()
        async.shutdown(awaitTermination = true)
        debouncer.shutdown(awaitTermination = true)
    }
}
