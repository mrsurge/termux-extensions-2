# Project Session Management — Phase 4+ Plan (Editor Sync & Recents)

**Date:** 2025-12-02  
**Context:** Code CM6 (file_editor_cm6)  
**Status:** Planning (no implementation in this file)

This document refines the remaining phases after the initial `ProjectSidecar` rollout, with a focus on keeping the NiceGUI editor iframe (`editor_app.py`) synchronized with project state and gradually migrating per-project MRU data.

---

## Recap: What’s Already Landed

Short version of completed work (see `tmp22.md` and `tmp23.md` for details):

1. **ProjectSidecar** (`project_sidecar.py`)
   - Per-project JSON sidecar: drafts (`session_cache`), `diff_base`, `tracked_jobs`, and telemetry (`session_count`, `last_boot_at`).
2. **Boot Lifecycle**
   - `initialize_project_session()` bumps `session_count` on worker start; no longer clears any state.
3. **Session Cache Migration**
   - `HistoryStore` now delegates draft persistence to `ProjectSidecar`.
4. **Diff Base Migration**
   - Diff base is stored in sidecars and mirrored into `history_store.json`.
5. **Explorer Project Switch Gatekeeper**
   - `reset_project_session()` (in `explorer_ws.py`) clears drafts + tracked jobs + diff base on explicit project switches (open/create/clone).
6. **Debug Tooling**
   - `/debug/projects` APIs + File menu modal show recent projects and their sidecars, with a debug-only “delete entry + sidecar” action.

The next steps tighten editor synchronization and finish the MRU/diff base migration story.

---

## Phase 4 — Per-Project Recents & Last-File Semantics

### 4.1. Clarify Source of Truth for “Last Opened File”

**Goal:** Make it explicit where “last opened file” for a project lives, and keep `editor_app.py` and the host (`main.js` + explorer) aligned.

Planned approach:

- Keep `HistoryStore.projects[project]["last_file"]` as the primary SSOT for now:
  - Used by `/state` and `editor_app` on cold start.
  - Updated via existing `record_file_activity` flows.
- Optionally mirror `last_file` into `ProjectSidecar.recent_files` in a later sub-phase, but do not change behavior until that win is clear.

Deliverables:

- Audit all `record_file_activity`, `set_last_file`, `get_last_file`, and `/history/files` usages.
- Document explicitly (in code comments) that:
  - `HistoryStore` drives the “last file” UX.
  - `ProjectSidecar` may eventually mirror MRU for faster per-project analytics/debugging, but is not yet the SSOT.

### 4.2. Define “Null Document” / Blank Buffer Semantics

**Problem:** When a project is opened and no real file has been opened yet (or last_file is missing), the iframe still needs a clean, well-defined editor state.

Plan:

- Define a **virtual null document** concept for the editor:
  - Not a real file path on disk.
  - Not stored in MRU or recent files lists.
  - Only used inside `editor_app.py` to produce a “blank document” state.
- Storage:
  - The presence of a null document does **not** need to be persisted as a path.
  - Logic can be:
    - If `last_file` is missing or invalid, the editor treats this as “open blank buffer”.

Deliverables:

- Add a clear code-level comment in `editor_app.py` describing the null document behavior.
- Ensure watchers, git diff, and session cache do **not** attempt to attach to the null document:
  - No watcher subscription.
  - No session sidecar writes for null.
  - No MRU updates.

### 4.3. Host ↔ Editor Sync on Project Switch

**Goal:** When a project changes, the iframe should consistently show the right document for that project.

High-level behavior:

1. **Explorer triggers switch**:
   - `reset_project_session(new_project_path)` clears per-project drafts/tracked jobs/diff base.
   - `explorer_ws` broadcasts `project:opened` with `{path}`.
2. **Host (`main.js`) reacts**:
   - On `project:opened`, after refreshing explorer + git, call a new helper:
     - e.g. `syncEditorToProject()` or `openProjectBootFile()`.
   - That helper:
     - Fetches `/state` (or a new lightweight `/state/project` endpoint) to get:
       - `activeProject`
       - `lastFile` (+ existence info)
     - Decides what to open:
       - If `lastFile` exists and is inside `activeProject` → open that file.
       - Else → instruct editor to open a blank/null document.
3. **Editor (`editor_app.py`) responds**:
   - Expose a small, explicit API for the host:
     - e.g. `POST /editor/open_boot_file` with `{ "path": "/abs/file" }` or `{ "path": null }`.
   - Implementation:
     - If `path` is a real file:
       - Use existing logic to load from disk or draft sidecar.
       - Ensure `record_file_activity`/`last_file` remains in sync.
     - If `path` is null/omitted:
       - Initialize a blank buffer (null document).
       - No MRU update, no watcher, no session cache.

Constraints:

- Project switches must remain idempotent:
  - Receiving `project:opened` twice for the same path should not corrupt MRU or sidecar state.
- Project switch must not clear drafts in **other** projects; only the active project’s sidecar is touched.

Deliverables:

- New host-side helper in `main.js` that reacts to `project:opened` and calls the proper editor endpoint.
- New endpoint in `editor_app.py` (or reuse of a safe existing “open file” endpoint) to enact the requested boot file.
- Comments tying this behavior back to the sidecar clearing in `reset_project_session`.

---

## Phase 5 — Manual “Clear Project State” UI

(Already sketched in `tmp22.md`, reiterated here for completeness.)

### 5.1. Backend

- Implement a `clear_project_state` helper (likely in `project_sidecar.py` or a thin wrapper in `main.py`):
  - Deletes the project’s sidecar file entirely.
  - Optionally wipes project-specific entries in `HistoryStore` (MRU, diff base) if we want a full reset.

### 5.2. UI

- Add a menu item (most likely under **Edit** or **File**) called “Clear Project State…”.
- Modal:
  - Lists exactly what will be discarded:
    - Unsaved drafts
    - Diff base setting
    - Recent files list
    - Tracked jobs
  - Clearly states that the actual project directory is not touched.
- On confirm:
  - Calls the backend `clear_project_state` endpoint.
  - Triggers:
    - Explorer refresh (to remove draft badges).
    - Editor sync to null document / safe default.

---

## Phase 6 — Optional: MRU in Sidecar & Deeper Analytics

This is more speculative and can be postponed until core behavior is stable.

Ideas:

- Move per-project MRU from `HistoryStore.projects[project].files` into `ProjectSidecar.recent_files` and keep `HistoryStore` as a lightweight index:
  - `recent_projects` stays in `HistoryStore`.
  - Actual MRU for each project lives in the sidecar for that project.
- Build additional debug views off sidecars:
  - Per-project draft lists.
  - Per-project job history.
  - “Stale sidecar” detection when `session_count` grows unexpectedly without recent activity.

---

## Ordering / Priority Notes

- The next **high-value** user-facing step is **Phase 4.3**:
  - Wiring `project:opened` → host → `editor_app` so the iframe always lands on a sensible document (last real file or blank) after project switches.
  - This makes the app feel coherent and avoids “wrong-file-open” confusion when switching projects.
- Phase 4.2 (null document semantics) is a prerequisite for 4.3.
- MRU migration (Phase 6) can wait until the core behavior feels rock solid.

Implementation should follow this order:

1. Document and enforce null document behavior in `editor_app.py` (Phase 4.2).
2. Wire project-open synchronization between explorer and editor (Phase 4.3).
3. Add the manual “Clear Project State” UI (Phase 5).
4. Revisit MRU migration to sidecars (Phase 6) once everything is stable. 

