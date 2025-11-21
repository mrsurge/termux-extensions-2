# Diff Base Selection – Change Log & Architecture Review (2025-11-21)

## 1. Purpose
Document every code change made while adding the “diff base” selector, explain the resulting architecture, record desired behaviour, and outline the intended long-term design. (Local edits to `GEMINI.md` / `README.md` predate this effort and are not covered here.)

## 2. File-by-file Change Log
| File | Reason / Key Changes |
| --- | --- |
| `app/apps/file_editor_cm6/history_store.py` | Projects now persist a `diff_base` key (default `HEAD`). Loader back-fills the field for existing history files. Added `get_diff_base` / `set_diff_base` helpers used across the backend. |
| `app/apps/file_editor_cm6/diff_helper.py` | `collect_diff()` accepts `base_ref`, caches per `(root, path, base)`, and passes `git diff --unified=0 <base> -- file`. Cache invalidation was updated to purge all base variants. |
| `app/apps/file_editor_cm6/git_helper.py` | `get_worktree_changes()` now accepts a base ref: HEAD uses porcelain status, other refs use `git diff --name-status <ref>` + `ls-files --others`. Added `get_commit_info()` to resolve hash/subject metadata for the selector. |
| `app/apps/file_editor_cm6/edit_tracker.py` | Tracks the currently selected base (via history store) so live inline diffs and edit events compare against the same baseline. |
| `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` | All calls to `collect_diff()` now pass `_current_diff_base(project_path)` so CodeMirror decorations honour the selector from startup through file watcher refreshes. |
| `app/apps/file_editor_cm6/main.py` | Baked the diff base into `_build_state_payload()`, `/diff`, and `/explorer/search`. Added `/git/diff_base` (GET/POST) plus `_resolve_diff_base` / `_diff_base_payload` so every consumer reads the same stored value. Git actions remain untouched—Git itself is still the lone validator. |
| `app/apps/file_editor_cm6/static/js/explorer.js` | Frontend simply displays whatever the backend stores. Selecting a commit POSTs `/git/diff_base`, waits for the write, re-fetches the stored value, then refreshes git status, explorer tree, inline diffs, and “By Changes.” No more local caching or action-hiding. |
| `app/apps/file_editor_cm6/static/js/explorer.css` | Styles for the two-row footer, responsive dropdowns (50 vh scrollable, right-aligned, explorer dropdown pops upward), and the new “By Changes” presentation (line/diff gutters, toolbar layout). |
| `app/apps/file_editor_cm6/template.html` | Explorer footer rewritten into two rows; inserted Status button + dropdown anchor. |

## 3. Architecture Review
### 3.1 Data Ownership
- **History store** is the single source of truth for the selected diff base per project (`diff_base`). Defaults to `HEAD`; absence/corruption resets to `HEAD` during load.
- **Preferences store** remains responsible for cross-project UI/personal preferences (themes, inline diff toggle, etc.).
- **Backend endpoints** read from the history store for every git/diff request and never trust frontend state.

### 3.2 Data Flow
1. When a project loads, `_build_state_payload()` injects `gitDiffBase` into `/state`; explorer.js immediately re-fetches `/git/diff_base` to confirm the stored value.
2. Selecting a commit from either Status button POSTs `/git/diff_base`, awaits the response, re-fetches the stored value, then refreshes git status, explorer tree, inline diffs, and “By Changes.”
3. Backend `/git/diff_base` validates refs (`get_commit_info`) and persists them—no additional gating or UI heuristics.
4. Diff-producing endpoints (`/diff`, `/explorer/search?mode=changes`, inline diff loaders, edit tracker) all pass the same base into `collect_diff` / `get_worktree_changes`.
5. Terminal/editor watchers simply reload buffers; diff cache ensures the baseline switch is visible without restarting.

### 3.3 Modes and Guardrails
- **Mode: none** – repository unavailable; git UI stays hidden but Status button reads “No Git.”
- **Mode: active** – regardless of whether the baseline equals HEAD, Status buttons simply display the stored ref while git controls remain enabled. Git CLI (`git status`, `git log`, etc.) continues to be the single source of truth for validation.

### 3.4 Outstanding Issue
The selector occasionally appears to “stick” at HEAD after a restart. Likely causes:
- Cached frontend state not re-fetching `/git/diff_base` before re-rendering.
- Watcher / inline refresh not running because we only refresh after `/git/diff_base` POST succeeds, not on cold boot.
- Diff cache invalidation happens, but `gitDiffBase` is missing from `/state` when frontend starts (race between `_build_state_payload()` and whichever call the UI used).

## 4. Desired Functionality
1. **Single Source of Truth** – The history store must always return the latest baseline for the active project; all readers should subscribe to `/state` updates instead of caching their own copy.
2. **Stateful UI** – The Status button and “By Changes” toolbar must always show the currently stored base, even after reconnects.
3. **Deterministic Mutations** – Leave git commands alone; Git itself remains the validator. The selector is purely a display preference for diff views.
4. **Diff Consistency** – Every view (inline diffs, search results, explorer badges, watcher jolts) must render against the same stored baseline so users never see conflicting answers depending on the surface.
5. **Graceful Recovery** – If the stored base ref is invalid (gc’d commit, shallow clone, etc.) the backend should fall back to HEAD automatically and notify the frontend.

## 5. Intended Architecture (Next Steps)
1. **State bootstrap hook** – `/state` already contains `gitDiffBase`; we still want a monotonic `gitStateVersion` so other clients can invalidate caches without polling.
2. **Diff-base watcher** – When `_history_store.set_diff_base()` succeeds, push a websocket or SSE event so the NiceGUI frontend can call `/git/diff_base` without guessing.
3. **Commit validation UX** – The dropdown should warn when the selected ref is unreachable (e.g., fetch required) and automatically revert to HEAD.
4. **Persistence diagnostics** – Add a lightweight `/git/diff_base/log` endpoint (or logging hook) to verify what value is being read/written during session restarts; this will help root-cause any future “stuck at HEAD” reports.

---
Feel free to append troubleshooting notes to this document as we chase the baseline persistence issue.

## 6. Troubleshooting Log

### 6.1 Sticky HEAD / Persistence Reset (2025-11-21)
- **Symptom:** Selector appeared to reset to `HEAD` after reconnects.
- **Cause:** `HistoryStore` key mismatch (raw vs resolved paths) created duplicate entries that defaulted `diff_base` to `HEAD`.
- **Fix:** Added `_normalize_project_path`, normalized all history-store calls, and logged accesses for diagnostics.
- **Status:** Persistent state now maps reliably to the correct project entry.

### 6.2 UX Simplification (2025-11-21)
- **Symptom:** Disabling git buttons when browsing historic commits created confusion and didn’t add safety (Git already validates HEAD).
- **Fix:** Removed `_ensure_git_actions_allowed` and all front-end gating. Status buttons now *only* display the stored ref and trigger the write → read → refresh loop.
- **Status:** Git commands and explorer UI behave exactly as before; the selector is display-only and always sourced from the backend.
