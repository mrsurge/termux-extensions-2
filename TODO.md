# Project To‑Do (root)

## Code CM6 — Git Functionality Expansion

- [x] Branch / checkout controls
  - [x] Right-aligned branch dropdown listing local branches with current ref highlighted.
  - [x] Branch management actions: checkout existing branch and create/track a new branch from the dropdown.
  - [ ] Commit pointer navigation via either a companion dropdown beside the branch selector or an explorer widget showing recent commits and enabling quick checkout/reset.
  - [x] Route all git mutations through backend helpers (`git_helper.py`) to keep diff/explorer caches consistent.
  - Progress 2025-10-29: Toolbar branch menu renders local refs, supports creation/checkout, and reuses `git_helper.py` APIs. Commit pointer UI still pending.
- [ ] Commit / push workflow
  - [x] Explorer staging toggles and global Stage/Unstage buttons.
  - [x] Commit dialog with subject prompt, staged summary, and validation for empty staging.
  - [x] Push/Pull affordances with toast feedback; backend surfaces errors to the footer.
  - [ ] Persist git command logs somewhere user-visible (toast + log panel/terminal feed).
  - Progress 2025-10-29: Drawer footer exposes Stage/Unstage/Commit/Push/Pull; logging surface still to come.
- [ ] Explorer enhancements
  - [x] Create file/folder actions with name prompts and git-aware staging defaults.
  - [x] Delete/remove flow with confirmation; offer “delete & stage removal” for tracked files.
  - [x] Rename/move support that updates git status and explorer metadata.
  - [ ] Auto-refresh git caches and inline diff metadata after each mutation (diff preview TBD).
  - Progress 2025-10-29: Drawer toolbar + footer cover create/rename/delete and auto-refresh status; inline diff preview still outstanding.

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
