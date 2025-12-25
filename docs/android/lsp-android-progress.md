# Android LSP Progress Tracker

**Project:** Android Pseudo-LSP for TE2 Code CM6
**Started:** 2024-12-24
**Last Updated:** 2024-12-25

---

## Overview

Building an Android-capable LSP that delegates semantic analysis to Gradle/AGP instead of using a Kotlin compiler directly. This provides Android-correct diagnostics (resources, manifest, generated code) that no existing Kotlin LSP can provide.

---

## Phase 0: POC — Proof of Concept

### ✅ Completed (2024-12-24 / 2024-12-25)

#### Setup & Research
- [x] Read and understood planning documents:
  - `te2.md` — Framework shell integration
  - `framework_shells.md` — Shell management module
  - `road_to_alpha_battle_plan.md` — Consolidated implementation plan
  - `road_to_android_build_environment_alpha.md` — Alpha milestones
  - `play_button_manifesto.md` — Play button as dispatch system
  - `tmp.md` — Current LSP/Issues overlay architecture

- [x] Created gitignored directory for forked projects:
  - `app/static/vendor/ignored/` — added to `.gitignore`

- [x] Cloned fwcd/kotlin-language-server:
  - Location: `app/static/vendor/ignored/kotlin-language-server/`
  - Shallow clone (`--depth 1`)

- [x] Analyzed fwcd architecture and documented:
  - Created `docs/android/fwcd_kotlin_lsp_fork_strategy.md`
  - Identified files to keep (LSP plumbing) vs. gut (Kotlin compiler internals)

- [x] Verified build environment:
  - Gradle 8.12 ✅
  - JDK 21 ✅
  - Updated `gradle.properties` to use Java 21 (was 11)
  - Build succeeds (3 unrelated test failures, ignorable)
  - LSP server starts and responds to initialize

#### Implementation
- [x] Created `server/src/main/kotlin/org/javacs/kt/gradle/` package

- [x] Implemented `GradleOutputParser.kt`:
  - Parses kotlinc error/warning patterns: `e: file:///path:line:col message`
  - Parses aapt2 error/warning patterns
  - Parses javac error/warning patterns
  - Shadow workspace path remapping support
  - Extracts failed task names for debugging
  - **Fixed regex for Gradle 8.x output format** (modern `file://` URI prefix, space before message)

- [x] Implemented `GradleCompiler.kt`:
  - Runs Gradle tasks in subprocess
  - Captures stdout/stderr
  - Cancellation support (for superseding builds)
  - Timeout handling (default 5 min)
  - Environment passthrough (critical for Termux aapt2)
  - `compileKotlin()`, `assemble()`, `compileJava()` convenience methods

- [x] Implemented `AndroidDiagnosticsService.kt`:
  - Manages debounced compile → parse → publishDiagnostics flow
  - Tracks open files
  - Handles didOpen/didChange/didSave/didClose
  - Build ID tracking for superseding stale results
  - Connects to LanguageClient for diagnostics emission

- [x] **Gutted `KotlinLanguageServer.kt` for Android-only mode:**
  - Removed all fwcd Kotlin compiler integration
  - Removed completion, hover, go-to-definition, etc.
  - Only keeps TextDocumentSync for diagnostics
  - Delegates entirely to `AndroidDiagnosticsService`
  - Parses `initializationOptions` for module/variant (supports `JsonObject`)
  - Reports as "Android Kotlin LSP" v0.1.0-android

- [x] Created `AndroidTextDocumentService` and `AndroidWorkspaceService`:
  - Minimal implementations that delegate to AndroidDiagnosticsService
  - All non-diagnostic LSP methods return empty results

- [x] Updated `Main.kt`:
  - Always logs to stderr for debugging
  - Cleaner startup flow

- [x] Verified all new code compiles with fwcd project

#### End-to-End Testing
- [x] **POC VERIFIED WORKING:**
  - Server starts and responds to `initialize`
  - `didOpen` triggers Gradle compile (`:app:compileGeckoDebugKotlin`)
  - Errors parsed from Gradle output
  - `publishDiagnostics` emitted with correct line/column/message
  - `initializationOptions` respected for module/variant selection

**Test output:**
```json
{
  "jsonrpc": "2.0",
  "method": "textDocument/publishDiagnostics",
  "params": {
    "uri": "file:///...android/app/src/main/java/com/termux/extensions/NativeBridge.kt",
    "diagnostics": [{
      "range": {"start": {"line": 10, "character": 20}, "end": {"line": 10, "character": 30}},
      "severity": 1,
      "source": "kotlinc",
      "message": "Unresolved reference: undefinedVariable"
    }]
  }
}
```

### 📋 TODO (POC Remaining)

- [ ] Create shellspec entry: `shellspec/android_build.yaml`
- [ ] Wire into `lsp_shell_manager.py` as `kotlin-android` language ID
- [ ] Test end-to-end in Code CM6 (diagnostics appear in Issues Overlay)

---

## Phase 1: MVP — Minimum Viable Product

### 📋 TODO

- [ ] Shadow workspace v1 (for diagnostics on unsaved changes)
- [ ] Persistent .gradle/build caches across compiles
- [ ] Incremental file change tracking
- [ ] Build panel UI in Code CM6
- [ ] Play button dropdown with Android modes
- [ ] Debounced diagnostics (10s idle trigger) — *currently 2s, may need tuning*

---

## Phase 2: Alpha — User-Ready

### 📋 TODO

- [ ] Toolchain profile detection (Gradle/AGP/JDK versions)
- [ ] Install ladder (interactive → root → Shizuku)
- [ ] Launch app after install
- [ ] Logcat integration
- [ ] User documentation

---

## Key Technical Decisions

### Why fork fwcd/kotlin-language-server?

1. **LSP plumbing is done** — stdio transport, message parsing, request routing
2. **Kotlin/JVM** — runs on Termux
3. **We're NOT using its semantic analysis** — we replace it with Gradle

### Why gut it completely?

The official JetBrains Kotlin LSP handles non-Android Kotlin fine. This fork is **Android-only** — it doesn't need completion, hover, go-to-definition, etc. Those features would require the full Kotlin compiler which doesn't understand Android.

### Why Gradle for semantics?

No Kotlin LSP understands Android:
- Resources (`R.class`, drawable refs)
- Manifest-derived types
- Data binding / view binding generated code
- AGP-specific classpath resolution

Gradle/AGP is the **only** source of truth for Android project correctness.

### Environment Requirements

On Termux, we need:
- `ANDROID_HOME` pointing to Android SDK
- `PATH` containing system `aapt2` (not bundled version)
- GeckoView project already has: `android.aapt2FromMavenOverride=/data/data/com.termux/files/usr/bin/aapt2`

---

## Files Created/Modified

### New Files (in fork)

| File | Purpose |
|------|---------|
| `server/src/main/kotlin/org/javacs/kt/gradle/GradleOutputParser.kt` | Parse Gradle output for diagnostics |
| `server/src/main/kotlin/org/javacs/kt/gradle/GradleCompiler.kt` | Run Gradle tasks, capture output |
| `server/src/main/kotlin/org/javacs/kt/gradle/AndroidDiagnosticsService.kt` | Manage diagnostics lifecycle |

### Modified Files (in fork)

| File | Change |
|------|--------|
| `gradle.properties` | Changed `javaVersion=11` → `javaVersion=21` |
| `server/src/main/kotlin/org/javacs/kt/KotlinLanguageServer.kt` | **Gutted** — Android-only, delegates to AndroidDiagnosticsService |
| `server/src/main/kotlin/org/javacs/kt/Main.kt` | Always log to stderr |

### TE2 Files

| File | Purpose |
|------|---------|
| `docs/android/fwcd_kotlin_lsp_fork_strategy.md` | Fork architecture documentation |
| `docs/android/lsp-android-progress.md` | This progress tracker |
| `.gitignore` | Added `app/static/vendor/ignored/` |

### Built Artifacts

| Location | Description |
|----------|-------------|
| `app/static/vendor/ignored/kotlin-language-server/server/build/distributions/server.zip` | Distribution zip (~85MB) |
| `/data/data/com.termux/files/home/kls-test/server/` | Extracted test installation |

---

## GeckoView Test Project Notes

Located at `./android/` (gitignored):
- **Product flavors:** `Gecko`, `Webview`
- **Task names:** `:app:compileGeckoDebugKotlin`, etc.
- **aapt2 override:** Already configured for Termux
- **Requires:** `ANDROID_HOME` or `local.properties` with SDK path

---

## Session Log

### 2024-12-24 (Session 1)

- Initial session: research, clone, build, implement core Gradle integration
- Duration: ~45 minutes
- Key outputs:
  - Fork cloned and building
  - 3 new Kotlin files implementing Gradle → LSP diagnostics bridge
  - Architecture documentation
  - This progress tracker

### 2024-12-25 (Session 2)

- Continued session: gut KLS, fix parser, end-to-end testing
- Duration: ~2 hours
- Key outputs:
  - **KotlinLanguageServer.kt completely rewritten** for Android-only mode
  - Fixed GradleOutputParser regex for Gradle 8.x `file://` URI format
  - Added debug logging throughout
  - Fixed initializationOptions parsing (JsonObject vs Map)
  - **POC VERIFIED:** Full diagnostics pipeline working
  - Updated battle plan and progress tracker
