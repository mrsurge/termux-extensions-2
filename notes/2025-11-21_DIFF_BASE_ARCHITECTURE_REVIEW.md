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
| `app/apps/file_editor_cm6/main.py` | Baked the diff base into `_build_state_payload()`, `/explorer/list`, `/diff`, and `/explorer/search`. Added `/git/diff_base` (GET/POST), `_resolve_diff_base`, `_diff_base_payload`, and `_ensure_git_actions_allowed` (blocks stage/commit/etc. unless the base is HEAD). `/git/diff_base` also invalidates diff caches and marks git caches dirty so explorers refresh automatically. |
| `app/apps/file_editor_cm6/static/js/explorer.js` | Frontend now mirrors the backend base state, exposes the Status button + dropdown in both explorer footer and search overlay, auto-enables inline diffs when clicking hunks, hides git action buttons when base ≠ HEAD, and refreshes “By Changes” when the base moves. |
| `app/apps/file_editor_cm6/static/js/explorer.css` | Styles for the two-row footer, responsive dropdowns (50 vh scrollable, right-aligned, explorer dropdown pops upward), and the new “By Changes” presentation (line/diff gutters, toolbar layout). |
| `app/apps/file_editor_cm6/template.html` | Explorer footer rewritten into two rows; inserted Status button + dropdown anchor. |

## 3. Architecture Review
### 3.1 Data Ownership
- **History store** is the single source of truth for the selected diff base per project (`diff_base`). Defaults to `HEAD`; absence/corruption resets to `HEAD` during load.
- **Preferences store** remains responsible for cross-project UI/personal preferences (themes, inline diff toggle, etc.).
- **Backend endpoints** read from the history store for every git/diff request and never trust frontend state.

### 3.2 Data Flow
1. When a project loads, `_build_state_payload()` injects `gitDiffBase` into `/state`, `/explorer/list`, and `/explorer/search` payloads.
2. Explorer JS caches that value (`gitDiffBase`) and:
   - Updates the footer/search buttons.
   - Hides git mutator buttons when `mode !== 'head'`.
   - Passes the value back to `/git/diff_base` when user selects a new commit.
3. Backend `/git/diff_base` validates the ref (`git rev-parse` via `get_commit_info`), persists it, invalidates diff cache, and marks git status dirty.
4. Diff-producing endpoints (`/diff`, `/explorer/search?mode=changes`, inline diff loaders, edit tracker) all pass the same base into `collect_diff` / `get_worktree_changes`.
5. Terminal/editor watchers simply reload buffers; diff cache ensures the baseline switch is visible without restarting.

### 3.3 Modes and Guardrails
- **Mode: none** – repository unavailable; git UI stays hidden but Status button reads “No Git.”
- **Mode: head (“Cruise”)** – default; full git UI enabled.
- **Mode: detached** – user selected a historical commit; backend refuses stage/commit/push/pull/reset/restore with HTTP 409 via `_ensure_git_actions_allowed`. Explorer tree drops git badges; footer actions vanish. Status button + search overlay still work so the user can jump back to HEAD.

### 3.4 Outstanding Issue
The selector occasionally appears to “stick” at HEAD after a restart. Likely causes:
- Cached frontend state not re-fetching `/git/diff_base` before re-rendering.
- Watcher / inline refresh not running because we only refresh after `/git/diff_base` POST succeeds, not on cold boot.
- Diff cache invalidation happens, but `gitDiffBase` is missing from `/state` when frontend starts (race between `_build_state_payload()` and whichever call the UI used).

## 4. Desired Functionality
1. **Single Source of Truth** – The history store must always return the latest baseline for the active project; all readers should subscribe to `/state` updates instead of caching their own copy.
2. **Stateful UI** – The Status button and “By Changes” toolbar must always show the currently stored base, even after reconnects.
3. **Deterministic Mutations** – Git mutation endpoints should be hard-blocked unless the selector is set back to HEAD, ensuring staging/committing never secretly targets the wrong comparison.
4. **Diff Consistency** – Every view (inline diffs, search results, explorer badges, watcher jolts) must render against the same baseline so users never see conflicting answers depending on the surface.
5. **Graceful Recovery** – If the stored base ref is invalid (gc’d commit, shallow clone, etc.) the backend should fall back to HEAD automatically and notify the frontend.

## 5. Intended Architecture (Next Steps)
1. **State bootstrap hook** – Extend `/state` to include both `gitDiffBase` and a monotonically increasing `gitStateVersion`. Explorer (and other clients) should re-fetch `/git/diff_base` whenever `gitStateVersion` changes so reconnects update immediately.
2. **Server-side enforcement for explorer list** – Instead of forcing explorer.js to hide badges, return stripped metadata from `/explorer/list` whenever `_diff_base_payload().mode === 'detached'`. (Partial step already done by zeroing `gitStatus`.)
3. **Diff-base watcher** – When `_history_store.set_diff_base()` succeeds, push a websocket or SSE event so the NiceGUI frontend can call `/git/diff_base` without polling.
4. **Commit validation UX** – The dropdown should warn when the selected ref is unreachable (e.g., fetch required) and automatically revert to HEAD.
5. **Persistence diagnostics** – Add a lightweight `/git/diff_base/log` endpoint (or logging hook) to verify what value is being read/written during session restarts; this will help root-cause the “resets to HEAD” behaviour you’re seeing.

---
Feel free to append troubleshooting notes to this document as we chase the baseline persistence issue.
