# Project Session Management — Finalization Plan (Phase 4–6)

**Date:** 2025-12-02  
**Context:** Code CM6 (`file_editor_cm6`)  
**Goal:** Finish migrating all per-project state into sidecars and tidy the UI/behavior around project state, drafts, and MRU.

This plan assumes everything described in `tmp22.md`, `tmp23.md`, and `tmp24.md` is in place and working (per-project sidecars, project switch gatekeeping, debug modal, editor sync, null document semantics).

---

## Guiding Principles

1. **One SSOT per project.**  
   For each project path, there should be a single, obvious source of truth for:
   - Drafts
   - MRU / recent files + `last_file`
   - Diff base
   - Tracked jobs

2. **Minimal magic in HistoryStore.**  
   `HistoryStore` remains the global ledger of:
   - Active project
   - Recent projects list (project picker)
   But all *per-project* detail should come from the sidecar.

3. **Explorer + Editor stay in lockstep.**  
   - Project switches and state resets must always pass through the same well-defined paths.
   - The iframe editor (`editor_app.py`) and host (`main.js`) must always derive state from the same project/sidecar view.

4. **Debug modal becomes a formal “Project Manager”.**  
   - It’s no longer “debug-only”; it’s the unified entry point for:
     - Seeing all known projects.
     - Quickly switching projects.
     - Resetting the current project’s state.
   - The word “debug” can disappear from the UI, but sidecar paths remain visible for observability.

---

## Phase 4 — Clean Up “Clear State” Semantics and Review UI

### 4.1. Formalize the “Projects & Sidecars” Modal as “Projects” Manager

**Goal:** Make the existing modal feel intentional and user-facing, while still exposing sidecar tech details for power users.

Steps:

1. **Rename labels in the UI (no behavior change):**
   - Button text:
     - `Debug: Projects & Sidecars…` → `Projects…` (or `Manage Projects…`).
   - Modal title:
     - `Recent Projects & Sidecars (Debug)` → `Projects`.
   - Row contents:
     - Keep `Sidecar: <path> (...)` line, but you may soften the wording:
       - e.g., `State file: <path> (exists, session_count=..., last_boot_at=...)`.

2. **Keep behavior identical:**
   - Active project:
     - Highlighted row.
     - Trash = soft reset (history + drafts + diff base).
     - No row click; you’re already in that project.
   - Other projects:
     - Row click = open via `project:open`.
     - Trash = hard delete from history + sidecar removal.

3. **Documentation:**
   - Add a short block to `TECHNICAL.md` under “Session Cache” / “Projects” explaining:
     - The Projects modal is the primary way to inspect and manage known projects.
     - Sidecar path is shown for inspection; deleting or resetting a project affects that file.

### 4.2. Review Overlay: “Check All” and Nuke Drafts

**Goal:** Give users a clean way to bulk discard drafts via the existing Review overlay, rather than relying on the Projects modal for day-to-day draft cleanup.

Steps:

1. **UI changes in `explorer.js` (Review tab):**
   - Add a “Select All” or “Check All” control to the Review tab:
     - When clicked, it selects all draft entries in the review list.
   - Ensure it’s easy to unselect (e.g., toggles or a separate “Clear Selection”).

2. **Backend is already ready:**
   - `/review/discard` supports a list of `files` (relative paths).
   - It calls `discard_reviews(project_root, files)` which:
     - Calls `_history_store.clear_cached_document(...)` per file.
     - Calls `handle_external_discard` to reset active editor content if needed.

3. **Behavior:**
   - User goes to Review tab.
   - Clicks “Check All”.
   - Clicks “Discard”:
     - All draft entries for that project are cleared (file-by-file).
     - Explorer draft badges update via existing notifications.
   - This becomes the everyday path for “nuke all drafts,” leaving the Projects modal for project-level lifecycle.

---

## Phase 5 — MRU/Recents Migration into Sidecars

**Goal:** Move per-project MRU and `last_file` from `HistoryStore` into `ProjectSidecar`, making the sidecar the SSOT for all project-scoped state.

### 5.1. Extend ProjectSidecar Schema for Recents

**File:** `project_sidecar.py`

Already present:
- `recent_files: []` (currently unused)

Planned shape:

```json
"recent_files": [
  {
    "path": "/abs/path/to/file",
    "label": "relative/or/basename",
    "opened_at": "2025-12-02T12:34:56.789Z"
  },
  ...
]
```

Additional field:

```json
"last_file": "/abs/path/to/last/file/or/null"
```

Changes:

- Add accessors to `ProjectSidecar`:
  - `record_file_activity(file_path: str) -> dict`:
    - Updates `last_file`.
    - Inserts/bumps entry in `recent_files` (LRU, capped size).
  - `get_last_file() -> Optional[str]`
  - `list_recent_files() -> List[dict]`
  - `clear_recent_files()` (used by soft reset).

### 5.2. Wire HistoryStore’s MRU APIs to Sidecar

**File:** `history_store.py`

Current MRU logic:
- `record_file_activity(project_path, file_path)`:
  - Mutates `projects[project]["files"]` and `["last_file"]`.
- `get_last_file(project_path)`.
- `list_files(project_path)`.
- `clear_all_files(project_path)`.

Planned changes:

1. **Delegate to ProjectSidecar while keeping a compatibility shadow:**
   - `record_file_activity(project_path, file_path)`:
     - Normalizes paths.
     - Calls `ProjectSidecar.load_or_create(project).record_file_activity(file_path)` and saves.
     - Optionally updates a minimal `projects[project]["files"]` and `["last_file"]` for backward compatibility (or just uses sidecar for all reads if no old callers depend on the in-file copy).

   - `get_last_file(project_path)`:
     - Calls `ProjectSidecar.load_or_create(project).get_last_file()` as SSOT.
     - Falls back to legacy `projects[project]["last_file"]` only if sidecar missing (e.g., first run).

   - `list_files(project_path)`:
     - Calls `sidecar.list_recent_files()` and maps to the existing `{path, label, opened_at}` shape.

   - `clear_all_files(project_path)`:
     - Calls `sidecar.clear_recent_files()` and `sidecar.save()`.
     - Clears legacy `projects[project]["files"]` and `["last_file"]` for consistency.

2. **Migration / Compat layer:**
   - On first `ProjectSidecar.load_or_create(project)`:
     - If `recent_files` is empty but `HistoryStore.projects[project]["files"]` has entries:
       - Seed `recent_files` from those entries.
       - Set `last_file` from `projects[project]["last_file"]`.
     - This allows a one-time lazy migration without separate migration scripts.

3. **Update call sites:**
   - `editor_app.editor_page()`:
     - Already uses `_history_store.get_last_file(project_path)`; this will now read from sidecar via the delegated method.
   - `/history/files` endpoint in `main.py`:
     - Continues to call `_history_store.list_files(project_root)`, which now surfaces `sidecar.recent_files`.

**Outcome:**  
All per-project MRU data lives in the sidecar, with HistoryStore acting as a thin delegator + global project list. Projects can be fully “picked up and understood” via the sidecar and a single HistoryStore entry.

---

## Phase 6 — Multi-Project Draft Retention Policy

**Goal:** Allow drafts to persist across projects without surprise nukes, while retaining explicit controls to clear them when the user intends to.

### 6.1. Clarify When Drafts *Should* Be Cleared

Current clearing points:
- `reset_project_session(new_project_path)` (on project open/create/clone):
  - Clears `session_cache` + `tracked_jobs` and resets `diff_base` for the new project.
- Soft reset via Projects modal (active project trash):
  - Uses `reset_project_history` + `sidecar.clear_session_cache()` + `clear_tracked_jobs()` + `set_diff_base("HEAD")`.
- Hard delete via Projects modal (non-active):
  - Deletes sidecar file altogether.

Desired end state:
- **Project switches do NOT automatically clear drafts** for the target project.
- Drafts are only cleared:
  - On explicit user commands:
    - Soft reset (Projects modal on current project).
    - Hard delete (Projects modal on other projects).
    - Review tab “Discard” / “Check All + Discard” for that project.

### 6.2. Adjust `reset_project_session` Semantics

**File:** `explorer_ws.py`

Planned change:

- `reset_project_session(new_project_path)` currently:
  - Sets active project.
  - Clears `session_cache` and `tracked_jobs`.
  - Resets `diff_base` to `HEAD`.
  - Saves sidecar.

- New behavior:
  - Set active project as now.
  - **Do not** clear `session_cache` and `tracked_jobs` here.
  - Optionally keep resetting `diff_base` to `HEAD` on project switches, or leave `diff_base` untouched and let users manage it explicitly.

Consequence:
- Project switches are “non-destructive” with respect to drafts; drafts persist in each project’s sidecar.
- Users can still:
  - Use Review tab to discard drafts for the current project.
  - Use Projects modal to soft-reset or hard-delete as needed.

### 6.3. Communicate and Expose Draft State

Optional, but recommended for clarity:

- In the Projects modal:
  - Add a hint if a project has active drafts:
    - e.g., `Sidecar: ... (exists, drafts=3, session_count=5, last_boot_at=...)`.
  - This can be derived from:
    - `len(sidecar.session_cache)` or a computed property like `sidecar.list_project_drafts()`.

**Outcome:**  
Once `reset_project_session` stops clearing `session_cache` by default, we effectively have multi-project session drafting: each project keeps its drafts until the user explicitly clears them via Review or the Projects modal, and the sidecar is the sole SSOT for those drafts.

---

## Phase 7 — Final Clean-Up & Documentation

### 7.1. Remove Dead/Legacy Session Cache Paths

- The old `~/.cache/cm6_sessions` mechanism in `HistoryStore` (if still present) can be:
  - Clearly marked as legacy and left for a migration period, or
  - Fully removed once we are confident everything uses sidecar-based `session_cache`.

### 7.2. Documentation Updates

**Files:**
- `docs/apps/code_cm6/TECHNICAL.md`
- `tmp22.md`, `tmp23.md`, `tmp24.md`, `tmp25.md` (internal notes)

Update TECHNICAL.md to:
- Reflect that:
  - Drafts, diff base, tracked jobs, **and MRU** are all per-project and live in sidecars.
  - HistoryStore is just the global ledger: active project and recent project list.
- Include a short section on:
  - Projects modal behavior (open, soft reset, hard delete).
  - Null document semantics after soft resets and on projects with no last file.

### 7.3. Sanity/Regression Pass

Final checks across scenarios:

1. Single project, no drafts:
   - Open/close files, restart worker.
   - MRU and last file restore correctly.
2. Single project with drafts:
   - Drafts survive worker restarts.
   - Review tab shows/clears them correctly.
3. Multiple projects with drafts:
   - Switch projects; drafts remain per project when switching back.
   - Projects modal shows them, soft reset of one project does not affect others.
4. Soft reset of active project:
   - MRU, diff base, drafts cleared for that project.
   - Editor lands in null document state.
5. Hard delete of non-active project:
   - Project disappears from recents and Projects modal.
   - Its sidecar is removed.

When these are all verified, Code CM6’s per-project session management can be considered fully migrated and finalized. 

