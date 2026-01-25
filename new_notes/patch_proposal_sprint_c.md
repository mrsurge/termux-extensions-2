# Patch Proposal — Sprint C (Explorer Diagnostic Hints)

**Date:** 2025-12-25T23:36:31.972Z

## Goal
Add lightweight **Explorer UI hints** showing which files/directories currently have LSP diagnostics:

- Files: red (errors) / yellow (warnings) indicator.
- Directories: inherit from descendants, so collapsed folders still show an indicator.

This is a UI-only affordance; it does **not** change the underlying diagnostics pipeline.

---

## Research notes (current code reality)

### Explorer transport
- Frontend uses Socket.IO namespace: `io('/explorer', ...)` in `app/apps/file_editor_cm6/main.js`.
- Backend emits events as `explorer:event` (JSON string), dispatched to `handleExplorerEvent(type, payload)` in `app/apps/file_editor_cm6/static/js/explorer.js`.

### Existing “overlay flag” patterns
Explorer already has two “patch the DOM without re-rendering the tree” events:
- `explorer:updateGitStatus` — updates git classes and aggregated `fe-dir-has-*` flags.
- `explorer:updateDecorations` — updates draft flags and computes ancestor directories via rel-path string splitting.

Sprint C should follow the same approach with `explorer:updateDiagnostics`.

### Diagnostics source
`app/apps/file_editor_cm6/lsp_ws.py` already sees all backend `textDocument/publishDiagnostics` notifications and now caches them per URI in `diagnostics_by_uri` (per (language_id, project_root) session).

---

## Proposed patches (Sprint C)

### 1) Backend: expose diagnostics summary from `lsp_ws.py`
Add a narrow helper in `app/apps/file_editor_cm6/lsp_ws.py`:

- `get_diagnostics_summary_for_project(*, project_root: str) -> dict[str, dict]`

Return structure (project-relative paths):
```json
{
  "app/src/main/java/.../Foo.kt": {"errors": 1, "warnings": 0},
  "android/app/src/...": {"errors": 0, "warnings": 2}
}
```

Implementation sketch:
- Iterate over active backend sessions where `session["project_root"] == project_root`.
- For each `diagnostics_by_uri[uri]` list:
  - convert `file://` URI → absolute path → `rel` via existing `abs_to_rel()` logic (currently in `explorer_ws.py`; consider moving to a tiny shared helper to avoid duplication).
  - count severities:
    - LSP severity 1 = error
    - LSP severity 2 = warning
  - aggregate by rel (merge across language servers; error dominates warning in UI).
- Debounce by hashing the summary (avoid broadcasting unchanged maps).

### 2) Backend: broadcast explorer diagnostics (debounced)
In `app/apps/file_editor_cm6/explorer_ws.py` `ConnectionManager`:

- Add a new background task similar to `_lsp_status_loop()`, e.g. `_diagnostics_loop()`.
- Periodically (e.g. 1s) compute the current project’s summary and broadcast:

Event:
- `type: "explorer:updateDiagnostics"`

Payload:
```json
{
  "diagnostics": {
    "rel/path.kt": {"errors": 1, "warnings": 0},
    "rel/other.kt": {"errors": 0, "warnings": 2}
  }
}
```

This keeps `/explorer` as the SSOT for explorer UI updates (no frontend polling).

### 3) Frontend: handle `explorer:updateDiagnostics`
In `app/apps/file_editor_cm6/static/js/explorer.js`:

- Add a new case in `handleExplorerEvent()`:
  - Clear existing diagnostic classes from all `li.fe-tree-node`.
  - For each `rel` in payload:
    - mark file node with `fe-diag-error` or `fe-diag-warning`.
  - Compute ancestor directories from diagnostic rel paths (same technique as drafts):
    - add `fe-dir-has-diag-error` / `fe-dir-has-diag-warning` to parents.
  - Mark root as having diagnostics if any exist.

**Volume policy:**
- This is a compact indicator only; no counts are displayed in Sprint C.

### 4) CSS: add dot indicators without conflicting with existing pseudo-elements
`explorer.css` already uses:
- `::before` for active-file underline
- `::after` for draft bars

So prefer **background-image** (radial gradient) or an absolutely-positioned small element (not another pseudo-element).

Add to `app/apps/file_editor_cm6/static/js/explorer.css`:
- `.fe-tree-node.fe-diag-error { background-image: radial-gradient(circle, #ef4444 60%, transparent 62%); ... }`
- `.fe-tree-node.fe-diag-warning:not(.fe-diag-error) { ... #facc15 ... }`
- matching directory classes:
  - `.fe-tree-node.fe-dir-has-diag-error` / `.fe-dir-has-diag-warning`

Recommended positioning to avoid overlapping the ⋮ menu button:
- `background-position: calc(100% - 26px) 50%;`
- `background-size: 6px 6px; background-repeat: no-repeat;`

Errors should visually override warnings.

---

## Acceptance criteria (Sprint C)
- When LSP publishes diagnostics for a file, the explorer entry shows a red/yellow hint.
- Parent directories reflect descendant diagnostics even when collapsed.
- No noticeable UI thrash: updates are debounced and unchanged maps are not broadcast.
- No change to Issues/squiggles behavior; this is additive UI chrome.

---

# Sprint C (Android LSP Plan) — Arbitration + Suppression Rules

This section matches **Sprint C** from `android_lsp_dependency_cache_plan.md` ("Merging & Arbitration").

## Goal
When drafts exist (unsaved edits), reduce "ghost errors" by merging authoritative/cached diagnostics with conservative draft diagnostics.

Inputs (per plan):
- `gradleDiagnosticsFresh` (authoritative, if we can detect it)
- `cachedDiagnostics` (last-known from Kotlin LSP cache / last publish)
- `draftDiagnostics` (TE2 heuristics)

## Current reality (as of Sprint B)
- TE2 can publish draft diagnostics via `lsp_ws.publish_draft_diagnostics_to_client(...)`.
- CM6 overwrites diagnostics per-URI, so we already merge draft diags with the last backend diags.
- We do **not** yet implement targeted suppression of stale unresolved errors when drafts likely fix them.

## Proposed patches (Android Sprint C)

### C1) New module: `app/apps/file_editor_cm6/android_lang/diagnostic_arbitration.py`
**Purpose:** implement a pure function that merges backend + draft diagnostics safely.

**API (proposed):**
- `merge_android_diagnostics(*, backend: list[dict], draft: list[dict], has_drafts: bool) -> list[dict]`

**Rules (v1, conservative):**
1) If `has_drafts` is false → return `backend` (plus any non-empty `draft` if we keep always-on hints).
2) If `has_drafts` is true:
   - Keep all non-"unresolved" backend warnings/errors.
   - Suppress only a narrow set of backend "ghost" diagnostics that are very likely to change with unsaved edits, e.g.:
     - messages containing `Unresolved reference` / `Unresolved reference:`
     - (optionally) messages containing `Unresolved import`
   - Never suppress diagnostics when the draft diagnostics indicate an environment problem (SDK/JDK missing), since those are not fixable by editing.

**Provenance tagging:**
- Ensure TE2 draft diagnostics keep `source="te2-android:draft"`.
- Leave backend diagnostics as-is (typically `source="kotlin-android"`), or (optional) tag them as `source="kotlin-android"` if missing.

### C2) Update `lsp_ws.publish_draft_diagnostics_to_client(...)` to use arbitration
Replace the current concatenation with a call to `merge_android_diagnostics(...)`.

This keeps `lsp_ws.py` as the SSOT for publishing behavior while keeping merge logic testable.

### C3) Draft detection signal (per URI)
We need a stable "has drafts" signal for the current file:
- Use `ProjectSidecar.list_project_drafts()` (project-root scope) and check whether the current file path is present.

### C4) Optional: add a subtle "staleness" hint
If drafts exist and we are showing backend diagnostics, add a single INFO/HINT diagnostic like:
- `message: Based on last Gradle compile (file has unsaved changes)`
- `source: te2-android:cached`

(Keep this optional; can be noisy if overused.)

## Acceptance criteria (Android Sprint C)
- With unsaved edits, the editor no longer shows large volumes of stale `Unresolved reference` errors that disappear on save/compile.
- Suppression is conservative and targeted (only known ghost categories).
- No regressions in authoritative Gradle diagnostics after save/compile.
