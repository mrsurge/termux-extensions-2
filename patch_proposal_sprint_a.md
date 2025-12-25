# Patch Proposal — Sprint A (Android LSP Dependency Cache Skeleton)

**Date:** 2025-12-25

## Goal
Add the TE2-side persisted Android dependency-cache skeleton described in `android_lsp_dependency_cache_plan.md` Sprint A:

- Create a TE2-controlled per-project sidecar at:
  - `${cacheRoot}/${lspProjectId}/te2_android_sidecar.json`
- Implement and persist:
  - `repoFingerprint` (reuse existing logic)
  - `draftFingerprint` (new)
  - `syncFingerprint` (new)
- Implement a **minimal dependency model builder v1** (skeleton-level facts only):
  - Android SDK `android.jar` discovery
  - JDK/JAVA_HOME capture
  - Gradle user home capture
  - best-effort detection of a few generated roots if present

**Non-goals for Sprint A:** emitting diagnostics, heuristics, arbitration/merge logic (those are Sprint B/C in the plan).

---

## Current repo status (already implemented)
These items from the plan’s “Current State” are already present in TE2:

- `repoFingerprint` computation (git-diff based, FS fallback): `app/apps/file_editor_cm6/lsp_ws.py` (`_compute_repo_fingerprint`).
- `dirtyFiles` computed from `ProjectSidecar.list_project_drafts()` and sent via `workspace/didChangeConfiguration`: `app/apps/file_editor_cm6/lsp_ws.py`.
- Server-side save injection (iframe path): `editor_app.py` calls `send_android_did_save_for_path(...)` and is **rootRel-aware**.
- Kotlin Android LSP process launch is already configured (shellspec + initializationOptions injection):
  - shellspec: `app/apps/file_editor_cm6/shellspec/android_lsp.yaml`
  - initOptions injection: `app/apps/file_editor_cm6/lsp_ws.py` (sets `module`, `variant`, `lspProjectId`, `cacheRoot`).

---

## Proposed patches (Sprint A)

### Package layout change (android_lang)
Place all new Android-specific TE2 modules under a dedicated package:

- `app/apps/file_editor_cm6/android_lang/`
  - add `__init__.py`

This keeps Android LSP + cache logic cohesive and avoids polluting the top-level `file_editor_cm6` namespace.

### 1) New module: `app/apps/file_editor_cm6/android_lang/android_sidecar.py`
**Purpose:** Small, testable persistence helpers for `${cacheRoot}/${lspProjectId}/te2_android_sidecar.json`.

**Responsibilities:**
- Resolve `cacheRoot` consistently with existing behavior:
  - env `TE2_ANDROID_LSP_CACHE_ROOT` else default `~/.cache/te2_android_lsp`
- Resolve `lspProjectId` from `ProjectSidecar.get_or_create_lsp_project_id()`.
- Return `projectCacheDir = ${cacheRoot}/${lspProjectId}/`.
- Atomic JSON read/write (similar approach to `project_sidecar.py`).
- Keep schema versioned (`version: 1`).

### 2) New module: `app/apps/file_editor_cm6/android_lang/android_fingerprints.py` (or keep inside bridge)
**Purpose:** Centralize the two new fingerprints in Sprint A.

**Functions:**
- `compute_draft_fingerprint(effective_project_root: Path, drafts: list[dict]) -> str`
  - Input drafts come from `ProjectSidecar.list_project_drafts()`.
  - Filter drafts to ones within `effective_project_root` (rootRel-aware).
  - Algorithm (per plan):
    - `items = sorted([relPath + "\0" + content_sha256])`
    - `sha256("\n".join(items)).hexdigest()[:20]`
- `compute_sync_fingerprint(effective_project_root: Path, module: str, variant: str) -> str`
  - v1: hash mtimes+sizes of pinned Gradle files (**include module-level files**):
    - root:
      - `settings.gradle`, `settings.gradle.kts`
      - `build.gradle`, `build.gradle.kts`
      - `gradle.properties`
      - `gradle/wrapper/gradle-wrapper.properties`
      - `gradle/libs.versions.toml` (if present)
    - module (e.g. `app/`):
      - `${module}/build.gradle`, `${module}/build.gradle.kts`
  - Plus include `module`/`variant` strings in the payload.

### 3) New module: `app/apps/file_editor_cm6/android_lang/android_dependency_model.py` (builder v1)
**Purpose:** Build the minimal dependency model facts and persist into sidecar.

**Builder v1 outputs (best-effort):**
- `androidSdk`:
  - `compileSdk` (optional best-effort parse from Gradle build files; OK to leave null)
  - `androidJar` path resolution attempts (in order):
    1. `$ANDROID_SDK_ROOT` / `$ANDROID_HOME`
    2. `local.properties` (`sdk.dir=`)
    3. (optional) `~/Android/Sdk` heuristic
- `jvm`:
  - `javaHome`: `$JAVA_HOME` if set
  - `jrtOrJmods`: if `JAVA_HOME/jmods` exists, record it
- `gradle`:
  - `gradleUserHome`: `$GRADLE_USER_HOME` else `~/.gradle`
- `generated` (if present):
  - record a few well-known directories under `${module}/build/generated/...` when they exist
  - record a best-effort `R.jar`/`R.txt` if found (bounded search under `${module}/build/`)

**Important constraint:** builder must be lightweight and never run Gradle in Sprint A.

### 4) New orchestrator: `app/apps/file_editor_cm6/android_lang/android_lsp_bridge.py`
**Purpose:** TE2-side orchestrator that ties together:
- effective root (rootRel-aware)
- lspProjectId
- sidecar load/save
- fingerprint computation
- dependency model builder

**Public API (proposed):**
- `update_android_sidecar_for_project(*, project_root: Path, effective_project_root: Path, module: str, variant: str) -> None`
  - Computes `repoFingerprint` using **shared helper code** (do *not* import private `_compute_repo_fingerprint` directly from `lsp_ws.py`):
    - either move fingerprint helpers into `android_lang/android_fingerprints.py` and have `lsp_ws.py` call into it
    - or duplicate the minimal fingerprint implementation in `android_lang` (prefer shared helper to avoid drift)
  - Computes `draftFingerprint` from ProjectSidecar drafts (rootRel-aware)
  - Computes `syncFingerprint` (root + module Gradle files)
  - Builds dependency model v1
  - Writes `te2_android_sidecar.json`

### 5) Integration hook (minimal)
Add a single call site that updates the TE2 Android sidecar after real disk saves:

- **Preferred hook:** inside `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`, in the iframe save path right after a successful save (near existing `send_android_did_save_for_path(...)` call).
  - Must use the same `effective_project_root` logic already present there (rootRel-aware).
  - Pass the **same** `module`/`variant` that the kotlin-android LSP uses (Sprint A can default to `app`/`GeckoDebug`, but persist them explicitly).
  - Run the bridge update in background (non-blocking) using `anyio.to_thread.run_sync` or `asyncio.to_thread`.

This keeps Sprint A behavior purely additive and avoids coupling to the Kotlin LSP internals.

---

## Proposed schema (Sprint A, v1)
File: `${cacheRoot}/${lspProjectId}/te2_android_sidecar.json`

Matches the plan; minimal required fields for Sprint A:
- `version: 1`
- `lspProjectId`
- `effectiveProjectRoot`
- `repoFingerprint`
- `draftFingerprint`
- `syncFingerprint`
- `dependencyModel`:
  - `builtAtMs`
  - `module`, `variant`
  - `androidSdk.androidJar`, `androidSdk.compileSdk`
  - `jvm.javaHome`, `jvm.jrtOrJmods`
  - `gradle.gradleUserHome`
  - `generated.*` (only if found)

---

## Acceptance criteria (Sprint A)
- After saving any file in an Android project with kotlin-android LSP enabled:
  - `${cacheRoot}/${lspProjectId}/te2_android_sidecar.json` exists and is valid JSON.
  - `repoFingerprint` is 20 hex chars and changes on meaningful saves in a git repo.
  - `draftFingerprint` changes when the ProjectSidecar has unsaved draft content changes.
  - `syncFingerprint` changes when pinned Gradle files change.
  - `dependencyModel` contains at least `gradleUserHome` and (when available) `JAVA_HOME` and `android.jar`.

---

## Risks / notes
- Android SDK discovery on-device is messy; Sprint A should tolerate missing SDK and simply record null/absent fields.
- Gradle file parsing must be best-effort and non-fatal.
- Ensure the bridge always uses **effective project root** (rootRel override) to avoid fingerprint/cache mismatches.

---

## Out of scope (explicitly deferred)
- Any `publishDiagnostics` injection from TE2 (Sprint B).
- Heuristic/draft diagnostics (Sprint B).
- Arbitration/merge/suppression rules (Sprint C).
- UI actions (Sync button) (Sprint D).
