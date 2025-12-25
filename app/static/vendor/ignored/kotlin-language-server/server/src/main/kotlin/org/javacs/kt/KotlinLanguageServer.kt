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
    private val workspaceService = AndroidWorkspaceService()
    
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
        
        when (options) {
            is Map<*, *> -> {
                module = options["module"]?.toString() ?: "app"
                variant = options["variant"]?.toString() ?: "Debug"
            }
            is com.google.gson.JsonObject -> {
                module = options.get("module")?.asString ?: "app"
                variant = options.get("variant")?.asString ?: "Debug"
            }
            else -> {
                module = "app"
                variant = "Debug"
            }
        }
        
        LOG.info("Android config: module=$module, variant=$variant")
        
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
class AndroidWorkspaceService : WorkspaceService {
    override fun didChangeConfiguration(params: DidChangeConfigurationParams) {
        LOG.debug("didChangeConfiguration (ignored)")
    }
    
    override fun didChangeWatchedFiles(params: DidChangeWatchedFilesParams) {
        LOG.debug("didChangeWatchedFiles (ignored)")
    }
}
