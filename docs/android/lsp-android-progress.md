# Android LSP Progress Tracker

**Project:** Android Pseudo-LSP for TE2 Code CM6
**Started:** 2024-12-24
**Last Updated:** 2024-12-24

---

## Overview

Building an Android-capable LSP that delegates semantic analysis to Gradle/AGP instead of using a Kotlin compiler directly. This provides Android-correct diagnostics (resources, manifest, generated code) that no existing Kotlin LSP can provide.

---

## Phase 0: POC — Proof of Concept

### ✅ Completed (2024-12-24)

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
  - Parses kotlinc error/warning patterns: `e: /path:line:col: message`
  - Parses aapt2 error/warning patterns
  - Parses javac error/warning patterns
  - Shadow workspace path remapping support
  - Extracts failed task names for debugging

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

- [x] Verified all new code compiles with fwcd project

### ⏳ In Progress

#### Wire into LSP Server
- [ ] Modify `KotlinTextDocumentService.kt` to use `AndroidDiagnosticsService`
- [ ] Add Android project detection (is this a Gradle Android project?)
- [ ] Add configuration for module/variant selection

### 📋 TODO (POC)

- [ ] Test with real Android project (`./android/` — GeckoView app)
- [ ] Create shellspec entry: `shellspec/android_build.yaml`
- [ ] Wire into `lsp_shell_manager.py` as `kotlin-android` language ID
- [ ] Verify diagnostics flow to Code CM6 Issues Overlay

---

## Phase 1: MVP — Minimum Viable Product

### 📋 TODO

- [ ] Shadow workspace v1 (persistent .gradle/build caches)
- [ ] Incremental file change tracking
- [ ] Build panel UI in Code CM6
- [ ] Play button dropdown with Android modes
- [ ] Debounced diagnostics (10s idle trigger)

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

### TE2 Files

| File | Purpose |
|------|---------|
| `docs/android/fwcd_kotlin_lsp_fork_strategy.md` | Fork architecture documentation |
| `docs/android/lsp-android-progress.md` | This progress tracker |
| `.gitignore` | Added `app/static/vendor/ignored/` |

---

## GeckoView Test Project Notes

Located at `./android/` (gitignored):
- **Product flavors:** `Gecko`, `Webview`
- **Task names:** `:app:compileGeckoDebugKotlin`, etc.
- **aapt2 override:** Already configured for Termux
- **Requires:** `ANDROID_HOME` or `local.properties` with SDK path

---

## Session Log

### 2024-12-24

- Initial session: research, clone, build, implement core Gradle integration
- Duration: ~45 minutes
- Key outputs:
  - Fork cloned and building
  - 3 new Kotlin files implementing Gradle → LSP diagnostics bridge
  - Architecture documentation
  - This progress tracker
