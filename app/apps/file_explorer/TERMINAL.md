# File Explorer tab terminals

This app is an ordinary Python worker and uses the existing `framework_shells`
Python API. Code TE2's embedded native-worker boundary is not a requirement for
other workers. It launches the existing Terminal `node_terminal_stream.yaml`
pipe shell through `Orchestrator.start_from_ref`. Node owns node-pty,
headless-xterm, sequence assignment and checkpoints; Framework-Shells owns the
broker process and live pipe. `TERM=xterm-256color` is explicit.

`terminal_service.py` lazy-loads the manager/orchestrator only for terminal work.
It does not import Code TE2's terminal backend or use its process/project state.
`terminal_broker.py` reuses Terminal's bounded MessagePack pipe framing and the
owning manager's byte subscription/stdin. It does not import Terminal's FastAPI
backend or replay log files. Locked production Node dependencies are resolved
through Terminal's existing runtime helper.

The existing `/tabs` request lane exposes `terminal.start`, `terminal.status`,
`terminal.close`, `terminal.input`, `terminal.resize`, and `terminal.checkpoint`.
Requests carry `tabId` and current `revision` and require an attached presentation.
Input also carries bounded UTF-8 `data`; resize/checkpoint accept bounded
`columns` and `rows`. Checkpoints use Node's serialized ANSI state. The Python
adapter projects session-local byte offsets for the retained frontend cursor;
these are not durable raw-log offsets. Broker sequences detect stream gaps.

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

The single live pipe reader resolves control replies separately from its bounded
event publisher, avoiding deadlock when a checkpoint holds the tab mutation lock.
Output uses the existing binary `terminal_output` Socket.IO event in the exact
tab room. Overflow or a sequence gap requests checkpoint recovery; no log-tail
fallback is allowed. FWS exit/removal clears the association. ASGI shutdown
unsubscribes without killing retained shells. Socket.IO remains the tab/CRUD and
user-command lane; a separate raw WebSocket output lane is explicitly deferred
until this broker integration has live acceptance.

`terminal_drawer.ts` builds through `app/apps/terminal/build.mjs` into the existing
inventoried `/static/js/file_explorer_terminal.js` root. It lazily reuses vendored
custom xterm, Fit/WebFonts addons, touch selection, JetBrains Mono and the
Terminal app's mobile-UA key helpers. Start/Show, Minimize/Restore, Maximize/Restore
and confirmed Close are explicit controls. Desktop user agents never show extra
keys.
The terminal selects `JetBrains Mono Nerd` with the Code TE2 drawer's monospace
fallback stack and WebFonts preload. Its four declared normal/italic/bold/
bold-italic faces reuse the same packaged JetBrains WOFF2 files as the other two
terminals; no new font assets/package are introduced.
The top-edge resize handle uses the existing drawer handle visual language,
pointer capture for touch/mouse and Arrow Up/Down/Home/End keyboard adjustments.
Height is presentation-local for the loaded page; dragging leaves Maximize and
retains the chosen height across Minimize/Restore. Bounds exclude fixed chrome
and reserve 48px of file browsing space. Existing viewport observation owns
debounced terminal resize/checkpoint work, not a new backend path. Tab changes,
disconnect, minimize/maximize and disposal cancel active gesture ownership.
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

## Tab-owned directory tracking

Lock directory defaults on and is stored separately from browsing options in
each durable tab record. Its event-linked checkbox is shared by all presentations
of that tab. No terminal is shared across unrelated tabs. Changing browsing
options, switching/restoring tabs, and reconnecting do not request a directory
change. Only an explicit navigation to a different directory does so while locked.
Unlock cancels any unconsumed request and leaves CWD alone; re-lock only arms
future navigation. A shell action already consumed before unlock cannot be undone.

New terminals enable Terminal's opt-in `shellspec/directory_control.bash` init file.
It sources /etc/profile and the first readable normal login profile, then chains
the user's scalar/array PROMPT_COMMAND while preserving command exit status.
This follows Code Server's approach: login profiles run, but Bash's actual
login_shell flag is off. No real profile is edited. Existing terminals are not
initialized by injecting commands: they report unavailable until explicitly
closed and started anew.

`terminal_control/shell-control-*` under the File Explorer data root contains
private atomic requests and bounded shell-event files (0700/0600). Typed
directory.request/result and shell.state envelopes keep control separate from
terminal output. Bash PS0 publishes busy before execution; the final prompt hook
publishes idle. Clean idle requests use SIGWINCH and a shell-side state recheck,
not injected PTY commands. Busy/partial input defers to the next prompt. Later
input is held at most 64 KiB during the bounded two-second wake; cancellation
flushes held input without replaying a directory mutation. Quoted builtin cd
consumes the latest literal path once. After a clean-idle trap application, the
broker submits only an empty line while holding later user input: Bash re-runs
normal prompt generation (including Starship), rather than retaining Readline's
old expanded prompt or manually drawing PS1. Completion waits for the fresh idle
event. Deferred cd runs before prompt callbacks; bash-preexec uses its existing
precmd callback list as well as the ordinary PROMPT_COMMAND path. No user profile
is edited, and partial/busy input never receives this empty-line refresh.
Existing WINCH traps fail unsupported;
Bash 4.4+ and physical Termux compatibility remain explicit gates. Normal Terminal
launches do not enable this opt-in. Old prompt-only mailbox files are prototype
evidence, not the current runtime path. Explicit Close can remove an old PTY;
it is never silently converted or replaced.

User live acceptance of broker directory tracking and prompt refresh passed on
2026-10-11. Exhaustive multi-client/Termux/trap compatibility remains separate.
No claim is made that a Python-worker restart can recover a pipe without manager
capabilities. To test this source, refresh only the File Explorer worker through
the approved app lifecycle, then publish the frontend via native OTA (or browser
reload). A Code TE2 mypyc rebuild is not needed for this ordinary Python worker.
