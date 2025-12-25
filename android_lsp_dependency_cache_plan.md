# Android LSP — Dependency Cache + Draft Bridge Plan

**Date:** 2025-12-25

This document is a concrete, implementation-oriented plan for adding a TE2-side “draft bridge” (`android_lsp_bridge.py` conceptually) that:

- Maintains a **cached model** of Android/Gradle dependency resolution (“dependency table”) in the background.
- Uses that cached model + last compile results to generate/merge diagnostics.
- Emits **only** standard LSP diagnostics (`textDocument/publishDiagnostics`) for the existing Code CM6 Issues pipeline.
- Never exposes the dependency tree/table to the user directly.

---

## 0) Current State (What We Have Working)

### Android Kotlin LSP (fork)
- Runs Gradle compilation to produce diagnostics.
- Consumes TE2 state via `workspace/didChangeConfiguration`:
  - `settings.te2Android.repoFingerprint`
  - `settings.te2Android.dirtyFiles`
- Maintains a persistent sidecar cache (owned by the LSP server):
  - `${cacheRoot}/${lspProjectId}/sidecar.json`
  - Stores `lastKnownRepoFingerprint` + diagnostics keyed by URI.
- Replays cached diagnostics:
  - on startup if fingerprint matches
  - per-URI on `didOpen` (supports mid-flight refresh)
- Compiles:
  - on open only when cache is missing/empty
  - on save when fingerprint changes

### TE2 (Code CM6)
- Computes a short `repoFingerprint` (20 hex chars) based on **git diff** so it changes on every meaningful save.
- Injects `didSave` server-side (because the iframe client doesn’t send `didSave`):
  - injects `workspace/didChangeConfiguration` + `textDocument/didSave`
  - rootRel-aware: fingerprint computed from the same effective project root used to spawn the LSP.

---

## 1) Problem / Motivation

Gradle/AGP is authoritative, but it’s too slow to run on every keystroke.
We still want “live-ish” feedback in the editor while typing (drafts), without pretending to be a full semantic IDE.

We achieve this by:

1) Treating Gradle diagnostics as **truth**, cached and replayed.
2) Maintaining a background **dependency-resolution model** (the “unresolved dependency table”) that helps us generate **conservative heuristic diagnostics** during draft mode.
3) Always emitting diagnostics through the same UI pipeline (Issues + squiggles).

---

## 2) Design Principles / Non-goals

### Principles
- **One UI pipeline**: everything becomes `publishDiagnostics`.
- **Provenance tagging**: every diagnostic indicates whether it is:
  - `gradle` (authoritative, fresh)
  - `cached` (authoritative-ish, from last compile)
  - `draft` (heuristic)
- **Conservative draft mode**: prefer false negatives over false positives.

### Non-goals (for this plan)
- Full Kotlin semantic correctness (overloads, extension resolution, etc.).
- Showing dependency tree/table as a UI feature.
- Rebuilding Android Studio.

---

## 3) The “Bridge” (android_lsp_bridge.py) — What It Is

A TE2-side orchestrator (not the Kotlin LSP itself) that:

- Tracks project identity + effective root:
  - `lspProjectId` (ProjectSidecar SSOT)
  - `effective_project_root` (rootRel-aware)
- Tracks three fingerprints:
  1) `repoFingerprint` (git-diff-based; authoritative “what’s on disk”)
  2) `draftFingerprint` (hash of the current drafts/session cache; “what the user is editing”)
  3) `syncFingerprint` (dependency-model version; “classpath map freshness”)
- Owns a TE2-side Android sidecar cache (separate from ProjectSidecar):
  - stores dependency-table facts and indexes
  - stores last-known-good dependency graph snapshot
  - stores last-known “compile environment facts” (sdk paths, android.jar, gradle caches)

It does **not** replace the Kotlin LSP.
It feeds the Kotlin LSP (or bypasses it) by emitting `publishDiagnostics` to Code CM6.

---

## 4) Data Model (TE2-side Android Sidecar)

### Location
Use the same cache root policy:

- `cacheRoot = $HOME/.cache/te2_android_lsp` (default)
- `projectCacheDir = ${cacheRoot}/${lspProjectId}/`

Add a TE2-controlled sidecar file:

- `${projectCacheDir}/te2_android_sidecar.json`

### JSON schema (v1)
```json
{
  "version": 1,
  "lspProjectId": "f6671a13",
  "effectiveProjectRoot": "/abs/path/to/project/or/rootRel",

  "repoFingerprint": "<20-hex>",
  "draftFingerprint": "<20-hex>",
  "syncFingerprint": "<20-hex>",

  "lastGradleCompile": {
    "repoFingerprint": "<20-hex>",
    "variant": "GeckoDebug",
    "module": "app",
    "finishedAtMs": 0,
    "exitCode": 0
  },

  "dependencyModel": {
    "builtAtMs": 0,
    "variant": "GeckoDebug",
    "module": "app",

    "androidSdk": {
      "androidJar": "/sdk/platforms/android-34/android.jar",
      "compileSdk": 34
    },

    "jvm": {
      "javaHome": "/path/to/jdk",
      "jrtOrJmods": "/path/to/jmods"
    },

    "gradle": {
      "gradleUserHome": "/home/.../.gradle",
      "resolvedArtifacts": [
        {
          "gav": "com.squareup.okhttp3:okhttp:4.9.0",
          "type": "external",
          "paths": ["/home/.../.gradle/caches/.../okhttp-4.9.0.jar"],
          "status": "present"
        }
      ]
    },

    "generated": {
      "rSymbols": {
        "rJar": "/project/app/build/.../R.jar",
        "rTxt": "/project/app/build/.../R.txt"
      },
      "viewBindingRoots": ["/project/app/build/generated/..."],
      "buildConfigRoots": ["/project/app/build/generated/source/buildConfig"]
    }
  }
}
```

### The “Unresolved Dependency Table” mapping
This is a **classification table** used by heuristics; store it as a stable enum mapping, not a user-visible report.

Example internal enum:
- `EXTERNAL_LIB`
- `PROJECT_MODULE`
- `ANDROID_FRAMEWORK`
- `JDK`
- `RESOURCE_SYMBOLS`
- `VIEW_BINDINGS`
- `BUILD_CONFIG`
- `TRANSITIVE_LIBS`
- `BUILD_SCRIPT_PLUGINS`

---

## 5) Fingerprints

### 5.1 repoFingerprint (already exists)
- Git mode:
  - `HEAD`
  - `git status --porcelain -z`
  - `git diff --no-color`
  - `sha256(payload)[:20]`
- FS fallback:
  - stable manifest of (path, mtime_ns, size) for bounded set
  - `sha256(...)[:20]`

### 5.2 draftFingerprint (new)
Draft state should be based on content hashes, not mtimes.

Inputs:
- The current session-cache entries for the active project:
  - file path
  - draft content SHA256

Algorithm:
- `items = sorted([relPath + "\0" + content_sha256])`
- `draftFingerprint = sha256("\n".join(items)).hexdigest()[:20]`

Notes:
- This fingerprint should be computed over the **effective project root** scope (rootRel-aware).

### 5.3 syncFingerprint (new)
Represents “classpath map freshness”.

Inputs:
- build.gradle / settings.gradle / gradle-wrapper.properties hashes
- plus the dependency model build timestamp
- plus `./gradlew :app:dependencies` output hash (optional)

Keep it cheap:
- v1: hash of file mtimes+sizes for the above Gradle files + variant/module.

---

## 6) Dependency Model Builder

### Trigger rules
- Build/refresh dependency model when:
  - `syncFingerprint` changes (Gradle files changed)
  - user explicitly clicks “Sync Project with Gradle Files” (future button)
  - periodic background refresh (optional; low priority)

### What we extract (minimal viable)
We do NOT need a full dependency graph UI.
We need a cached mapping for heuristic decisions:

- Android SDK paths:
  - determine `compileSdk` and locate `android.jar`
- Java/JDK location (from env or Gradle):
  - `JAVA_HOME`, `org.gradle.java.home`, or runtime
- Gradle resolved artifact paths:
  - run: `./gradlew :app:dependencies --configuration <...>` OR `:app:androidDependencies` (AGP)
  - parse for GAVs
  - optionally locate actual jar/aar files from Gradle cache
- Generated source roots known to affect “unresolved”:
  - R symbols (`R.jar`, `R.txt`)
  - view binding output directories
  - build config output

Output:
- a normalized list of “resolution facts” stored in `dependencyModel`.

---

## 7) Draft Diagnostics Heuristics (Using the Dependency Table)

### Scope
Draft diagnostics should be explicitly conservative and mostly focused on:
- imports and unresolved references that we can confidently classify
- stale-cache explanations (“this is based on last compile / last sync”)

### Example heuristic rules
1) **Import looks like Android framework** (`import android.*`):
   - if dependency model says android.jar missing → emit diagnostic:
     - message: `Android SDK missing for compileSdk=... (android.jar not found)`
     - provenance: `draft`

2) **Import looks like Java/JDK** (`import java.*`, `javax.*`, `kotlin.*`):
   - if JDK path missing → emit `JDK not configured` diagnostic

3) **R / ViewBinding / BuildConfig references**:
   - if referencing `R.` and dependency model indicates last build failed to generate resources → emit note:
     - `R is unresolved because resource symbol generation failed in last compile`
     - provenance: `cached` (or `draft` depending on signal)

4) **External GAV-driven class usage**:
   - only flag if we’ve previously observed a Gradle error that references the missing class/import.
   - do NOT try to infer full classpath existence without heavy jar scanning in v1.

### Messaging policy
- Overlay note should be subtle:
  - `Based on last Gradle compile` or `Based on cached dependency model`.
- Don’t spam: only emit a few high-confidence diagnostics.

---

## 8) Merging & Arbitration (What Gets Published)

This is the core value of the bridge.

Inputs:
- `gradleDiagnosticsFresh` (if a compile just ran)
- `cachedDiagnostics` (from Kotlin LSP sidecar or TE2 sidecar)
- `draftDiagnostics` (heuristics)

Policy:
1) If fresh Gradle diagnostics exist for the current repoFingerprint:
   - publish them as authoritative
2) Else if cached diagnostics exist and match repoFingerprint:
   - publish them (provenance `cached`)
3) If drafts exist (draftFingerprint != empty):
   - optionally merge in draft diagnostics, BUT:
     - do not keep stale cached “unresolved reference” errors if a draft likely fixes it
     - only suppress where we have targeted safe rules

Implementation note:
- This merge happens before emitting `publishDiagnostics`.
- This is the place where the dependency table is used to suppress/annotate.

---

## 9) Integration Points (Concrete Files)

### TE2 side
- `app/apps/file_editor_cm6/project_sidecar.py`
  - SSOT for `lsp.project_id` (already)

- `app/apps/file_editor_cm6/history_store.py`
  - SSOT for `rootRel` overrides (already)

- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
  - on save: already injects didSave + didChangeConfiguration
  - next: also trigger bridge draftFingerprint updates (future)

- `app/apps/file_editor_cm6/lsp_ws.py`
  - has pipeline to send didChangeConfiguration (already)
  - has server-side didSave injection (already)
  - future: expose a callable “publishDiagnostics injection” helper for bridge

### New TE2 module(s)
- `app/apps/file_editor_cm6/android_lsp_bridge.py` (new)
  - orchestrator described in this doc

- `app/apps/file_editor_cm6/android_sidecar.py` (optional new)
  - TE2 sidecar load/save helpers

### Kotlin LSP fork
- Keep Kotlin LSP as the authoritative Gradle runner.
- Bridge does not require modifying Kotlin LSP beyond what already exists.

---

## 10) Sprint Plan

### Sprint A (Dependency model skeleton + persistence)
- [ ] Create TE2-side sidecar file `${cacheRoot}/${lspProjectId}/te2_android_sidecar.json`
- [ ] Implement `repoFingerprint`, `draftFingerprint`, `syncFingerprint`
- [ ] Implement dependency model builder v1:
  - find android.jar
  - record JAVA_HOME
  - record Gradle user home
  - collect a few generated roots if present

### Sprint B (Heuristic diagnostics + provenance)
- [ ] Implement 2–3 draft heuristics (Android SDK missing, R generation missing, JDK missing)
- [ ] Emit as `publishDiagnostics` with provenance tagging

### Sprint C (Arbitration + suppression rules)
- [ ] Implement merge rules between cached and draft
- [ ] Add targeted suppression to avoid “ghost errors”

### Sprint D (Sync trigger)
- [ ] Add a UI action: “Sync Project with Gradle Files”
  - rebuild dependency model
  - optionally force one compile

---

## 11) Validation / Acceptance

- [ ] After a successful Gradle compile, refresh page: cached diagnostics appear immediately.
- [ ] After changing a Gradle file (dependency), the system marks dependency model stale and shows only conservative draft hints until sync/compile.
- [ ] Draft-mode heuristics never produce large volumes of false positives.
- [ ] Provenance appears in the Issues overlay (at least via `diagnostic.code` or `source`).

---

## 12) Notes / Open Questions

- How much jar scanning is acceptable on-device?
  - v1: none (use “only flag imports previously known to fail”).
  - v2: optional background jar index if performance allows.

- Where should the bridge publish from?
  - Option 1: publish via existing LSP server (Kotlin) by injecting `publishDiagnostics` (server-side).
  - Option 2: publish via Code CM6 directly (bypassing Kotlin) for draft diagnostics only.

Recommendation: start with Option 2 for draft diagnostics (less coupling), keep Kotlin server authoritative for Gradle.
