# Project Session Sidecars — Implementation Report (Phase 1–2.5)

**Date:** 2025-12-02  
**Scope:** Code CM6 (file_editor_cm6)  
**Status:** In Progress (Session sidecars + debug tooling landed)

---

## 1. Per-Project Sidecar Infrastructure

**File:** `app/apps/file_editor_cm6/project_sidecar.py`

- Implemented `ProjectSidecar` as the canonical per-project state container:
  - Stored under `~/.cache/cm6_editor/projects/<sha1(project_path)>.json`.
  - Normalizes project paths (`Path(...).expanduser().resolve(strict=False)`).
  - Schema fields:
    - `version`, `project_path`, `session_count`, `created_at`, `last_boot_at`
    - `diff_base`: `{ref, commit_sha}` (ref is authoritative; metadata is best-effort)
    - `session_cache`: map of file cache key → draft entry
    - `tracked_jobs`: job IDs associated with this project
    - `recent_files`: reserved for future MRU migration
- In-memory singleton cache:
  - `ProjectSidecar._instances: Dict[normalized_path, ProjectSidecar]`
  - `load_or_create(project_path)` reuses instances per normalized path.
- API surface:
  - Session counter:
    - `increment_session()` updates `session_count` and `last_boot_at`.
    - `session_count` is now **informational only** (no clearing keyed off its value).
  - Diff base:
    - `get_diff_base() -> str`
    - `set_diff_base(ref: Optional[str]) -> str`
  - Session cache:
    - `get_cached_document(file_path)`
    - `upsert_cached_document(file_path, content, base_sha256, run_id, shell_id, shell_run_id, launcher_pid, worker_pid)`
    - `clear_cached_document(file_path)`
    - `list_project_drafts()`
    - `clear_session_cache()`
  - Job tracking:
    - `add_tracked_job(job_id)`
    - `remove_tracked_job(job_id)`
    - `clear_tracked_jobs()`

**Rationale:** All per-project *ephemeral* state (drafts, diff base, tracked jobs) must live in one place keyed purely by `project_path`, decoupled from the global history ledger. This avoids cross-project contamination when paths are reused.

---

## 2. HistoryStore Integration (Session Cache + Diff Base)

**File:** `app/apps/file_editor_cm6/history_store.py`

- Session cache API (`HistoryStore`) now delegates to `ProjectSidecar`:
  - `get_cached_document(project_path, file_path)` → `ProjectSidecar.get_cached_document`.
  - `upsert_cached_document(...)`:
    - Logs a debug line with both base and content SHA.
    - Forwards to `ProjectSidecar.upsert_cached_document(...)` and `sidecar.save()`.
    - Falls back to an in-memory entry only if sidecar IO fails (edge case).
  - `clear_cached_document(project_path, file_path)`:
    - Uses `ProjectSidecar.clear_cached_document` and saves sidecar when it returns `True`.
  - `list_project_drafts(project_path)`:
    - Returns `ProjectSidecar.list_project_drafts()` (sidecar is SSOT for drafts).
  - `list_cached_documents(project_path)`:
    - Thin wrapper which currently returns `list_project_drafts(project_path)`.
- Diff base:
  - `set_diff_base(project_path, ref)`:
    - Writes the value into the project’s sidecar via `sidecar.set_diff_base(ref)` + `sidecar.save()`.
    - Also mirrors the value back into `history_store.json` for compatibility.
  - `get_diff_base(project_path)`:
    - Prefers sidecar’s `get_diff_base()`; logs a `(sidecar)` trace.
    - Falls back to `projects[project]["diff_base"]` if sidecar load fails; logs `(history)`.

**Result:** All existing callers (`/session_cache` API, NiceGUI editor, review overlays, explorer decorations, diff base controls) continue using `_history_store`, but the underlying persistence is per-project sidecars.

---

## 3. Session Counters & Boot Lifecycle

**File:** `app/apps/file_editor_cm6/main.py`

- `initialize_project_session()`:
  - Called once on worker import.
  - Behavior *after fix*:
    - Reads `active_project` from `_history_store`.
    - If the project exists, loads `ProjectSidecar`, calls `increment_session()`, and `save()`.
    - **Does NOT clear** `session_cache` or `tracked_jobs`.
  - Docstring explicitly warns:
    - Clearing per-project state is the responsibility of explorer-side `reset_project_session`.
    - A plain worker restart for the same project must *not* wipe drafts.
- Module-import side effects:
  - `_ensure_project_root_synced()` keeps in-memory explorer root in sync with stored `active_project`.
  - `cleanup_orphaned_sidecars()` removes any sidecars whose `project_path` no longer exists on disk.
  - `initialize_project_session()` runs once and stores the sidecar in `_active_project_sidecar` for potential future use/telemetry.

**Bug fixed:** Previously, we cleared `session_cache` and `tracked_jobs` when `session_count == 1` on boot. Combined with `reset_project_session` initializing the counter to `0`, this caused drafts written *after* a project switch (while the counter was still 0) to be wiped on the next worker restart. That logic has been removed; session counters are now informational only.

---

## 4. Explorer Project Switch Gatekeeper

**File:** `app/apps/file_editor_cm6/explorer_ws.py`

- New helper: `reset_project_session(new_project_path: str)`:
  - Normalizes the path.
  - Updates `_history_store.set_active_project(normalized_path)` (SSOT for active project).
  - Loads the project’s `ProjectSidecar`.
  - Clears:
    - `session_cache` (drafts)
    - `tracked_jobs`
  - Resets `diff_base` to `"HEAD"`.
  - Saves the sidecar.
  - **Does not** touch `session_count` (see §3).
- Wired into project flows:
  - `handle_project_open`:
    - After `set_project_root(path)`, calls `reset_project_session(str(new_root))`.
  - `handle_project_create`:
    - Delegates to `handle_project_open` with the new path (inherits the reset behavior).
  - `handle_git_clone`:
    - After creating the target directory and `set_project_root(str(target))`, calls `reset_project_session(str(new_root))`.
- Job tracking:
  - When creating git jobs (push, pull, clone), we:
    - Track job ID in `ExplorerDispatcher._tracked_job_ids`.
    - Also add the job ID to the project’s sidecar via `add_tracked_job(job.id)` + `save()`.
  - When a job completes in `_pump_job_events`, we:
    - Remove it from `_tracked_job_ids`.
    - Remove it from the sidecar with `remove_tracked_job(job_id)` + `save()`.

**Effect:** Explicit project changes (open/create/clone) now deterministically clear per-project editor state at the moment of switch. Worker restarts simply bump `session_count`, with no clearing side effects.

---

## 5. Debug: Projects & Sidecars API

**File:** `app/apps/file_editor_cm6/main.py`

### 5.1. List Endpoint

- `GET /api/app/file_editor_cm6/debug/projects`
- Response:
  ```json
  {
    "ok": true,
    "data": [
      {
        "path": "/abs/project/path",
        "label": "project-name",
        "opened_at": "2025-12-02T05:00:00Z",
        "sidecar_path": "/home/.../.cache/cm6_editor/projects/<hash>.json",
        "sidecar_exists": true,
        "session_count": 3,
        "last_boot_at": "2025-12-02T05:50:00Z"
      },
      ...
    ]
  }
  ```
- Implementation:
  - Uses `_history_store.list_projects()` as the source of truth for recent projects.
  - For each entry:
    - Computes sidecar path via `ProjectSidecar.get_sidecar_path(project_path)`.
    - Checks existence and, if present, loads the sidecar to read `session_count` and `last_boot_at`.

### 5.2. Delete Endpoint

- `DELETE /api/app/file_editor_cm6/debug/projects`
- Request body:
  ```json
  { "path": "/abs/project/path" }
  ```
- Behavior:
  - Calls `_history_store.remove_project(path)`:
    - Removes the project from `projects[...]`.
    - Removes it from `recent_projects`.
    - Clears `active_project` if it matches.
  - Attempts to delete the corresponding sidecar file:
    - `ProjectSidecar.get_sidecar_path(path).unlink()` if it exists.
    - Sidecar deletion failures are non-fatal.
  - Response:
    ```json
    {
      "ok": true,
      "data": {
        "removed": true,
        "sidecar_deleted": true
      }
    }
    ```

**Purpose:** Debug-only tool to inspect and surgically clean up history + sidecar state without touching actual project folders.

---

## 6. Debug UI: Projects & Sidecars Modal

**Files:**
- `app/apps/file_editor_cm6/template.html`
- `app/apps/file_editor_cm6/main.js`

### 6.1. File Menu Entry

- Under the “File” menu:
  - New item: `Debug: Projects & Sidecars…` (`#mi-debug-projects`).
- Wiring:
  - `const miDebugProjects = requireEl('#mi-debug-projects');`
  - `bindMenuToggle(miDebugProjects, () => { showProjectsDebugModal(); });`

### 6.2. Modal Layout

- Modal constructed lazily in JS (`ensureProjectsDebugModal()`):
  - Root: `<div id="fe-projects-debug-modal" class="fe-modal">…</div>`
  - Card: `.fe-modal-card` (max-width: 640px).
  - Scrollable body: `.fe-modal-body` with:
    - Vertical scroll (`overflow-y: auto`).
    - Horizontal scroll disabled (`overflow-x: hidden`).
  - Content container: `#fe-projects-debug-content`.

- CSS additions in `template.html`:
  - `.fe-modal-body { padding: 16px 20px; overflow-y: auto; overflow-x: hidden; }`
  - Row/grid:
    - `.fe-projects-debug-row`:
      - `display: grid; grid-template-columns: minmax(0,1fr) auto;`
      - Thin right column for actions.
    - `.fe-projects-debug-info`:
      - Left cell, contains both project and sidecar text.
    - `.fe-projects-debug-title`:
      - Bold, word-break enabled.
    - `.fe-projects-debug-meta`:
      - Smaller, muted text, word-break enabled.
    - `.fe-projects-debug-trash`:
      - Right cell, flex container for the trash button.
    - `.fe-projects-debug-trash button`:
      - Small `fe-btn`, red (`#ef4444`), narrow padding.

### 6.3. Behavior

- `showProjectsDebugModal()`:
  - Ensures the modal exists.
  - Shows it (`.fe-modal.show`) and calls `loadProjectsDebugContent()`.
- `loadProjectsDebugContent()`:
  - Calls `GET /debug/projects`.
  - If empty, shows “No recent projects recorded.”
  - Otherwise, renders one grid row per project:
    - Left cell:
      - `label — path`
      - `Sidecar: <path> (exists/missing, session_count=…, last_boot_at=…)`
    - Right cell:
      - Red trash button (`🗑`).
  - Clicking the trash:
    - Shows a `window.confirm()` with the project path.
    - If confirmed:
      - Calls `DELETE /debug/projects` with `{path}`.
      - On success, re-invokes `loadProjectsDebugContent()` to refresh.
      - On error, shows a simple `window.alert(...)`.

**Usage:** This is purely a developer/debug surface for inspecting and cleaning up the `_history_store` + sidecar mapping, especially during iteration on the project-session model.

---

## 7. Known Behavior & Remaining Work

- **Current behavior:**
  - Drafts:
    - Persist to per-project sidecars via `HistoryStore.upsert_cached_document`.
    - Survive worker restarts for the same active project.
    - Are cleared only on explicit project switches (`reset_project_session`) or when the debug delete endpoint is used.
  - Diff base:
    - Stored per project in sidecars; mirrored in `history_store.json`.
    - Reset to `HEAD` on project switch.
  - Jobs:
    - Tracked per explorer instance in-memory and mirrored in sidecars for future use/inspection.
  - Session counters:
    - Increment on every worker boot for the active project; used for telemetry/debugging only.

  - **Remaining / future work (not yet implemented):**
  - UI “Clear Project State” action in the menus (manual nuclear option).
  - Optional migration of per-project MRU (`recent_files`) into `ProjectSidecar.recent_files`.
  - Additional debug views (e.g., per-project draft listing via the sidecar instead of scanning disk).

---

## 8. Progress Update — Explorer/Editor Sync & Soft Reset (2025-12-02, later)

### 8.1. Project-Opened Sync Between Explorer, Host, and Iframe

**Files:**
- `app/apps/file_editor_cm6/static/js/explorer.js`
- `app/apps/file_editor_cm6/main.js`
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

- **Explorer → Host hook:**
  - `explorer.js` handles `project:opened` (from `explorer_ws`):
    - Updates `uiState.projectPath`.
    - Refreshes tree and git status.
    - Calls `window.__cm6HandleProjectOpened(payload.path)` if present.

- **Host handler (`__cm6HandleProjectOpened`):**
  - Implemented in `main.js`:
    - Clears host-side editor state (currentPath, diff controller context, WebSocket, unsaved flag, toolbar labels).
    - Calls `syncEditorState(true)` to pull a fresh `/state` snapshot for the new active project.
    - Reloads the NiceGUI iframe (`editor_frame`) so `editor_page()` runs in the context of the new project.

- **Iframe reload semantics (null document):**
  - `editor_app.editor_page()` reads:
    - `project_path = _history_store.get_active_project()`
    - `last_file = _history_store.get_last_file(project_path)`
  - If `last_file` is missing or invalid:
    - `initial_path = None`, `initial_content = ''`.
    - No watcher subscription is created.
    - No session cache writes happen.
    - No MRU updates happen.
    - This is explicitly documented as the **“null document”** / blank state for a project.

**Result:**  
Switching projects via explorer now reliably:
1. Clears per-project sidecar state (`reset_project_session`).
2. Emits `project:opened`.
3. Causes the host to clear its editor state and reload the iframe.
4. Leads `editor_page()` to open either the last real file for that project or a clean null document when there is none.

### 8.2. Active Project Highlighting and Soft Reset in Debug Modal

**Files:**
- `app/apps/file_editor_cm6/main.py`
- `app/apps/file_editor_cm6/history_store.py`
- `app/apps/file_editor_cm6/template.html`
- `app/apps/file_editor_cm6/main.js`

- **Active project flag in `/debug/projects`:**
  - `debug_projects()` now adds `is_active` per entry:
    - `path == _history_store.get_active_project()`.
  - Frontend sorts projects so the active project is listed first.
  - Active row gets `.fe-projects-debug-row--active` styling (blue-tinted highlight).

- **Soft reset vs hard delete in `DELETE /debug/projects`:**
  - New helper `HistoryStore.reset_project_history(project_path)`:
    - Clears `files[]`, `last_file`, sets `diff_base = "HEAD"`, removes `origin`.
    - Keeps `recent_projects` and `active_project` intact.
  - `debug_delete_project` semantics:
    - If project is **active**:
      - Calls `reset_project_history(path)`.
      - Loads its sidecar, then:
        - `clear_session_cache()`
        - `clear_tracked_jobs()`
        - `set_diff_base("HEAD")`
        - `save()`
      - Returns `history_reset=True`, `removed=False`, `sidecar_deleted=False`, `is_active=True`.
      - I.e., **soft nuke**: wipes MRU + drafts + diff base, but keeps project known and sidecar file intact.
    - If project is **not active**:
      - Calls `_history_store.remove_project(path)` (removes from `projects` + `recent_projects`, clears `active_project` if needed).
      - Deletes the project’s sidecar file if it exists.
      - Returns `removed=True`, `sidecar_deleted=True`, `history_reset=False`, `is_active=False` (hard delete).

- **Debug modal interactions:**
  - Each row:
    - Left cell (info): project label/path + sidecar info.
    - Right cell: red trash button.
  - For non-active projects:
    - Clicking the left cell acts as a “quick open project”:
      - Confirms unsaved-change warning.
      - Sends `project:open` via `window.__explorerBusSend`, then hides the modal.
      - Reuses the standard project switch pipeline.
  - For the active project:
    - Info cell is inert (no click handler).
    - Trash button triggers the **soft reset** described above.
    - After a successful soft reset:
      - Frontend calls `window.__cm6HandleProjectOpened(path)` directly:
        - Clears host editor state.
        - Reloads the iframe.
      - `editor_page()` reloads into the **null document** state for the same active project (no `last_file`, no drafts).

**Result:**  
Soft-resetting the currently active project via the debug modal now behaves like “just opened a new project”:
- Per-project drafts, MRU, and diff base are wiped.
- The project remains selected and in recents.
- The host + iframe editor re-synchronize into a clean blank buffer tied to that project.

---

**Summary:**  
The Code CM6 editor now uses per-project sidecars as the SSOT for project-scoped state (drafts, diff base, tracked jobs), with explicit clearing on project switches and a read-only debug UI to introspect and surgically reset history + sidecars. Session counters remain in place for diagnostics but no longer trigger state clearing, preventing accidental draft loss on worker restarts. 
