package org.javacs.kt

import org.eclipse.lsp4j.*
import org.eclipse.lsp4j.jsonrpc.messages.Either
import org.eclipse.lsp4j.services.LanguageClient
import org.eclipse.lsp4j.services.LanguageClientAware
import org.eclipse.lsp4j.services.LanguageServer
import org.eclipse.lsp4j.services.NotebookDocumentService
import org.eclipse.lsp4j.services.TextDocumentService
import org.eclipse.lsp4j.services.WorkspaceService
import org.javacs.kt.gradle.AndroidDiagnosticsService
import org.javacs.kt.gradle.AndroidDiagnosticsConfig
import org.javacs.kt.util.parseURI
import java.io.Closeable
import java.nio.file.Path
import java.nio.file.Paths
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletableFuture.completedFuture

/**
 * Android-only Kotlin Language Server.
 * 
 * This is a gutted fork of fwcd/kotlin-language-server that delegates
 * all diagnostics to Gradle compilation instead of using Kotlin compiler APIs.
 * 
 * It only supports:
 * - textDocument/didOpen, didChange, didSave, didClose → triggers Gradle compile
 * - textDocument/publishDiagnostics → emits parsed Gradle errors
 * 
 * All other LSP features (completion, hover, go-to-definition, etc.) are disabled.
 * Use the official JetBrains Kotlin LSP for those features on non-Android projects.
 */
class KotlinLanguageServer : LanguageServer, LanguageClientAware, Closeable {
    
    private lateinit var client: LanguageClient
    private lateinit var projectRoot: Path
    private lateinit var androidDiagnostics: AndroidDiagnosticsService
    private val textDocumentService = AndroidTextDocumentService(this)
    private val workspaceService = AndroidWorkspaceService(this)
    
    companion object {
        val VERSION: String = "0.1.0-android"
    }
    
    init {
        LOG.info("Android Kotlin Language Server: Version $VERSION")
    }
    
    override fun connect(client: LanguageClient) {
        this.client = client
        LOG.info("Connected to client")
    }
    
    fun getClient(): LanguageClient = client
    
    fun getAndroidDiagnostics(): AndroidDiagnosticsService = androidDiagnostics

    override fun getTextDocumentService(): TextDocumentService = textDocumentService

    override fun getWorkspaceService(): WorkspaceService = workspaceService

    override fun initialize(params: InitializeParams): CompletableFuture<InitializeResult> {
        LOG.info("Initializing Android Kotlin LSP...")
        
        // Extract project root from workspace folders or rootUri
        @Suppress("DEPRECATION")
        val rootUri = params.workspaceFolders?.firstOrNull()?.uri
            ?: params.rootUri
            ?: params.rootPath?.let { Paths.get(it).toUri().toString() }
            ?: throw IllegalStateException("No workspace root provided")
        
        projectRoot = Paths.get(parseURI(rootUri))
        LOG.info("Project root: $projectRoot")
        
        // Detect module and variant from initialization options or use defaults
        val options = params.initializationOptions
        LOG.info("Raw initializationOptions: $options (type: ${options?.javaClass})")
        
        val module: String
        val variant: String
        val lspProjectId: String
        val cacheRoot: String

        when (options) {
            is Map<*, *> -> {
                module = options["module"]?.toString() ?: "app"
                variant = options["variant"]?.toString() ?: "Debug"
                lspProjectId = options["lspProjectId"]?.toString() ?: ""
                cacheRoot = options["cacheRoot"]?.toString() ?: ""
            }
            is com.google.gson.JsonObject -> {
                module = options.get("module")?.asString ?: "app"
                variant = options.get("variant")?.asString ?: "Debug"
                lspProjectId = options.get("lspProjectId")?.asString ?: ""
                cacheRoot = options.get("cacheRoot")?.asString ?: ""
            }
            else -> {
                module = "app"
                variant = "Debug"
                lspProjectId = ""
                cacheRoot = ""
            }
        }
        
        LOG.info("Android config: module=$module, variant=$variant")
        LOG.info("Android cache: lspProjectId=$lspProjectId, cacheRoot=$cacheRoot")

        // Initialize Android diagnostics service
        androidDiagnostics = AndroidDiagnosticsService(
            projectRoot,
            AndroidDiagnosticsConfig(
                module = module,
                variant = variant,
                debounceTimeMs = 2000
            )
        )
        androidDiagnostics.connect(client)

        // Cache config (TE2 passes these via initializationOptions)
        if (lspProjectId.isNotBlank() && cacheRoot.isNotBlank()) {
            try {
                androidDiagnostics.configureSidecar(lspProjectId, Paths.get(cacheRoot))
            } catch (e: Exception) {
                LOG.warn("Failed to configure sidecar: ${e.message}")
            }
        } else {
            LOG.info("No sidecar configured (missing lspProjectId/cacheRoot)")
        }
        
        // Minimal capabilities - only diagnostics
        val capabilities = ServerCapabilities().apply {
            textDocumentSync = Either.forLeft(TextDocumentSyncKind.Full)
            // All other capabilities disabled - this is diagnostics-only
        }
        
        val serverInfo = ServerInfo("Android Kotlin LSP", VERSION)
        
        LOG.info("Android Kotlin LSP initialized")
        return completedFuture(InitializeResult(capabilities, serverInfo))
    }
    
    override fun initialized(params: InitializedParams?) {
        LOG.info("Client initialized, ready for diagnostics")
        try {
            androidDiagnostics.maybeReplayCachedDiagnostics()
        } catch (_: Exception) {
        }
    }

    override fun shutdown(): CompletableFuture<Any> {
        LOG.info("Shutting down Android Kotlin LSP")
        close()
        return completedFuture(null)
    }

    override fun exit() {
        LOG.info("Exiting Android Kotlin LSP")
    }
    
    override fun close() {
        if (::androidDiagnostics.isInitialized) {
            androidDiagnostics.shutdown()
        }
    }

    override fun getNotebookDocumentService(): NotebookDocumentService? = null
}

/**
 * Minimal TextDocumentService that delegates to AndroidDiagnosticsService.
 */
class AndroidTextDocumentService(
    private val server: KotlinLanguageServer
) : TextDocumentService {
    
    override fun didOpen(params: DidOpenTextDocumentParams) {
        val uri = parseURI(params.textDocument.uri)
        LOG.info("didOpen: $uri")
        server.getAndroidDiagnostics().didOpen(uri, params.textDocument.version)
    }
    
    override fun didChange(params: DidChangeTextDocumentParams) {
        val uri = parseURI(params.textDocument.uri)
        LOG.debug("didChange: $uri v${params.textDocument.version}")
        server.getAndroidDiagnostics().didChange(uri, params.textDocument.version)
    }
    
    override fun didSave(params: DidSaveTextDocumentParams) {
        val uri = parseURI(params.textDocument.uri)
        LOG.info("didSave: $uri")
        server.getAndroidDiagnostics().didSave(uri)
    }
    
    override fun didClose(params: DidCloseTextDocumentParams) {
        val uri = parseURI(params.textDocument.uri)
        LOG.info("didClose: $uri")
        server.getAndroidDiagnostics().didClose(uri)
    }
    
    // All other methods return empty/null - this is diagnostics-only
    override fun completion(position: CompletionParams): CompletableFuture<Either<List<CompletionItem>, CompletionList>> =
        completedFuture(Either.forLeft(emptyList()))
    
    override fun hover(params: HoverParams): CompletableFuture<Hover?> =
        completedFuture(null)
    
    override fun definition(params: DefinitionParams): CompletableFuture<Either<List<Location>, List<LocationLink>>> =
        completedFuture(Either.forLeft(emptyList()))
    
    override fun references(params: ReferenceParams): CompletableFuture<List<Location>> =
        completedFuture(emptyList())
    
    override fun documentSymbol(params: DocumentSymbolParams): CompletableFuture<List<Either<SymbolInformation, DocumentSymbol>>> =
        completedFuture(emptyList())
    
    override fun codeAction(params: CodeActionParams): CompletableFuture<List<Either<Command, CodeAction>>> =
        completedFuture(emptyList())
    
    override fun formatting(params: DocumentFormattingParams): CompletableFuture<List<TextEdit>> =
        completedFuture(emptyList())
    
    override fun signatureHelp(params: SignatureHelpParams): CompletableFuture<SignatureHelp?> =
        completedFuture(null)
}

/**
 * Minimal WorkspaceService - mostly no-ops for Android LSP.
 */
class AndroidWorkspaceService(
    private val server: KotlinLanguageServer,
) : WorkspaceService {
    override fun didChangeConfiguration(params: DidChangeConfigurationParams) {
        val settings = params.settings
        try {
            val (repoFingerprint, dirtyFiles) = AndroidWorkspaceSettings.extractTe2Android(settings)
            LOG.info("TE2 didChangeConfiguration: repoFingerprint=${repoFingerprint ?: "<null>"} dirtyFiles=${dirtyFiles.size}")
            server.getAndroidDiagnostics().updateTe2State(repoFingerprint, dirtyFiles)
        } catch (e: Exception) {
            LOG.debug("didChangeConfiguration parse failed: ${e.message}")
        }
    }

    override fun didChangeWatchedFiles(params: DidChangeWatchedFilesParams) {
        LOG.debug("didChangeWatchedFiles (ignored)")
    }
}

object AndroidWorkspaceSettings {
    fun extractTe2Android(settings: Any?): Pair<String?, List<String>> {
        if (settings == null) return Pair(null, emptyList())

        // Expected shape: { te2Android: { repoFingerprint: string, dirtyFiles: [] } }
        if (settings is Map<*, *>) {
            val te2 = settings["te2Android"]
            if (te2 is Map<*, *>) {
                val fp = te2["repoFingerprint"]?.toString()?.trim().orEmpty().ifBlank { null }
                val df = (te2["dirtyFiles"] as? List<*>)?.mapNotNull { it?.toString() } ?: emptyList()
                return Pair(fp, df)
            }
        }

        if (settings is com.google.gson.JsonObject) {
            val te2 = settings.getAsJsonObject("te2Android")
            val fp = te2?.get("repoFingerprint")?.asString?.trim().orEmpty().ifBlank { null }
            val arr = te2?.getAsJsonArray("dirtyFiles")
            val df = arr?.mapNotNull { it?.asString } ?: emptyList()
            return Pair(fp, df)
        }

        return Pair(null, emptyList())
    }
}
