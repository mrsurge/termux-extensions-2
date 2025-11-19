# File Editor CM6 – Short-Term TODO / Roadmap
**Generated:** 2025-11-16T23:11:03Z  
**Author:** Codex (GPT-5.1)  
**Context:** Captures near-term feature work / fixes still outstanding after the NiceGUI migration. Each item references relevant modules from the current codebase.

---

## 1. Preserve File Attributes on Save
- **Pain:** save flow rewrites files via `write_full` and loses original chmod bits (especially execute flag).
- **Scope:** `app/apps/file_editor_cm6/core_write.py`, `/editor/save` in `nicegui_editor/editor_app.py`.
- **Status:** ✅ Completed 2025-11-17. Save endpoints now capture existing `st_mode`, feed it into `write_full`, and executable bits persist on overwrite/new files.

## 2. Explorer Search UX
- **Status:** ✅ Completed (with caveats - still a little buggy).
- **Scope:** `explorer_helper.list_dir`, `app/apps/file_editor_cm6/static/js/explorer.js`, drawer template.
- **Plan:** decide whether search is global (project-wide) or scoped to current directory. Likely flow: input box in drawer header → call new backend endpoint (re-using `list_dir` with fuzzy match) → render results list with same card component. Needs debounce + “clear search” affordance.
- **References:** `notes/2025-11-17_EXPLORER_SEARCH_FIXES.md`, `notes/2025-11-17_LESSONS_LEARNED.md`, `docs/core/nicegui_iframe_feature_adding_guideline.md` (lines 78-107: stateless endpoints, 109-140: real-time updates)

## 3. Go To Line (UI already exists)
- **Status:** Menu item prompts for line but relies on legacy CM6 host `view`.
- **Scope:** Replace prompt handler with backend call to `/editor/jump_to_line` (already implemented). Frontend should gather `currentPath` + line, post, and surface errors.
- **References:** `notes/2025-11-17_EXPLORER_SEARCH_FIXES.md` (includes Go To Line refactor), `docs/core/nicegui_iframe_feature_adding_guideline.md` (lines 78-107: stateless endpoints)

## 4. Autosave Integration
- **Status:** Backend plumbing exists (scheduler + save endpoint). Frontend toggles exist but still hooked to legacy logic.
- **Scope:** `main.js` autosave timer + `editor_app.py` cache persistence; collision logic already lives in `core_read.py`/`core_write.py`, so work should stay compatible with the original guardrails.
- **Plan:** when autosave enabled, trigger backend save at intervals or after debounce, then suppress session-cache snapshots (or flag them read-only) to avoid double writes. Re-test existing collision handling (base SHA, watcher skips) against the iframe drift and patch only what changed.
- **References:** `notes/2025-11-14_Session_Cache_Implementation_Plan.md`, `notes/2025-11-13_EDITOR_REFACTOR_PLAN.md`, `runtime_paths/framework_startup_to_file_editor_cm6.md` (lines 100-128: save flow, 111-123: write_full)

## 5. Indentation Guides (CM6 extension)
- **Scope:** Vendored CM6; bundle extension (e.g., `@replit/codemirror-indentation-markers`), wire toggle via NiceGUI iframe + preferences.
- **Plan:** bundle a minimal JS version (transpile TS → JS via esbuild), inline similar to search shim. Expose toggles via `editor_app.py` + menu.
- **Status (2025-11-17 02:15 UTC):** Desired even though effort > payoff.
- **Status (2025-11-17 05:30 UTC):** ✅ Completed. See `notes/2025-11-17_INDENTATION_GUIDES_IMPLEMENTATION.md`.

## 6. Terminal Project Switching Bug
- **Symptoms:** When project changes, existing terminal keeps old CWD; new terminal inherits stale directory.
- **Scope:** `createTerminalDrawer` (frontend), `terminal_backend.py`, project root setters (`explorer_helper`, `history_store`).
- **Plan:** ensure project-change events broadcast to terminal drawer; auto-close existing session + reinit with new `cwd`. Audit “New Project” flow to ensure `_history_store.set_active_project` and `set_project_root` remain in sync.
- **References:** `notes/2025-11-16_TERMINAL_CWD_FIX.md`, `notes/2025-11-16_TERMINAL_LIFECYCLE_FIX.md`, `runtime_paths/framework_startup_to_file_editor_cm6.md` (lines 69-80: main.py init, 76-79: project_root state)

## 7. Theme Menu Checkmarks
- **Pain:** Theme dropdown doesn’t accurately show current selection; checkmarks/aria state drift from actual theme.
- **Scope:** Template markup in `app/apps/file_editor_cm6/template.html` + menu logic in `main.js` (`updateThemeMenuChecks`).
- **Plan:** Ensure each theme item renders a checkmark span toggled via JS, and keep `aria-checked` in sync after theme changes/load so users can see which theme is active.
- **References:** `notes/2025-11-17_LESSONS_LEARNED.md`

## 8. Font Size Controls (Editor & Chrome)
- **Pain:** No way to adjust editor font size or surrounding chrome (menubar/explorer text) without diving into prefs.
- **Scope:** NiceGUI editor (use `editor.set_font_scale()`), plus host chrome CSS variables.
- **Plan:** Add “Font Size Increase/Decrease” entries under the Editor menu. When invoked, call backend endpoint to adjust CodeMirror font via `set_font_scale`, and update CSS custom properties for toolbar/drawer text so the UI scales consistently. Persist preference in `preferences_store`.
- **Status:** ✅ Completed 2025-11-17. Selector fix + menu wiring shipped: Small/Medium/Large presets adjust CM6 font scale and chrome CSS variables, persisted via preferences.

---

### Next Steps

#### Explorer Drawer
1. New Project modal with two options instead of direct picker:
   - (a) New project directory: reuse existing New Project behavior and let user optionally init Git via existing explorer Git actions.
   - (b) Clone from Git repo URL: user enters URL, chooses target directory and optional custom project name via shared file picker; clone uses Termux environment (reuses existing credentials where applicable).
   - **References:** `notes/2025-11-16_EXPLORER_REWRITE_PROGRESS_LOG.md`, `runtime_paths/framework_startup_to_file_editor_cm6.md` (lines 76-79: project_root management)
2. Add external file explorer integration:
   - Add "Open in external explorer" entry to directory card "..." menus, launching the framework’s native file explorer app worker at that directory.
   - **References:** `notes/2025-11-16_EXPLORER_REWRITE_PROGRESS_LOG.md`
3. Add "Copy from" and "Move from" actions:
   - Add to directory card "..." menus; use shared file picker to choose source path, then copy/move into the selected directory.
   - **References:** `notes/2025-11-16_EXPLORER_REWRITE_PROGRESS_LOG.md`, `runtime_paths/framework_startup_to_file_editor_cm6.md` (lines 84-92: read, 100-128: write)
4. Add "cd in terminal" action:
   - In directory card "..." menus, send a request to open (or reuse) a terminal shell with CWD set to that directory.
   - **References:** `notes/2025-11-16_TERMINAL_CWD_FIX.md`, `notes/2025-11-16_TERMINAL_LIFECYCLE_FIX.md`, `runtime_paths/framework_startup_to_file_editor_cm6.md` (lines 76-79: project_root state)
5. Add "Make executable" action (VERY IMPORTANT):
   - In file card "..." menus, add action that sets the executable bit (preserving other mode bits) via backend helper.
   - **References:** `notes/2025-11-17_PERMISSION_PRESERVATION_IMPLEMENTATION.md`, `runtime_paths/framework_startup_to_file_editor_cm6.md` (lines 111-123: file operations)
6. Git jobs progress (least important):
   - Use framework jobs library to track clone/pull/push operations and expose their status to explorer.
   - Show a slim progress bar sitting on top of the explorer footer border; only visible while a job is active.
   - **References:** `notes/2025-11-16_EXPLORER_REWRITE_PROGRESS_LOG.md`
7. "Mention file in agent drawer" (least least important):
   - Add "Mention in agent drawer" to file/dir card "..." menus; action prepends a message like `user mentioned:<file_or_dir_path>` into the agent drawer for that path.
   - **References:** `notes/2025-11-16_EXPLORER_REWRITE_PROGRESS_LOG.md`

#### Editor
8. ~~Fix indentation guide spacing when inline diff gutter is enabled~~:
   - **Status:** ✅ Completed 2025-11-19. Deletion widgets now show "−" markers in diff gutter using CM6's `widgetMarker` option on custom gutters.
   - Indentation guides display correctly alongside diff markers ("+", "−", "│") without spacing issues.
   - Solution uses official CM6 architecture - no hacks, overlays, or manual positioning required.
   - **References:** `notes/NICEGUI_VENDORING_JOURNEY.md` (2025-11-19 entry), `docs/core/nicegui_iframe_feature_adding_guideline.md` (new lesson on widget markers)
9. Add remote branch checkout to Branch menu:
   - Extend menubar Branch menu to list remote branches and allow checking them out (likely via new git helper + endpoint).
   - **References:** `notes/2025-11-16_EXPLORER_REWRITE_PROGRESS_LOG.md` (git operations)
10. Import CSS color picker npm module for CodeMirror (VERY IMPORTANT):
    - Vendor a CM-compatible CSS color picker extension, bundle via the existing CodeMirror build, and expose a toggle/feature in the editor (e.g., color swatches or in-place picker for CSS color literals).
    - **References:** `notes/NICEGUI_VENDORING_JOURNEY.md`, `notes/2025-11-17_INDENTATION_GUIDES_IMPLEMENTATION.md` (similar bundling pattern), `docs/core/nicegui_iframe_feature_adding_guideline.md` (lines 957-1051: adding/verifying CM6 packages)

#### Agent Drawer
11. Fix Agent Drawer mobile layout (transcript/chat only):
    - Fix the transcript box and chat input layout/behavior on mobile where they currently misbehave in some browsers/implementations.
    - The drawer itself is a full-screen overlay on mobile and is fine; focus is on making the transcript scroll region and chat box usable and stable.
    - **References:** `notes/2025-11-13_RESPONSIVE_LAYOUT_INVESTIGATION.md`, `notes/2025-11-17_EXPLORER_SEARCH_FIXES.md` (mobile keyboard handling)

12. After each item ships, update this file with completion date + commit hash so roadmap stays current.
