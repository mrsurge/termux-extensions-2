# Android LSP Progress Tracker

**Project:** Android Pseudo-LSP for TE2 Code CM6
**Started:** 2024-12-24
**Last Updated:** 2025-12-25

---

## Overview

Building an Android-capable LSP that delegates semantic analysis to Gradle/AGP instead of using a Kotlin compiler directly. This provides Android-correct diagnostics (resources, manifest, generated code) that no existing Kotlin LSP can provide.

---

## Phase 0: POC — Proof of Concept

### ✅ Completed (2024-12-24 / 2025-12-25)

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
  - **TE2-aware state gating:** consumes `workspace/didChangeConfiguration` (`te2Android.repoFingerprint`, `dirtyFiles`)
  - **Compile policy:** no compile on typing; compile on save (unless fingerprint unchanged → replay cached)
  - **Persistent cache:** Android sidecar JSON stored under `${cacheRoot}/${lspProjectId}/sidecar.json`
  - **Cache replay:**
    - on LSP start when fingerprint matches
    - on `didOpen` for the opened URI (supports mid-flight page refresh)
  - **Explicit empties:** persists `uri: []` entries for previously-dirty files that disappear from current Gradle output

- [x] **Gutted `KotlinLanguageServer.kt` for Android-only mode:**
  - Removed all fwcd Kotlin compiler integration
  - Removed completion, hover, go-to-definition, etc.
  - Only keeps TextDocumentSync for diagnostics
  - Delegates entirely to `AndroidDiagnosticsService`
  - Parses `initializationOptions` for module/variant (supports `JsonObject`)
  - Reports as "Android Kotlin LSP" v0.1.0-android

- [x] Created `AndroidTextDocumentService` and `AndroidWorkspaceService`:
  - Minimal implementations that delegate to AndroidDiagnosticsService
  - **WorkspaceService now consumes didChangeConfiguration** to accept TE2 fingerprint state
  - All non-diagnostic LSP methods return empty results

- [x] Updated `Main.kt`:
  - Always logs to stderr for debugging
  - Cleaner startup flow

- [x] Verified all new code compiles with fwcd project

#### End-to-End Testing
- [x] **POC VERIFIED WORKING:**
  - Server starts and responds to `initialize`
  - `initialize` injects/consumes:
    - `module`, `variant`
    - `lspProjectId` (stable project identifier)
    - `cacheRoot` (TE2-controlled cache root)
  - Gradle compile triggers:
    - initial compile on first open when no cache exists
    - subsequent compiles on save when repo fingerprint changes
  - Errors parsed from Gradle output
  - `publishDiagnostics` emitted with correct line/column/message
  - **Cache replay works on refresh:** cached diags re-emit on `didOpen` for the opened file

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

- [x] Create shellspec entry: `shellspec/android_lsp.yaml`
- [x] Wire into `lsp_shell_manager.py` with Orchestrator pattern
- [x] Add Android Kotlin LSP to Language Servers modal (template.html)
- [x] Wire up main.js handlers for new server
- [x] Add to ProjectSidecar schema
- [x] Add to editor_app.py preference validation and LSP routing
- [x] Add to main.py API endpoints (start/stop/status)
- [x] Fix variant detection (inject `module=app, variant=GeckoDebug` via lsp_ws.py)
- [x] **Test end-to-end in Code CM6 — SQUIGGLES APPEAR! ✅**

## ✅ POC COMPLETE (2025-12-25)

The Android Kotlin LSP is fully integrated with Code CM6:
- Diagnostics flow from Gradle → LSP → Socket.IO → CodeMirror
- Squiggle underlines render on error lines
- Issues Overlay shows error count and messages
- **Persistent diagnostics cache** survives page refreshes and can be replayed instantly
- **Save-triggered compile** is reliable even though the iframe LSP client does not send `didSave`

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
| `server/src/main/kotlin/org/javacs/kt/gradle/AndroidDiagnosticsService.kt` | Manage diagnostics lifecycle (TE2 state + cache) |
| `server/src/main/kotlin/org/javacs/kt/gradle/AndroidSidecar.kt` | Persistent diagnostics cache (`sidecar.json`) |

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
| `app/apps/file_editor_cm6/shellspec/android_lsp.yaml` | Shellspec for Android Kotlin LSP |
| `app/apps/file_editor_cm6/lsp_shell_manager.py` | Added `_spawn_android_kotlin_lsp()` via Orchestrator |
| `app/apps/file_editor_cm6/template.html` | Added Android Kotlin LSP row to Language Servers modal |
| `app/apps/file_editor_cm6/main.js` | Wired up Android Kotlin LSP toggle/start/rootRel handlers |
| `app/apps/file_editor_cm6/project_sidecar.py` | Added `kotlin-android` to LSP schema; added `lsp.project_id` + dump_raw helper |
| `app/apps/file_editor_cm6/lsp_ws.py` | Injects init options (`lspProjectId`, `cacheRoot`); sends repo fingerprints; server-side didSave injection; serialized pipe writes |
| `app/apps/file_editor_cm6/main.py` | Debug endpoints (`/history/raw`, `/project/sidecar/raw`, `/debug/state/raw`); didSave injection on legacy `/write` path; rootRel-aware fingerprinting |
| `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` | didSave injection on iframe `/save` path; rootRel-aware fingerprinting |

### Built Artifacts

| Location | Description |
|----------|-------------|
| `app/static/vendor/ignored/kotlin-language-server/server/build/distributions/server.zip` | Distribution zip (~85MB) |
| `app/static/vendor/lsp_servers/android-kotlin-lsp/server/` | Installed vendor location |

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

- Continued session: gut KLS, fix parser, end-to-end testing, Code CM6 integration
- Duration: ~4 hours
- Key outputs:
  - **KotlinLanguageServer.kt completely rewritten** for Android-only mode
  - Fixed GradleOutputParser regex for Gradle 8.x `file://` URI format
  - Added debug logging throughout
  - Fixed initializationOptions parsing (JsonObject vs Map)
  - Created shellspec `android_lsp.yaml`
  - Wired into `lsp_shell_manager.py` with Orchestrator pattern
  - Added Android Kotlin LSP row to Language Servers modal
  - Extended ProjectSidecar and HistoryStore schemas
  - Added preference validation in editor_app.py
  - Added API endpoints in main.py (start/stop/status)
  - Fixed variant injection in lsp_ws.py (GeckoDebug for product flavors)
  - **POC COMPLETE:** Squiggles appear in Code CM6! ✅

### 2025-12-25 (Session 3)

- Continued session: make Android Kotlin LSP "fast" (cache + fingerprint gating) and correct save triggers
- Key outputs:
  - Added `lsp.project_id` (stable per-project identifier) in ProjectSidecar
  - Added debug endpoints:
    - `GET /history/raw`
    - `GET /project/sidecar/raw`
    - `GET /debug/state/raw`
  - `lsp_ws.py` improvements:
    - inject `initializationOptions.lspProjectId` + `cacheRoot`
    - compute short repo fingerprint (20 hex chars)
      - git mode: `HEAD + status + diff` (diff included so repeated saves change fingerprint)
      - fallback mode: filesystem manifest hash
    - send `workspace/didChangeConfiguration` to Android LSP with `{repoFingerprint, dirtyFiles}`
    - add per-shell stdin write lock to prevent interleaved frames
  - Android Kotlin LSP improvements:
    - consumes didChangeConfiguration (TE2 state)
    - caches diagnostics in `${cacheRoot}/${lspProjectId}/sidecar.json`
    - replays cached diagnostics on start (fingerprint match)
    - replays cached diagnostics per-URI on `didOpen` (supports mid-flight refresh)
    - persists explicit empty diagnostics entries for previously-dirty files that are now clean
    - compile triggers: on open only if no cache; on save if fingerprint changed
  - Server-side save trigger (critical): iframe LSP client does not send `didSave`
    - Inject `workspace/didChangeConfiguration` + `textDocument/didSave` on save endpoints
    - RootRel-aware: fingerprint must be computed from the same effective project root as `connect_lsp`

### 2025-12-26 (Session 4b / Restoration Note)

- User observation: the earlier “working” claims in this tracker were accurate at the time; subsequent breakage/regressions were introduced later.
- Action taken: project state was restored back to a known-good configuration.
- Follow-up focus: identify *which* change(s) caused the regression (likely around draft/caching/index/variant plumbing), then re-introduce improvements incrementally with tight validation.

[2025-12-26T17:11:35.085Z] NOTE: The red (Gradle-backed) diagnostics/squiggles path was already working; the intended work scope was only to add draft-based WARNING (yellow) diagnostics on top without destabilizing the existing red error pipeline.
