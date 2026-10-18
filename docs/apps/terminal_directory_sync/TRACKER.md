# File Explorer directory-sync tracker

- [x] Read-only live inspection approved and captured.
- [x] Identify latched dirty-input state after erasure; Bash is idle.
- [x] User approves minimal zero-character correction, not a two-character
  clean threshold or additional Readline machinery.
- [x] Create maintenance/file-explorer-directory-sync from b5402cf0; preserve
  unrelated CTAG deletion, notes.md and ty.toml.
- [x] Implement bounded known-input tracking and reuse existing wake path.
  Only an integer length is retained. Erasure reaches clean at zero, not one or
  two characters. Pending wakes resume after erasure is queued, with later input
  held by the existing fence. Unknown edits stay conservative.
- [x] Unit and disposable-PTY regressions, including partial/busy/unknown input.
  All 12 directory-control tests pass, including 12 rapid clear/wake cycles,
  Ctrl-C cancellation, no accidental listing/command execution, busy builtins
  and children, late-idle protection and real Starship prompt refresh.
  Node syntax check and git diff --check pass. No live PTY was signalled/replaced.
- [x] Update terminal contract and durable repo memory after verified results.
  Node-only source change: no frontend build/OTA or Code TE2 mypyc rebuild.
  Existing broker processes retain their imported module; use a fresh File
  Explorer terminal for live validation. No framework restart is needed.
- [ ] Separately approve live activation/acceptance; do not disturb current PTY.
- [ ] Checkpoint commit/push only when requested.
