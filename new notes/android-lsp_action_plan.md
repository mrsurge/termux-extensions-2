# Android LSP — Action Plan (TE2 + Android Kotlin LSP)

**Date:** 2025-12-25  
**Status:** Draft (for review)  
**Scope:** “Live enough diagnostics” for Android projects in Code CM6, without building Android Studio.

---

## 0) Current State (as of today)

### What already works
- Code CM6 runs an **Android Kotlin LSP** as a **Framework Shell (pipe backend)**.
  - Spawn spec: `app/apps/file_editor_cm6/shellspec/android_lsp.yaml`
  - Spawn code: `app/apps/file_editor_cm6/lsp_shell_manager.py` (`language_id == "kotlin-android"`)
- The Socket.IO bridge (`app/apps/file_editor_cm6/lsp_ws.py`) injects Android init options:
  - `initializationOptions.module` (default `app`)
  - `initializationOptions.variant` (default `GeckoDebug`)
- Diagnostics already flow end-to-end:
  - Gradle output → LSP `publishDiagnostics` → `/lsp` bridge → iframe → squiggles + Issues Overlay

### Where the Android LSP lives
- **Runtime distro (used at runtime):** `app/static/vendor/lsp_servers/android-kotlin-lsp/server/`
  - Entrypoint used by TE2: `.../server/bin/kotlin-language-server`
- There is an old source checkout at `app/static/vendor/ignored/kotlin-language-server/`.
  - **Not referenced by TE2 runtime path** (TE2 points to the distro path above).
  - Candidate for removal after final confirmation.

---

## 1) Big Decisions (lock these in early)

### 1.1 Diagnostics authority
- The **Android Kotlin LSP process** is the *single authority* for:
  - Running Gradle
  - Parsing compiler output
  - Owning persistent “Android sidecar” state (cached diags, metadata)

### 1.2 Sidecar location
- Sidecar is **per-project** and stored under a TE2-controlled cache root, keyed by a stable LSP project id (SSOT):
  - `~/.cache/te2_android_lsp/<lspProjectId>/sidecar.json`
- `lspProjectId` comes from HistoryStore/ProjectSidecar and is **always present**:
  - **Policy:** “if it doesn’t exist, create it” during project open / initialization.
  - This should not depend on “Android LSP enabled once”; it should be a blanket invariant for all projects.
- Cache root + `lspProjectId` are passed into the LSP via `initializationOptions` so the LSP knows where to write/read cached state.

### 1.3 Trigger model
- Target behavior is **save-time Gradle truth** (not compile-on-every-keystroke).
- TE2 is the source of truth for **repo/dirty fingerprints** and sends them to the LSP.
- LSP policy:
  - Compile on **didSave** *when TE2 says the repo fingerprint changed*
  - While editing: show **cached** diagnostics (fast), not “lying” heuristics (draft mode is later)
  - Optional: compile-on-open only if we have no cached diagnostics yet

### 1.4 Provenance
- We need users to be able to trust what they see.
- Provenance must fit inside existing LSP diagnostics fields; no new UI surface.
  - Proposed: tag provenance via `diagnostic.code` (e.g. `"gradle"` vs `"cached"`) while keeping `diagnostic.source` as `kotlinc`/`aapt2`/`javac`.

---

## 2) First Sprint (do now)

### Sprint goal
Make Android diagnostics feel stable and fast across reloads by adding:
1) **Cached diagnostics replay** (instant squiggles on open/reconnect)
2) **Repo fingerprint gating** (only re-run Gradle when repo changed)
3) **Save-time compile policy** (stop compiling on didChange)

### Deliverables

#### D0 — Ensure `lspProjectId` exists (blanket invariant)
- Add `ProjectSidecar.get_or_create_lsp_project_id()` (or similar) and store it under the sidecar’s `lsp` section (e.g. `lsp.project_id`).
- On project open/initialization (wherever the active project is established), call it so the value is always present.

Acceptance:
- Any project that gets opened has a stable `lspProjectId` persisted in its ProjectSidecar.

#### D1 — Pass cache + project identity into LSP
- TE2 injects additional `initializationOptions` for `kotlin-android` (in `lsp_ws.py`):
  - `lspProjectId`: stable id from ProjectSidecar (SSOT)
  - `cacheRoot`: TE2-controlled cache root path (e.g. `~/.cache/te2_android_lsp/`)
  - `module`, `variant` (already)

Acceptance:
- LSP logs show it received `cacheRoot` + `lspProjectId`.

#### D2 — AndroidSidecar inside the LSP (keyed by lspProjectId)
Implement a minimal persisted JSON sidecar in the Android Kotlin LSP:
- Stored under `${cacheRoot}/${lspProjectId}/sidecar.json`
- Schema v1:
  - `version`
  - `projectRoot`, `lspProjectId`
  - `lastKnownRepoFingerprint` (string)
  - `lastCompile` (timestamp, task, durationMs, exitCode)
  - `diagnosticsByUri` (uri → list[diagnostic payload])

Acceptance:
- Restart LSP → open file → previous diagnostics appear immediately without waiting for Gradle.

#### D3 — TE2-provided repo/dirty fingerprints (LSP consumes)
**Policy:** TE2 computes “repo state / dirty state” fingerprints and sends them to the LSP; the LSP decides whether to compile and what to publish.

Mechanism options (pick one; recommended is A):
- **A (recommended):** `workspace/didChangeConfiguration` with `settings.te2Android = { repoFingerprint, dirtyFiles, updatedAt }`
- B: custom notification (e.g. `"te2/androidState"`) routed to a custom handler in the LSP

Acceptance:
- When TE2 says fingerprint unchanged: LSP replays cached diagnostics.
- When TE2 says fingerprint changed (or dirty→clean transition on save): LSP compiles and updates cache.

#### D4 — Change compile triggers (driven by TE2 state)
Modify Android Kotlin LSP diagnostics service policy:
- `didChange`: never triggers Gradle; TE2 may send updated dirty state separately.
- `didSave`: TE2 sends updated fingerprints; LSP compiles if needed → publish.
- `didOpen`: optional compile-on-open only if no cache exists yet

Acceptance:
- Typing does not start Gradle.
- Saving starts Gradle only when needed.

#### D5 — (Optional in sprint) Manual refresh action
Add a custom request/notification to force rebuild even if fingerprint says “unchanged”.
- Could be a custom LSP notification name like `"android/forceRebuild"`.

Acceptance:
- TE2 can trigger a rebuild from UI later without hacks.

#### D6 — Debug REST endpoint (`history_store` raw)
Add a REST endpoint intended for debugging/inspection that returns the **raw** HistoryStore state (similar spirit to `/preferences`).
- Route: `GET /history/raw`
- Payload: raw `_history_store` JSON (best viewed via `curl ... | jq`).
- Note: `/preferences` already exists; this endpoint is the companion for history.

Acceptance:
- You can quickly inspect current history state (active project, recents, session telemetry) via one endpoint.

#### D7 — Draft cache hygiene (prune clean entries)
We need a way to prevent the per-project `session_cache` from accumulating “clean” entries forever.
- Add a helper like `ProjectSidecar.prune_session_cache()` that removes entries where `unsaved == false` (optionally with an age threshold).
- Trigger points:
  - on project open (after sidecar load)
  - optionally after successful save / explicit "discard" actions

Acceptance:
- After switching projects/opening the app, the sidecar retains only meaningful unsaved drafts and does not grow unbounded.

---

## 3) Broader Outlook (next sprints)

### Sprint 2 — Shadow workspace v1 (unsaved diagnostics without lying)
- Implement a shadow copy workspace and point Gradle at it.
- Remap diagnostics paths back to real workspace (parser already supports shadowRoot/realRoot concept).

### Sprint 3 — Draft-mode heuristics (only if still needed)
- If shadow workspace is too slow/heavy, add conservative heuristics:
  - Only invalidate certain cached error kinds when draft content clearly fixes them
  - Avoid new false positives; “don’t lie” > “be chatty”

### Sprint 4 — Multi-module + generated sources strategy
- Make module/variant discovery robust and persist per-project config.
- Decide how to treat generated sources and `R`/ViewBinding types.

---

## 4) Repo Hygiene / Cleanup

### Candidate removal
- `app/static/vendor/ignored/kotlin-language-server/` appears unused by runtime.
- Before deletion:
  - confirm no references (grep already suggests none)
  - confirm we have a build/update path for the distro (`android-kotlin-lsp`) going forward

---

## 5) Open Questions (need your call)

1. **Where does the Android Kotlin LSP source live going forward?**
   - Option A: keep source outside TE2 repo; TE2 only vendors the built distro
   - Option B: add a tracked source mirror/submodule in-repo + a script to rebuild/install into `app/static/vendor/lsp_servers/android-kotlin-lsp/`

2. **How should TE2 send repo/dirty fingerprints to the LSP?**
   - Option A (recommended): `workspace/didChangeConfiguration` with `settings.te2Android = {...}`
   - Option B: custom notification method (e.g. `te2/androidState`)

3. **Provenance encoding:**
   - `diagnostic.code` vs `diagnostic.source` vs message prefix
   - (I recommend `code` for provenance, keep `source` as compiler)
