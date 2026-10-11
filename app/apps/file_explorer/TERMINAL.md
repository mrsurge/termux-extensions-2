# File Explorer tab terminals

This app is an ordinary Python worker and uses the existing `framework_shells`
Python API. Code TE2's embedded native-worker boundary is not a requirement for
other workers. The app-owned `shellspec/terminal.yaml` launches an interactive
PTY through `Orchestrator.start_from_ref`; Framework-Shells owns PTY execution,
input, resize, output logs and removal. `TERM=xterm-256color` is explicit.

`terminal_service.py` lazy-loads the manager/orchestrator only for terminal work.
It does not import Code TE2's terminal backend or use its process/project state.
The shared `app.libs.terminal_runtime` Pyte core consumes raw logs through File
Explorer's explicit Python reader. That reader is this app's normal boundary,
not a fallback for native Code TE2 failures.

The existing `/tabs` request lane exposes `terminal.start`, `terminal.status`,
`terminal.close`, `terminal.input`, `terminal.resize`, and `terminal.checkpoint`.
Requests carry `tabId` and current `revision` and require an attached presentation.
Input also carries bounded UTF-8 `data`; resize/checkpoint accept bounded
`columns` and `rows`. Checkpoints preserve ANSI, pending bytes and raw-log offsets.

`tabs.json` owns the associated `shellId`. Start is explicit and serialized under
the tab service lock; a repeated start reuses the associated controllable shell.
Exact `file-explorer-terminal:<tab-id>` label and manager capabilities are checked
before control. Running-but-uncontrolled shells fail closed instead of creating a
duplicate or claiming ownership. Confirmed missing/exited records disassociate
on attach/status; restoring a tab does not start a replacement terminal.

Streaming uses the existing signature-checked `load_shell_record` and
`get_shell_capabilities`, not `get_shell` (full-runtime adoption) or `describe`
(process statistics). Full discovery remains appropriate only to explicit new
session/recovery work. Frontend input is bounded to 64 KiB pending UTF-8 and
coalesces queued keystrokes into ordered requests of at most 4 KiB, with one ACK
in flight; failure/disconnect/tab change discards unsent input, never replays it.

Presentation disconnect/hide retains the shell. Explicit terminal close uses
manager removal before clearing its durable association; tab close refuses
an associated shell unless the user confirms `closeTerminal: true`. Failed persistence
after a new launch cleans that exact child. No uncertain mutation is replayed.

The lazy process-local Framework-Shells event subscription treats output events
only as wakeups: shared Pyte consumes raw log bytes and emits offset-checked binary
`terminal_output` events to the exact tab room. Reset/gap recovery requests a
checkpoint; confirmed exit/removal clears the association and updates attached
clients/catalogs. ASGI shutdown unsubscribes without killing retained shells.

`terminal_drawer.ts` builds through `app/apps/terminal/build.mjs` into the existing
inventoried `/static/js/file_explorer_terminal.js` root. It lazily reuses vendored
custom xterm, Fit/WebFonts addons, touch selection, JetBrains Mono and the
Terminal app's mobile-UA key helpers. Start/Show, Minimize/Restore, Maximize/Restore
and confirmed Close are explicit controls. Desktop user agents never show extra
keys.
Mobile keys retain Terminal's two rows of seven, default-visible Keys toggle,
pointer-down dispatch, Ctrl double-tap lock, one-shot modifiers and shared arrow
hold-repeat timings. The minibar opens the existing Tabs menu with the shared
reveal guard. The mobile footer is an in-flow final child below the drawer;
it alone owns the bottom safe-area inset, so it cannot cover the key dock.
Tab and terminal mutations share the same frontend serial lane; disconnect
rejects queued input rather than replaying it. Checkpoint handoff buffers at most
64 frames/1 MiB and accepts only contiguous raw offsets after the checkpoint.
Async mounts/checkpoints are tab/shell/generation fenced; association-only updates
do not refetch the directory. Explicit close stops the terminal for all attached
presentations, while minimize, tab switch, reload and detach retain it.

Directory-lock injection and physical multi-client acceptance remain deferred.
No claim is made that a Python-worker restart can recover a PTY without manager
capabilities. To test this source, refresh only the File Explorer worker through
the approved app lifecycle, then publish the frontend via native OTA (or browser
reload). A Code TE2 mypyc rebuild is not needed for this ordinary Python worker.
