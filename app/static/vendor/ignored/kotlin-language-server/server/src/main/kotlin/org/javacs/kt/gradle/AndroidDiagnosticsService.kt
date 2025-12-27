package org.javacs.kt.gradle

import org.eclipse.lsp4j.*
import org.eclipse.lsp4j.services.LanguageClient
import com.intellij.psi.PsiErrorElement
import com.intellij.psi.util.PsiTreeUtil
import org.eclipse.lsp4j.Diagnostic
import org.eclipse.lsp4j.DiagnosticSeverity
import org.eclipse.lsp4j.PublishDiagnosticsParams
import org.javacs.kt.LOG
import org.javacs.kt.ScriptsConfiguration
import org.javacs.kt.CodegenConfiguration
import org.javacs.kt.compiler.Compiler
import org.javacs.kt.position.range
import org.javacs.kt.progress.LanguageClientProgress
import org.javacs.kt.progress.Progress
import org.javacs.kt.util.AsyncExecutor
import org.javacs.kt.util.Debouncer
import java.io.File
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

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

    private var progressFactory: Progress.Factory = Progress.Factory.None
    private var compileProgress: Progress? = null
    private var compileProgressBuildId: Int = 0
    
    private var debouncer = Debouncer(Duration.ofMillis(config.debounceTimeMs))
    private var syntaxDebouncer = Debouncer(Duration.ofMillis(200))

    // Syntax-only diagnostics (fast, no Gradle, based on Kotlin PSI error elements)
    private val syntaxDiagnostics = ConcurrentHashMap<URI, List<Diagnostic>>()
    private val gradleDiagnostics = ConcurrentHashMap<URI, List<Diagnostic>>()
    private val openFileText = ConcurrentHashMap<URI, String>()

    private var syntaxCompiler: Compiler? = null

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

    // TE2-provided state (via workspace/didChangeConfiguration)
    @Volatile private var te2RepoFingerprint: String? = null
    @Volatile private var te2DirtyFiles: List<String> = emptyList()
    @Volatile private var lastReplayFingerprint: String? = null

    // Sidecar caching (optional)
    private var sidecarPath: Path? = null
    private var sidecarProjectId: String? = null
    private var sidecar: AndroidSidecarV1? = null
    
    data class OpenFileState(
        val uri: URI,
        val version: Int,
        val isDirty: Boolean = false
    )

    private fun ensureSyntaxCompiler(): Compiler {
        val existing = syntaxCompiler
        if (existing != null) return existing

        // For syntax diagnostics we only need PSI parsing. Use empty classpath.
        val outDir = try {
            val p = sidecarPath?.parent?.resolve("syntax_out")
            if (p != null) {
                Files.createDirectories(p)
                p.toFile()
            } else {
                Files.createTempDirectory("kls_syntax_out").toFile()
            }
        } catch (_: Exception) {
            File(System.getProperty("java.io.tmpdir"), "kls_syntax_out").apply { mkdirs() }
        }

        val c = Compiler(
            javaSourcePath = emptySet(),
            classPath = emptySet(),
            buildScriptClassPath = emptySet(),
            scriptsConfig = ScriptsConfiguration(enabled = false),
            codegenConfig = CodegenConfiguration(enabled = false),
            outputDirectory = outDir,
        )
        syntaxCompiler = c
        return c
    }

    private fun computeSyntaxDiagnostics(text: String, uri: URI): List<Diagnostic> {
        return try {
            val compiler = ensureSyntaxCompiler()
            val path = try { Path.of(uri) } catch (_: Exception) { null }
            val file = compiler.createKtFile(text, path ?: java.nio.file.Paths.get("dummy.virtual.kt"))

            val errors = PsiTreeUtil.collectElementsOfType(file, PsiErrorElement::class.java)
            errors.take(50).mapNotNull { err ->
                try {
                    val d = Diagnostic(
                        range(text, err.textRange),
                        err.errorDescription ?: "Syntax error",
                        DiagnosticSeverity.Error,
                        "kotlin-syntax",
                    )
                    d.code = org.eclipse.lsp4j.jsonrpc.messages.Either.forLeft("syntax")
                    d
                } catch (_: Exception) {
                    null
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun publishMergedDiagnostics(uri: URI) {
        val merged = (syntaxDiagnostics[uri] ?: emptyList()) + (gradleDiagnostics[uri] ?: emptyList())
        lastDiagnostics[uri] = merged
        client.publishDiagnostics(PublishDiagnosticsParams(uri.toString(), merged))
        LOG.debug("Published ${merged.size} merged diagnostics for $uri")
    }

    private fun scheduleSyntax(uri: URI) {
        syntaxDebouncer.schedule { cancelled ->
            if (!cancelled.invoke()) {
                val text = openFileText[uri] ?: return@schedule
                val diags = computeSyntaxDiagnostics(text, uri)
                syntaxDiagnostics[uri] = diags
                publishMergedDiagnostics(uri)
            }
        }
    }
    
    fun connect(client: LanguageClient) {
        this.client = client
        this.progressFactory = LanguageClientProgress.Factory(client)
        LOG.info("AndroidDiagnosticsService connected to client")
    }

    fun updateTe2State(repoFingerprint: String?, dirtyFiles: List<String>) {
        te2RepoFingerprint = repoFingerprint?.trim()?.ifBlank { null }
        te2DirtyFiles = dirtyFiles
        LOG.debug("TE2 state updated: repoFingerprint=${te2RepoFingerprint} dirtyFiles=${te2DirtyFiles.size}")

        // Opportunistic cache replay when we first learn the repo fingerprint.
        val fp = te2RepoFingerprint
        if (!fp.isNullOrBlank() && fp != lastReplayFingerprint) {
            lastReplayFingerprint = fp
            maybeReplayCachedDiagnostics()
        }
    }

    fun configureSidecar(lspProjectId: String, cacheRoot: Path) {
        sidecarProjectId = lspProjectId
        val projectDir = cacheRoot.resolve(lspProjectId)
        Files.createDirectories(projectDir)
        sidecarPath = projectDir.resolve("sidecar.json")
        sidecar = sidecarPath?.let { AndroidSidecarIO.load(it) }
        LOG.info("Sidecar configured: id=$lspProjectId path=$sidecarPath loaded=${sidecar != null}")
    }

    fun maybeReplayCachedDiagnostics() {
        val fp = te2RepoFingerprint
        val sc = sidecar
        if (fp.isNullOrBlank() || sc == null) return
        if (sc.lastKnownRepoFingerprint != fp) return
        if (sc.diagnosticsByUri.isEmpty()) return
        LOG.info("Replaying cached diagnostics (fingerprint match)")
        replayCached(sc, provenance = "cached")
    }
    
    fun didOpen(uri: URI, version: Int, text: String?) {
        openFiles[uri] = OpenFileState(uri, version, isDirty = false)
        if (text != null) {
            openFileText[uri] = text
        }
        LOG.info("Opened: $uri")
        scheduleSyntax(uri)

        // Mid-flight page refreshes create a new client, but the same LSP backend.
        // Re-emit cached diagnostics for the specific opened file so the new client gets squiggles.
        try {
            val fp = te2RepoFingerprint
            val sc = sidecar
            if (!fp.isNullOrBlank() && sc != null && sc.lastKnownRepoFingerprint == fp) {
                val cached = sc.diagnosticsByUri[uri.toString()]
                if (cached != null) {
                    val diags = cached.map { cd ->
                        val d = cd.toLspDiagnostic()
                        d.code = org.eclipse.lsp4j.jsonrpc.messages.Either.forLeft("cached")
                        d
                    }
                    publishDiagnostics(uri, diags)
                    return
                }
            }
        } catch (_: Exception) {
        }

        // If we have no cached diagnostics yet for this project, run an initial compile.
        val sc = sidecar
        if (sc == null || sc.diagnosticsByUri.isEmpty()) {
            scheduleCompile()
        }
    }
    
    fun didChange(uri: URI, version: Int, text: String?) {
        openFiles[uri] = OpenFileState(uri, version, isDirty = true)
        if (text != null) {
            openFileText[uri] = text
        }
        LOG.debug("Changed: $uri v$version")

        scheduleSyntax(uri)
        // Never compile on change; TE2 is responsible for repo/dirty tracking + save triggers.
    }
    
    fun didSave(uri: URI) {
        openFiles[uri]?.let { state ->
            openFiles[uri] = state.copy(isDirty = false)
        }
        LOG.info("Saved: $uri")

        val fp = te2RepoFingerprint
        val sc = sidecar
        LOG.info(
            "didSave decision: fp=${fp ?: "<null>"} sidecarFp=${sc?.lastKnownRepoFingerprint ?: "<null>"} " +
                "sidecarHas=${sc?.diagnosticsByUri?.size ?: 0}"
        )
        if (!fp.isNullOrBlank() && sc != null && sc.lastKnownRepoFingerprint == fp && sc.diagnosticsByUri.isNotEmpty()) {
            LOG.info("Repo fingerprint unchanged; replaying cached diagnostics")
            replayCached(sc, provenance = "cached")
            return
        }

        LOG.info("Repo fingerprint changed/missing cache; compiling")
        // Compile immediately on save (authoritative diagnostics)
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

        // Emit workDoneProgress so clients can show a spinner during Gradle builds.
        try {
            // Close any prior progress first.
            try {
                compileProgress?.close()
            } catch (_: Exception) {
            }
            compileProgress = null
            compileProgressBuildId = buildId

            val task = if (config.useFullAssemble) {
                ":${config.module}:assemble${config.variant}"
            } else {
                ":${config.module}:compile${config.variant}Kotlin"
            }

            compileProgress = progressFactory.create("Gradle compile")
                .get(2, TimeUnit.SECONDS)
                .also { it.update("Running $task", 0) }
        } catch (e: Exception) {
            compileProgress = null
        }
        
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
            try {
                if (compileProgressBuildId == buildId) {
                    compileProgress?.close()
                    compileProgress = null
                }
            } catch (_: Exception) {
            }
            return
        }
        
        if (result.wasCancelled) {
            LOG.info("Build #$buildId was cancelled")
            try {
                if (compileProgressBuildId == buildId) {
                    compileProgress?.close()
                    compileProgress = null
                }
            } catch (_: Exception) {
            }
            return
        }
        
        LOG.info("Build #$buildId completed in ${result.durationMs}ms, exit=${result.exitCode}")

        try {
            if (compileProgressBuildId == buildId) {
                val status = if (result.exitCode == 0) "Succeeded" else "Failed (exit=${result.exitCode})"
                compileProgress?.update("Gradle compile finished: $status", 100)
                compileProgress?.close()
                compileProgress = null
            }
        } catch (_: Exception) {
        }
        
        // Log raw output for debugging (first 500 chars)
        val outputPreview = result.output.take(500).replace("\n", "\\n")
        LOG.info("Gradle output preview: $outputPreview")
        
        // Parse diagnostics
        val diagnostics = GradleOutputParser.parse(result.output)

        // Group by file
        val byFile = diagnostics.groupBy({ it.first }, { it.second })

        // Publish diagnostics for files with errors (tag provenance)
        for ((uri, diags0) in byFile) {
            val diags = diags0.map { d ->
                d.code = org.eclipse.lsp4j.jsonrpc.messages.Either.forLeft("gradle")
                d
            }
            gradleDiagnostics[uri] = diags
            publishMergedDiagnostics(uri)
        }

        // Persist sidecar (keyed by lspProjectId) if configured
        try {
            val path = sidecarPath
            val pid = sidecarProjectId
            if (path != null && !pid.isNullOrBlank()) {
                // Keep explicit empty entries for files that previously had diagnostics but are now clean.
                val previous = sidecar?.diagnosticsByUri?.keys ?: emptySet()

                val current: Map<String, List<CachedDiagnostic>> = byFile.entries.associate { (uri, diags0) ->
                    val diags = diags0.map { d ->
                        d.code = org.eclipse.lsp4j.jsonrpc.messages.Either.forLeft("gradle")
                        d
                    }
                    uri.toString() to diags.map { it.toCached() }
                }

                val withEmpties = LinkedHashMap<String, List<CachedDiagnostic>>()
                withEmpties.putAll(current)
                for (uriStr in previous) {
                    if (!withEmpties.containsKey(uriStr)) {
                        withEmpties[uriStr] = emptyList()
                    }
                }

                val fp = te2RepoFingerprint
                val newSidecar = AndroidSidecarV1(
                    lspProjectId = pid,
                    projectRoot = projectRoot.toString(),
                    lastKnownRepoFingerprint = fp,
                    updatedAtMs = System.currentTimeMillis(),
                    diagnosticsByUri = withEmpties,
                )
                AndroidSidecarIO.save(path, newSidecar)
                sidecar = newSidecar
            }
        } catch (e: Exception) {
            LOG.warn("Failed to persist sidecar: ${e.message}")
        }

        // Clear diagnostics for open files that had errors before but don't now
        val filesWithErrors = byFile.keys
        for (uri in lastDiagnostics.keys) {
            if (uri !in filesWithErrors) {
                gradleDiagnostics[uri] = emptyList()
                publishMergedDiagnostics(uri)
            }
        }

        // Log summary
        val errors = diagnostics.count { it.second.severity == DiagnosticSeverity.Error }
        val warnings = diagnostics.count { it.second.severity == DiagnosticSeverity.Warning }
        LOG.info("Diagnostics: $errors errors, $warnings warnings in ${byFile.size} files")

        lastBuildId = buildId
    }
    
    private fun publishDiagnostics(uri: URI, diagnostics: List<Diagnostic>) {
        // Legacy entrypoint (used by cached replay). Treat as Gradle-source diagnostics.
        gradleDiagnostics[uri] = diagnostics
        publishMergedDiagnostics(uri)
    }

    private fun replayCached(sc: AndroidSidecarV1, provenance: String) {
        val byUri = sc.diagnosticsByUri

        // Publish cached diagnostics for all known URIs.
        for ((uriStr, cached) in byUri) {
            try {
                val uri = URI.create(uriStr)
                val diags = cached.map { cd ->
                    val d = cd.toLspDiagnostic()
                    d.code = org.eclipse.lsp4j.jsonrpc.messages.Either.forLeft(provenance)
                    d
                }
                publishDiagnostics(uri, diags)
            } catch (_: Exception) {
            }
        }

        // Clear any previously published diagnostics not present in cache.
        val present = byUri.keys.toSet()
        for (uri in lastDiagnostics.keys) {
            if (uri.toString() !in present) {
                clearDiagnostics(uri)
            }
        }
    }
    
    private fun clearDiagnostics(uri: URI) {
        lastDiagnostics.remove(uri)
        syntaxDiagnostics.remove(uri)
        gradleDiagnostics.remove(uri)
        openFileText.remove(uri)
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
