# File Editor CM6 – Short-Term TODO / Roadmap
**Generated:** 2025-11-16T23:11:03Z  
**Author:** Codex (GPT-5.1)  
**Context:** Captures near-term feature work / fixes still outstanding after the NiceGUI migration. Each item references relevant modules from the current codebase.

---

## 1. Preserve File Attributes on Save
- **Pain:** save flow rewrites files via `write_full` and loses original chmod bits (especially execute flag).
- **Scope:** `app/apps/file_editor_cm6/core_write.py`, `/editor/save` in `nicegui_editor/editor_app.py`.
- **Plan:** before overwriting, capture `os.stat(path).st_mode`, perform write, then `os.chmod(new_path, old_mode & 0o777)`. Add tests/logging to confirm. Consider opt-out for new files.

## 2. Explorer Search UX
- **Status:** Not designed yet; biggest UX ask.
- **Scope:** `explorer_helper.list_dir`, `app/apps/file_editor_cm6/static/js/explorer.js`, drawer template.
- **Plan:** decide whether search is global (project-wide) or scoped to current directory. Likely flow: input box in drawer header → call new backend endpoint (re-using `list_dir` with fuzzy match) → render results list with same card component. Needs debounce + “clear search” affordance.

## 3. Go To Line (UI already exists)
- **Status:** Menu item prompts for line but relies on legacy CM6 host `view`.
- **Scope:** Replace prompt handler with backend call to `/editor/jump_to_line` (already implemented). Frontend should gather `currentPath` + line, post, and surface errors.

## 4. Autosave Integration
- **Status:** Backend plumbing exists (scheduler + save endpoint). Frontend toggles exist but still hooked to legacy logic.
- **Scope:** `main.js` autosave timer + `editor_app.py` cache persistence; collision logic already lives in `core_read.py`/`core_write.py`, so work should stay compatible with the original guardrails.
- **Plan:** when autosave enabled, trigger backend save at intervals or after debounce, then suppress session-cache snapshots (or flag them read-only) to avoid double writes. Re-test existing collision handling (base SHA, watcher skips) against the iframe drift and patch only what changed.

## 5. Indentation Guides (CM6 extension)
- **Status:** Desired even though effort > payoff.
- **Scope:** Vendored CM6; likely need to bundle ts extension (e.g., `@codemirror/view` guide implementation).
- **Plan:** bundle a minimal JS version (transpile TS → JS via esbuild), inline similar to search shim. Expose toggles via `editor_app.py` + menu.

## 6. Terminal Project Switching Bug
- **Symptoms:** When project changes, existing terminal keeps old CWD; new terminal inherits stale directory.
- **Scope:** `createTerminalDrawer` (frontend), `terminal_backend.py`, project root setters (`explorer_helper`, `history_store`).
- **Plan:** ensure project-change events broadcast to terminal drawer; auto-close existing session + reinit with new `cwd`. Audit “New Project” flow to ensure `_history_store.set_active_project` and `set_project_root` remain in sync.

---

### Next Steps
1. Decide implementation order (attribute preservation + terminal bug are “must fix”, search/indent guides are “nice-to-have” UX).
2. After each item ships, update this file with completion date + commit hash so roadmap stays current.
