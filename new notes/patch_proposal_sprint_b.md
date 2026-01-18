# Patch Proposal — Sprint B (Draft Heuristic Diagnostics + Provenance)

**Date:** 2025-12-25T23:09:20Z

## Goal
Implement Sprint B items from `android_lsp_dependency_cache_plan.md`:

- Add **2** conservative draft-mode heuristics (start minimal).
- Emit them as standard LSP notifications: `textDocument/publishDiagnostics`.
- Tag every diagnostic with provenance (`draft` vs future `cached`/`gradle`).

This sprint should be **low-risk and additive**: do not interfere with the authoritative Gradle-backed kotlin-android LSP, and avoid false-positive spam.

---

## Current repo status (baseline)
Sprint A already provides the inputs Sprint B needs:

- `te2_android_sidecar.json` persisted under `${cacheRoot}/${lspProjectId}/` with minimal `dependencyModel` facts.
- `repoFingerprint`, `draftFingerprint` (empty when no drafts), and `syncFingerprint`.
- Save-hook wiring in `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` that updates the sidecar in the background.

---

## Design choice (Sprint B): publish via lsp_ws SSOT
We should publish draft diagnostics to the editor using the same UI pipeline as LSP diagnostics, but without reaching into `LSPSocketIONamespace` internals from new modules.

**Decision:** add a narrow helper in `app/apps/file_editor_cm6/lsp_ws.py` (SSOT) such as:

- `publish_draft_diagnostics_to_client(*, language_id: str, project_root: Path, uri: str, draft_diagnostics: list[dict]) -> bool`

Implementation emits a normal LSP notification payload to the currently attached sid, **merging** with the last backend diagnostics for that URI so we don’t clobber Gradle-backed results:

```json
{ "jsonrpc": "2.0", "method": "textDocument/publishDiagnostics", "params": { "uri": "...", "diagnostics": [...] } }
```

---

## Proposed patches (Sprint B)

### 1) New module: `app/apps/file_editor_cm6/android_lang/draft_diagnostics.py`
**Purpose:** Produce a tiny set of high-confidence diagnostics based on the Sprint A dependency model.

**API (proposed):**
- `build_draft_diagnostics(*, te2_sidecar: dict, uri: str) -> list[dict]`

**Heuristics (v1, minimal + conservative):**
1) **Android SDK missing**
   - If `dependencyModel.androidSdk.androidJar` missing/empty → emit **one** diagnostic.
2) **JDK missing**
   - If `dependencyModel.jvm.javaHome` missing/empty → emit **one** diagnostic.

> Note: omit `R symbols missing` in Sprint B to avoid false positives before first successful build.

**Severity:**
- Use WARNING (`severity = 2`) for all heuristics.

**Placement policy:**
- Emit at `(line=0, character=0)` with a 0-length range (or small first-line range) to avoid parsing.

**Provenance tagging:**
- `diagnostic.source = "te2-android:draft"`
- `diagnostic.code` stable identifiers (e.g. `ANDROID_SDK_MISSING`, `JDK_MISSING`)

### 2) New helper (SSOT): `lsp_ws.py` publisher
Add:
- `publish_diagnostics_to_client(...)` as described above.

This keeps sid/session lookup and Socket.IO emission centralized.

### 3) Trigger point (Sprint B minimal)
Start with **after-save only** to avoid spamming hot paths.

- Trigger from the existing iframe save path (`/save`) after a successful disk write (and after Sprint A sidecar update is scheduled or completed).

**Throttle:**
- Fingerprint-throttle per URI:
  - keep a small in-memory map keyed by `(project_root, uri)` to last published `draftFingerprint`.
  - only republish if it changed.

### 4) Sidecar read path
Draft diagnostics should use TE2’s sidecar:
- `${cacheRoot}/${lspProjectId}/te2_android_sidecar.json`

---

## Acceptance criteria (Sprint B)
- With kotlin-android LSP enabled, saving a Kotlin file results in **at most 2** draft diagnostics being published (when relevant).
- Diagnostics are provenance-tagged:
  - `source == "te2-android:draft"`
- Draft diagnostics are WARNING-level and do not spam across repeated saves when nothing meaningful changed (per-URI fingerprint throttle works).

---

## Explicitly out of scope (still deferred)
- Any merge/arbitration between Gradle diagnostics vs cached vs draft (Sprint C).
- Any “sync with Gradle files” UI action (Sprint D).
- R-symbol heuristics unless gated on evidence of prior compile (`lastGradleCompile.finishedAtMs > 0`).
- Jar scanning / dependency graph extraction beyond the minimal v1 facts.
