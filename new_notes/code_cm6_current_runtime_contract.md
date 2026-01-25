# Code CM6 (NiceGUI iframe) — Current Runtime Contract (SSOT + Multicast + Delta Mirroring)

This document is an “as‑built” snapshot of the **current** `file_editor_cm6` architecture and the specific mechanisms that are in place right now (as of the recent work session).

It is written to survive context loss: it records **what exists**, **why**, and **where it lives** (paths + key behaviors).

---

## 0) Core Invariants (SSOT Contract)

1. **Single project** at a time (SSOT): all connected clients are viewing the same active project.
2. **Single document** at a time (SSOT): all connected clients are viewing the same open file.
3. **Multi‑client fanout is always expected**:
   - there is no concept of “client A has file X while client B has file Y”.
   - therefore almost every state mutation should broadcast to all connected clients.
4. **Self‑echo avoidance is mandatory**:
   - do not re-apply an author’s own change back onto the author in a destructive way (cursor/selection churn).
5. **Drafts are SSOT; derived indexes must never become SSOT**:
   - ProjectSidecar `session_cache` is authoritative.
   - Any “draft index” is a derived cache artifact.

---

## 1) The Problem We Solved (recap)

### 1.1 “NiceGUI preferred client” illusion
Symptom:
- Only the “last connected” client seemed to receive live UI updates (preferences, diffs, etc.).

Actual cause:
- Code paths were updating **one** CodeMirror element instance (`get_active_editor()` / global `editor`) instead of updating all connected editor instances.
  - So the most recently registered editor (“last connected”) got updates, others did not.

Fix principle:
- Treat per-client CodeMirror element instances as **private**, and **multicast** state updates to all active editors.

---

## 2) Major Components & Where They Live

### 2.1 NiceGUI iframe backend (“editor runtime”)
Path:
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

Responsibility:
- Create per-client `ui.codemirror` editors.
- Maintain a registry of active editor element instances for broadcasting.
- Host SSOT-driven operations that must apply to CodeMirror instances:
  - diff decoration updates
  - preference live application
  - delta mirroring multicast
  - save/autosave signaling

### 2.2 Vendored NiceGUI CodeMirror JS (“the giant codemirror.js”)
Path:
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

Responsibility:
- The actual CodeMirror 6 EditorView and all heavy client-side behavior:
  - diff decorations rendering
  - minimap behavior
  - sticky scroll behavior
  - LSP integration & telemetry
  - postMessage bridging to the host shell (`cm6-cache-state`, etc.)
  - **incremental delta emission** (`cm_delta`) and **delta apply** (`applyDelta`)

### 2.3 Host shell (non-iframe UI)
Path:
- `app/apps/file_editor_cm6/main.js`

Responsibility:
- Owns the “outer” editor app UI (toolbars, menus, drawers, explorer integration).
- Bridges events between:
  - explorer Socket.IO UI bus
  - NiceGUI iframe postMessage events
  - host-side menu state & SSOT preference calls
- Holds client identity used for self-echo filtering:
  - `cm6NiceguiClientId` captured from iframe (`cm6_client_id` postMessage).

### 2.4 Explorer UI + bus event routing
Path:
- `app/apps/file_editor_cm6/static/js/explorer.js`

Responsibility:
- Receives events from explorer Socket.IO bus and dispatches into the host runtime.
- Key patterns:
  - “draft:content” and “autosave:content” apply paths
  - “editor:prefs_changed” apply path

### 2.5 Draft SSOT persistence (per-project sidecar)
Path:
- `app/apps/file_editor_cm6/project_sidecar.py`

Responsibility:
- Project-scoped SSOT for:
  - `session_cache` drafts (per-file cached draft content + metadata)
  - open directories, last file, diff base, etc.

### 2.6 Draft derived index (fast explorer hints)
Path:
- `app/apps/file_editor_cm6/draft_index_sidecar.py`

Responsibility:
- Disk-backed derived cache artifact:
  - fast “hasDraft” checks for files/dirs in explorer
  - must not become stale / “second SSOT”

### 2.7 HistoryStore facade
Path:
- `app/apps/file_editor_cm6/history_store.py`

Responsibility:
- Provides SSOT facade and convenience APIs:
  - upsert/clear cached documents (drafts)
  - list cached documents, prune clean drafts, etc.

### 2.8 Explorer listing / git / draft flags
Path:
- `app/apps/file_editor_cm6/explorer_helper.py`

Responsibility:
- Implements explorer `list_dir` and merges:
  - git status flags
  - “hasDraft” flags (from DraftIndexSidecar snapshot)

---

## 3) Drafts: What Is SSOT vs What Is Derived

### 3.1 SSOT: ProjectSidecar.session_cache
Path:
- `app/apps/file_editor_cm6/project_sidecar.py`

Key SSOT fields for each cached entry (conceptual):
- `file_path` (absolute)
- `content` (full draft text)
- `base_sha256` (disk sha at time of draft baseline)
- `content_sha256` (hash of `content`)
- `unsaved` (bool; `content_sha256 != base_sha256`)
- runtime metadata: run_id, shell ids, etc.

Correctness rule:
- When a file is saved or drafts are explicitly discarded, the SSOT `session_cache` must be cleared / updated so `unsaved` becomes false or entry removed.

### 3.2 Derived cache artifact: DraftIndexSidecar
Path:
- `app/apps/file_editor_cm6/draft_index_sidecar.py`

What it stores:
- `draft_files`: set of relpaths with `unsaved == True`
- also supports producing `draft_dirs` by expanding ancestors of relpaths

Why it exists:
- Explorer `list_dir` must be fast.
- Parsing full draft contents from ProjectSidecar for every directory listing is expensive.

### 3.3 Hardening change: DraftIndexSidecar now rebuilds from SSOT
Motivation:
- We discovered “draft stuck on” can happen when some code path bypasses HistoryStore methods that update the index.
- Therefore, the index cannot be authoritative.

Current implementation behavior:
- `DraftIndexSidecar.reload()`:
  1) loads the small index file (fast),
  2) checks the current ProjectSidecar JSON file `mtime_ns`,
  3) if the SSOT sidecar mtime differs from the stored `source_sidecar_mtime_ns`, it rebuilds:
     - reads ProjectSidecar JSON
     - scans `session_cache` entries
     - includes only entries where `unsaved == True`
     - recomputes relpaths relative to project root
     - saves the index (best-effort)
- This makes “stale draft flags” self-heal on the next `reload()` call.

---

## 4) Live Draft Propagation vs Autosave Propagation

### 4.1 Draft mode (“drafts on”)
Pipeline:
1) Author edits in iframe CodeMirror.
2) Backend persists draft sidecar state (debounced) in `editor_app.py` via `HistoryStore.upsert_cached_document(...)`.
3) Backend can broadcast `draft:content` payload over explorer bus to other host shells.
4) Host shells apply the draft content to their iframes in a non-destructive way, with self-echo filtering using `source_client`.

### 4.2 Autosave mode (“drafts off”)
Pipeline:
1) Author edits in iframe CodeMirror.
2) Autosave loop writes to disk (server-side), and we avoid writing session_cache drafts.
3) We broadcast `autosave:content` over explorer bus to other host shells, so viewers update.
4) Host shells apply autosave content to their iframes, mark `unsaved=false`.

Critical rule:
- Parent window menu/state must be synchronized, so passive clients don’t interpret autosave-mode updates as drafts.

---

## 5) Preferences: SSOT Change + Multicast

### 5.1 Original problem
Turning autosave ON propagated quickly due to a special-case broadcast path, but turning it OFF (or other prefs) could appear delayed/stale across clients.

### 5.2 Current fix: explicit prefs broadcast event
Event:
- explorer bus event `editor:prefs_changed`

Payload:
- `{ project_path, key, value, view_state, source_client }`

Behavior:
- Backend emits `editor:prefs_changed` from `editor_app.py` after persistence.
- `explorer.js` routes it to host runtime.
- `main.js` applies it immediately:
  - updates `editorViewState`
  - calls `applyStateToMenus(view_state)`
  - ignores self using `source_client === cm6NiceguiClientId`

### 5.3 Critical addition: “multicast preference setters” inside NiceGUI runtime
Even after host shells show updated menu checkmarks, the iframe CodeMirror instances must update too.

Therefore:
- `update_preference` must apply live setters to **all** editor instances, not only one.
- This is the same principle as “no preferred client”.

---

## 6) Diff Decorations: Why They Got Stale & How We Fixed It

Symptom:
- After “Save”, draft diff decorations sometimes remained visible (stale) even though drafts were cleared.

Cause:
- The “save-time diff refresh” path was updating only one editor’s decorations:
  - `editor.set_diff_decorations(hunks)` instead of looping all editors.

Fix:
- Apply diff refresh to all active editors after save:
  - `for ed in get_active_editors(): ed.set_diff_decorations(hunks)`

This matters even on a single device because there can be multiple connected clients (e.g., desktop + mobile) watching the same SSOT.

---

## 7) Live Mirroring: Full-Text vs Incremental Deltas

### 7.1 Why full-text mirroring was “quirky”
Full-text mirroring (`setEditorValue`) replaces the entire document, which:
- risks cursor/selection churn
- causes “snap” behavior
- can surface “draft diff stale” if decorations aren’t refreshed everywhere

### 7.2 Incremental delta mirroring (current headline feature)
Goal:
- Apply viewer updates as true CM6 transactions (ChangeSet), not full document replaces.

Current implementation:

#### 7.2.a Emit deltas from CodeMirror (author client)
Path:
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

Mechanism:
- In a CM ViewPlugin update handler:
  - on `update.docChanged`:
    - compute `changes = update.changes.toJSON()`
    - increment `rev`
    - emit `cm_delta` as a NiceGUI component event:
      - `self.$emit('cm_delta', { rev, changes })`
  - Echo guard:
    - skip if `this._applyingRemoteDelta` is true

#### 7.2.b Multicast deltas in Python to other clients
Path:
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

Mechanism:
- Attach handler: `editor.on("cm_delta", handler)`
- On delta:
  - derive `source_client` from NiceGUI `context.client.id`
  - multicast to other editors in `_active_editors`:
    - `ed.run_method("applyDelta", payload)`
  - include `source_client` in payload for self-echo suppression in JS.

#### 7.2.c Apply deltas on mirrors (viewer clients)
Path:
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

Mechanism:
- `applyDelta(payload)`:
  - ignore if `payload.source_client === localClient`
  - use `CM.ChangeSet.fromJSON(payload.changes)`
  - dispatch `{ changes: changeSet }`
  - temporarily disable `emitting` and set `_applyingRemoteDelta` to avoid echo loops

### 7.3 Coexistence with old full-text mirroring
We maintain backward compatibility:
- full-text mirroring exists (setEditorValue)
- once the incremental delta stream begins, we prefer deltas for stability

---

## 8) Watcher / Explorer Tax: Clarification

We previously misattributed explorer `[list_dir]` “tax” to draft scanning.

The real cost source (root issue):
- Watcher silently falling back to polling when inotify hit its limit.

Current policy direction:
- No silent fallback to polling; if watchdog/inotify fails, error out or disable watcher-dependent features.

Relevant watcher code lives in:
- `app/apps/file_editor_cm6/core_read.py`

---

## 9) Self-Echo / Feedback Loop Guardrails (must-haves)

1) **`source_client` field** for cross-client events.
2) **Authoring client should not get destructive apply**:
   - full-text apply avoided for author
   - delta apply ignores self
3) **Mirror clients should not re-emit**:
   - `emitting=false` during `applyDelta`
   - `_applyingRemoteDelta` guard

---

## 10) Operational Notes / Debugging

### 10.1 When you see “stale UI”
First question:
- Is the SSOT wrong, or is the UI just stale?

If SSOT is right:
- check whether the UI action was applied to **all** clients (multicast loops)
- check whether decorations were refreshed across all editors

### 10.2 The “last connected wins” smell test
Any code that:
- uses `get_active_editor()` and mutates UI,
- without looping `get_active_editors()`,
is a candidate for the same “preferred client” bug.

---

## 11) Current State Summary (high level)

What is now in place:
- Single-project, single-document SSOT enforced by HistoryStore/PreferencesStore.
- Multicast preference application (no “preferred client”).
- Explicit preference broadcast event (`editor:prefs_changed`) so host shells converge immediately.
- Diff decoration refresh is multicast on save so drafts clear visually everywhere.
- Draft index is a derived cache that rebuilds itself from ProjectSidecar SSOT to avoid “stuck” flags.
- Incremental delta mirroring (ChangeSet) provides extremely smooth cross-client mirroring without full document replacements.

