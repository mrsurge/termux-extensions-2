# fwcd/kotlin-language-server Fork Strategy

**Created:** 2024-12-24
**Purpose:** Technical analysis of the fwcd/kotlin-language-server codebase for the Android pseudo-LSP fork.

---

## Overview

We are forking [fwcd/kotlin-language-server](https://github.com/fwcd/kotlin-language-server) to create an **Android pseudo-LSP** that:
- Speaks the LSP protocol over stdio
- Receives `didOpen`, `didChange`, `didClose` from Code CM6
- Delegates semantic analysis to **Gradle/AGP** (running `./gradlew :app:compileDebugKotlin`)
- Parses Gradle output for errors/warnings
- Emits `publishDiagnostics` back to Code CM6

The fork is a **thin LSP wrapper around Gradle/AGP**. We are NOT using fwcd's semantic analysis — we are using its **LSP plumbing**.

---

## Source Location

The fork is cloned to:
```
app/static/vendor/ignored/kotlin-language-server/
```

This directory is gitignored (added to `.gitignore`).

---

## Architecture Analysis

### Entry Point

**File:** `server/src/main/kotlin/org/javacs/kt/Main.kt`

```kotlin
fun main(argv: Array<String>) {
    val server = KotlinLanguageServer()
    val launcher = LSPLauncher.createServerLauncher(server, inStream, outStream, threads) { it }
    server.connect(launcher.remoteProxy)
    launcher.startListening()
}
```

**Action:** Keep as-is. This is the LSP stdio launcher using LSP4J.

---

### Main Server

**File:** `server/src/main/kotlin/org/javacs/kt/KotlinLanguageServer.kt`

Key responsibilities:
- Implements `LanguageServer` interface
- Creates `textDocuments` service (`KotlinTextDocumentService`)
- Handles `initialize` request and returns capabilities
- Connects to `LanguageClient` for `publishDiagnostics`

**Action:** Keep, but simplify:
- Remove capabilities we won't support (completion, hover, definition, etc.)
- Keep `textDocumentSync` capability
- Keep `diagnosticsProvider` (or rely on push diagnostics)

---

### Text Document Service

**File:** `server/src/main/kotlin/org/javacs/kt/KotlinTextDocumentService.kt`

This is the core file we need to modify. Key methods:

| Method | Current Behavior | Action |
|--------|------------------|--------|
| `didOpen` | Opens file, triggers `lintNow` | Keep |
| `didChange` | Edits file, triggers `lintLater` (debounced) | Keep |
| `didClose` | Closes file, clears diagnostics | Keep |
| `doLint` | Calls `sp.compileFiles()`, `reportDiagnostics()` | **Replace** |
| `reportDiagnostics` | Converts Kotlin diagnostics → LSP, calls `client.publishDiagnostics()` | **Modify** |

#### Current Lint Flow (to be replaced)

```kotlin
private fun doLint(cancelCallback: () -> Boolean) {
    val files = clearLint()
    val context = sp.compileFiles(files)  // <-- Kotlin compiler
    if (!cancelCallback.invoke()) {
        reportDiagnostics(files, context.diagnostics)
    }
}

private fun reportDiagnostics(compiled: Collection<URI>, kotlinDiagnostics: Diagnostics) {
    val langServerDiagnostics = kotlinDiagnostics.flatMap(::convertDiagnostic)
    // ...
    client.publishDiagnostics(PublishDiagnosticsParams(uri.toString(), diagnostics))
}
```

#### New Lint Flow (Android pseudo-LSP)

```kotlin
private fun doLint(cancelCallback: () -> Boolean) {
    val files = clearLint()
    
    // Instead of Kotlin compiler, run Gradle
    val gradleOutput = runGradleCompile(projectRoot)
    
    if (!cancelCallback.invoke()) {
        val diagnostics = parseGradleOutput(gradleOutput)
        reportDiagnostics(files, diagnostics)
    }
}

private fun runGradleCompile(projectRoot: Path): GradleCompileResult {
    // Execute: ./gradlew :app:compileDebugKotlin --console=plain
    // Capture stdout/stderr
    // Return parsed result
}

private fun parseGradleOutput(output: String): List<Pair<URI, Diagnostic>> {
    // Parse patterns like:
    //   e: /path/to/File.kt:42:15: Unresolved reference: foo
    //   w: /path/to/File.kt:10:1: Deprecated API usage
}

private fun reportDiagnostics(files: Collection<URI>, diagnostics: List<Pair<URI, Diagnostic>>) {
    val byFile = diagnostics.groupBy({ it.first }, { it.second })
    for ((uri, diags) in byFile) {
        client.publishDiagnostics(PublishDiagnosticsParams(uri.toString(), diags))
    }
}
```

---

### Files to Remove/Gut

These files contain Kotlin compiler internals we don't need:

| Path | LOC | Purpose | Action |
|------|-----|---------|--------|
| `compiler/Compiler.kt` | 629 | `KotlinCoreEnvironment`, compilation | Remove |
| `CompiledFile.kt` | 300+ | Incremental expression compilation | Remove |
| `SourcePath.kt` | 300+ | Source file compilation/caching | Gut/simplify |
| `SourceFiles.kt` | 200+ | Source file tracking | Gut/simplify |
| `CompilerClassPath.kt` | 160+ | Classpath resolution | Remove |
| `completion/` | | Completions | Remove |
| `hover/` | | Hover info | Remove |
| `definition/` | | Go-to-definition | Remove |
| `references/` | | Find references | Remove |
| `rename/` | | Rename symbol | Remove |
| `codeaction/` | | Code actions | Remove |
| `formatting/` | | Code formatting | Remove |
| `signaturehelp/` | | Signature help | Remove |
| `semantictokens/` | | Semantic highlighting | Remove |
| `symbols/` | | Document symbols | Maybe keep for outline |
| `inlayhints/` | | Inlay hints | Remove |
| `highlight/` | | Document highlight | Remove |

---

### Files to Keep (Minimal)

| Path | Purpose |
|------|---------|
| `Main.kt` | LSP4J stdio launcher |
| `KotlinLanguageServer.kt` | Server setup, capabilities |
| `KotlinTextDocumentService.kt` | didOpen/didChange/didClose + lint dispatch |
| `Configuration.kt` | Config parsing (simplify) |
| `diagnostic/ConvertDiagnostic.kt` | Replace with Gradle output parser |
| `position/` | Position/range utilities |
| `util/` | General utilities (Debouncer, AsyncExecutor, etc.) |

---

## New Components to Add

### 1. Gradle Compiler Integration

**File:** `server/src/main/kotlin/org/javacs/kt/gradle/GradleCompiler.kt`

```kotlin
class GradleCompiler(
    private val projectRoot: Path,
    private val module: String = "app",
    private val variant: String = "Debug"
) {
    fun compile(): GradleCompileResult {
        val process = ProcessBuilder()
            .command("./gradlew", ":$module:compile${variant}Kotlin", "--console=plain")
            .directory(projectRoot.toFile())
            .redirectErrorStream(true)
            .start()
        
        val output = process.inputStream.bufferedReader().readText()
        process.waitFor()
        
        return GradleCompileResult(
            exitCode = process.exitValue(),
            output = output
        )
    }
}

data class GradleCompileResult(
    val exitCode: Int,
    val output: String
)
```

### 2. Gradle Output Parser

**File:** `server/src/main/kotlin/org/javacs/kt/gradle/GradleOutputParser.kt`

```kotlin
object GradleOutputParser {
    // e: /path/to/File.kt:42:15: Unresolved reference: foo
    private val ERROR_PATTERN = Regex("""e:\s+(.+):(\d+):(\d+):\s+(.+)""")
    // w: /path/to/File.kt:10:1: Deprecated API usage
    private val WARNING_PATTERN = Regex("""w:\s+(.+):(\d+):(\d+):\s+(.+)""")
    
    fun parse(output: String): List<Pair<URI, Diagnostic>> {
        val diagnostics = mutableListOf<Pair<URI, Diagnostic>>()
        
        for (line in output.lines()) {
            ERROR_PATTERN.find(line)?.let { match ->
                diagnostics.add(createDiagnostic(match, DiagnosticSeverity.Error))
            }
            WARNING_PATTERN.find(line)?.let { match ->
                diagnostics.add(createDiagnostic(match, DiagnosticSeverity.Warning))
            }
        }
        
        return diagnostics
    }
    
    private fun createDiagnostic(match: MatchResult, severity: DiagnosticSeverity): Pair<URI, Diagnostic> {
        val (path, lineStr, colStr, message) = match.destructured
        val line = lineStr.toInt() - 1  // LSP is 0-indexed
        val col = colStr.toInt() - 1
        
        val uri = Path.of(path).toUri()
        val range = Range(Position(line, col), Position(line, col + 1))
        val diagnostic = Diagnostic(range, message, severity, "kotlinc")
        
        return uri to diagnostic
    }
}
```

### 3. Shadow Workspace (Optional, for later)

For diagnostics on unsaved buffers, implement shadow workspace that:
- Mirrors project to temp location
- Swaps dirty files before Gradle compile
- Maps shadow paths back to real URIs

---

## Build Instructions

The fwcd repo uses Gradle. Build with:

```bash
cd app/static/vendor/ignored/kotlin-language-server
./gradlew :server:build
```

Output JAR will be in `server/build/libs/`.

---

## Integration with TE2

### Option A: Spawn as pipe shell via shellspec

```yaml
# app/apps/file_editor_cm6/shellspec/android_build.yaml
android-lsp:
  backend: pipe
  cwd: ${ctx:PROJECT_ROOT}
  subgroups: [file_editor_cm6, lsp, android]
  command:
    - java
    - -jar
    - /path/to/android-pseudo-lsp.jar
    - --project-root
    - ${ctx:PROJECT_ROOT}
  env:
    ANDROID_HOME: ${env:ANDROID_HOME}
    JAVA_HOME: ${env:JAVA_HOME}
```

### Option B: Direct process spawn in lsp_shell_manager.py

Add entry in `lsp_shell_manager.py` for `kotlin-android` language ID that spawns the forked LSP.

---

## Next Steps

1. **Set up build environment** — ensure Gradle/JDK are available
2. **Gut unnecessary modules** — remove semantic analysis code
3. **Implement GradleCompiler** — run Gradle and capture output
4. **Implement GradleOutputParser** — parse error/warning patterns
5. **Modify KotlinTextDocumentService** — wire new lint backend
6. **Test locally** — verify diagnostics flow to Code CM6
7. **Create shellspec entry** — integrate with TE2 LSP shell manager
