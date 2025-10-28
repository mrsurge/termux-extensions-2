# code_cm6 — Active TODO List

**For complete technical documentation, see [CODE_CM6_DOCUMENTATION.md](CODE_CM6_DOCUMENTATION.md)**

---

## Completed ✅

- [x] **Real-time inline Git diffs** — Implemented via WebSocket `diff_changed` events. Diffs update instantly when `core_read.py` detects file changes or `core_write.py` completes saves. No more polling! _(Oct 28, 2025)_
- [x] **Embedded terminal drawer** — xterm.js terminal with PTY streaming, session persistence, 2000-line history replay, fullscreen mode, and drag-to-resize. _(Oct 28, 2025)_
- [x] **Open Files tab (Recent History) wiring** — Reconnected to disk-backed history store with sync events.
- [x] **On-disk preference saving** — Theme/View/Autosave toggles persist via `preferences_store.py`.
- [x] **Drawer Git/filetype styling** — Explorer shows git status, executable flags, and symlink indicators.

---

## In Progress 🚧

_(None)_

---

## Backlog 📋

- [ ] **DESTROY select mode** - Complete removal of Android selection mode. No fallbacks, no more dual-surface complexity.
- [ ] **Utility drawer (right panel)** – Collapsible right-side drawer for terminal bridge and future agent output panels.
- [ ] **Framework-wide WebSocket bus** – Shared multiplexed WebSocket connection for diffs, git status, and collaboration messages across all apps.
- [ ] **Symbol navigation** – Jump to definition via language server protocol (LSP).
- [ ] **Find/Replace across files** – Cross-file search using git grep or ripgrep.
- [ ] **Git blame annotations** – Inline author/date information for each line.
- [ ] **Syntax error hints** – Real-time linting via LSP integration.
- [ ] **Collaborative editing** – Multi-cursor support via operational transforms or CRDTs.

---

**Last Updated**: October 28, 2025
