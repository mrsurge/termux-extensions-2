# Project To‑Do (root)

## Code CM6 — Git Functionality Expansion

- [ ] Branch / checkout controls
  - Right-aligned branch dropdown listing local and remote branches with current ref highlighted.
  - Branch management actions: checkout, create from HEAD, track remote ref on first checkout.
  - Commit pointer navigation via either a companion dropdown beside the branch selector or an explorer widget showing recent commits and enabling quick checkout/reset.
  - Route all git mutations through backend helpers (extend `diff_helper.py` or a new `git_helper.py`) to keep diff/explorer caches consistent.
  - Progress 2025-10-29: Toolbar branch menu renders local/remote refs, supports creation/tracking, and reuses `git_helper.py` APIs.
- [ ] Commit / push workflow
  - Explorer staging toggles for files/directories, plus diff preview before staging.
  - Commit dialog with subject/body, staged summary, validation for empty staging.
  - Push/Pull affordances with progress feedback; handle conflicts and surface errors.
  - Persist git command logs somewhere user-visible (toast + log panel/terminal feed).
  - Progress 2025-10-29: Explorer nodes expose stage/unstage toggles; commit modal surfaces staged/unstaged summary, autosaves amend flag, and buttons drive Git API (push/pull pending advanced feedback/log view).
- [ ] Explorer enhancements
  - Create file/folder actions with name prompts and git-aware staging defaults.
  - Delete/remove flow with confirmation; offer “delete & stage removal” for tracked files.
  - Rename/move support that updates git status and explorer metadata.
  - Auto-refresh git caches and inline diff metadata after each mutation.
  - Progress 2025-10-29: Drawer toolbar enables create/rename/delete with staging defaults and auto-refresh via git events (git diff preview still outstanding).

## Code CM6 — Agent Ops / Assistant Drawer

- [ ] Unified agent drawer architecture with collapse/fullscreen, persistent session restore, and a defined JSON-RPC API between UI and agents.
- [ ] Codex CLI integration: launch in app-server mode via framework shells, bridge STDIO JSON-RPC to drawer websocket, expose controls for start/stop/reset and logging.
- [ ] Gemini CLI integration: support streaming JSON and STDIO, share config with `termux_llm`, implement buffering/back-pressure.
- [ ] Agent/sub-agent collaboration overlays: CM6 decorations marking agent edits, stored attribution metadata, toggleable visibility.
- [ ] Open Interpreter / termux_llm synergy: allow multi-model orchestration, provide safety rails and cancellation paths for runaway tasks.
- [ ] Telemetry & persistence: disk-backed transcripts/config, export/import, lightweight latency/token counters in the drawer header.

## Documentation Organization

- [x] Create doc subdirectories (`docs/core/`, `docs/apps/code_cm6/`, `docs/apps/legacy/`, `docs/howto/`, `docs/planning/`).
- [x] Move existing markdown into the new folders without disturbing root to-do files.
- [x] Update cross-references (README, app docs) to new paths.
- [x] Add index files (`docs/README.md` + per-folder readme) summarizing contents.
- [x] Document the structure so future contributors follow the same layout.
