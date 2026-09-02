# Terminal Input, Lifecycle, And Drawer Transport Plan

Status: implementation in progress; Phases 1-4 source complete and live accepted
Created: 2026-09-02

## Outcome

Make the standalone Terminal and Code TE2 terminal drawer responsive,
lossless, event-driven, and multi-client safe.

The completed slice must:

- preserve the first Gboard composition character after xterm clears its helper
  textarea at a shell prompt boundary;
- prevent Gboard's post-composition key echo from duplicating printable input;
- remove terminal control, shell-list, and history HTTP requests from the Code
  TE2 frontend;
- replace Code TE2's raw ANSI history replay with a canonical, bounded Pyte
  screen/scrollback checkpoint plus exactly ordered live output;
- project standalone shell membership to every connected client immediately
  after create, exit, restart, or removal;
- keep the selected standalone terminal local to each browser client;
- provide the requested two-row standalone mobile key layout with composable
  modifiers; and
- keep the durable terminal documentation aligned with the implemented
  transport and lifetime rules.

## Scope

### Standalone Terminal

Primary source:

- `worktrees/xterm-te2/src/browser/input/AndroidInputTransaction.ts`
- `app/apps/terminal/src/main.ts`
- `app/apps/terminal/template.html`
- `app/apps/terminal/backend.py`
- `app/apps/terminal/terminal_stream_broker.mjs`
- `app/apps/terminal/manifest.json`
- new app-owned Socket.IO route configuration

The existing raw MessagePack WebSocket and Node broker remain the PTY byte
stream. A low-frequency app-owned Socket.IO lane will own shell-list snapshots
and lifecycle commands.

### Code TE2 Terminal Drawer

Primary source:

- `app/apps/code_te2/main_page/frontend/host-terminal-drawer.ts`
- `app/apps/code_te2/terminal_backend.py`
- `app/apps/code_te2/terminal_screen_projection.py`
- `app/apps/code_te2/terminal_shell.py`
- the existing Code TE2 `/terminal` Socket.IO namespace
- the existing event-driven Framework-Shells lifecycle bridge

The drawer keeps its current FWS PTY implementation. This slice does not move
the drawer onto the standalone Node broker.

### Documentation

- `docs/apps/terminal/terminal_app.md`
- `docs/apps/code_te2/CODE_TE2.md`
- `.repo_memory.md`

## Non-Goals

- No polling timer.
- No HTTP fallback for terminal control, list, or history messaging.
- No replacement of Framework-Shells as process authority.
- No shared cross-client foreground terminal for the standalone app.
- No Android native source change unless later evidence establishes a native
  prerequisite and that scope receives separate approval.
- No unrelated Monaco input or Code TE2 editor behavior change.

## Source-Backed Baseline

### First-character loss

A live event probe isolated the failure to a prompt-boundary Android IME
transaction, not terminal connection or listener readiness:

1. Enter emits `"\r"` through xterm and xterm clears its helper textarea.
2. In the failing Gboard state, the next character begins with `keydown` code
   `229` and composition input without an intervening ordinary keydown.
3. `AndroidInputTransaction.keydown(229)` previously returned without restoring
   the guarded textarea projection.
4. Gboard inserted the first character into a bare textarea. The transaction
   rejected that unguarded value, reseeded the guard, and emitted no xterm data.

The preceding successful samples began with the guarded projection and emitted
the character normally. The correction therefore belongs in the patched xterm
`AndroidInputTransaction`: restore its current guarded projection on key code
229 when xterm has cleared the textarea. No connection, queueing, or backend
change is part of this defect fix.

A later regression probe captured the same bare-textarea rejection through an
ordinary printable keydown rather than key code 229. Enter emitted `"\r"` and
cleared the textarea; the next `h` arrived as key code 72, native input changed
the bare value to `"h"`, and no xterm data event followed. The durable invariant
is therefore broader: Enter/Control-C must reseed immediately after their clear,
and every Android printable keydown must repair a missing guard before yielding
to native input.

A second live probe captured a separate stuck-composition failure after a
space. Gboard produced one cumulative textarea value containing `"-"`, then
echoed that commit as a printable `keydown`/`keypress`/`insertText` sequence.
The Android transaction emitted the pending textarea delta while xterm's
upstream cross-browser `keypress` fallback emitted the same dash again. The
frontend batched those two xterm data events into one outbound `"--"` frame.

Monaco avoids this class of duplication because its Android path treats native
textarea input as the only printable-text authority. The xterm fork now adopts
the same ownership split: printable letters, spaces, punctuation, and composed
text flow only through the cumulative textarea projection; keydown remains the
authority for Enter, Backspace, navigation, modifiers, shortcuts, and other
non-text terminal keys. The upstream keypress fallback remains enabled for
non-Android and screen-reader paths.

### Code TE2 drawer latency

A live localhost sample on 2026-09-02 measured:

| Operation | Elapsed |
|---|---:|
| `GET .../terminal/shells` | 4.38 s |
| active shell describe | 1.13 s |
| `GET .../history?tail=2000` | 0.82 s |

The current activation flow performs a shell-list request before Socket.IO
registration, builds another list during backend registration, refreshes the
list again after `terminal:shell_id`, and only then requests history. Live
console evidence showed 10-19 seconds between Socket.IO connect and terminal
history/startup readiness.

The slow list is produced by sequential `mgr.get_shell()` calls over every
sidecar shell id. It is metadata scanning, not PTY startup.

### Standalone list and active-card state

- `listShells()` is called at boot, after local mutations, on exit, or by the
  manual Refresh button. Another client does not receive a push when membership
  changes.
- The current live Terminal had one attached xterm and two shell cards, but
  neither card had `.active`.
- `renderShellList()` understands `state.activeId`, but initial/sidebar
  selection mutates `activeId` after the list render and does not rerender.
  Direct card clicks add a temporary class imperatively.

### Documentation drift

`docs/apps/terminal/terminal_app.md` still describes removed JSON-RPC/JSONL and
shellspec paths. Current source uses strict binary MessagePack browser frames,
length-prefixed MessagePack FWS pipe frames, `node_terminal_stream.yaml`, and a
Node-owned checkpoint/sequence stream.

## Required Invariants

1. The standalone Node broker remains the authority for PTY process state,
   headless xterm state, sequence numbers, and checkpoints.
2. The standalone raw WebSocket remains strict `msgpack-v1`, one object per
   browser frame. There is no JSON/base64 stream fallback.
3. Terminal control and lifecycle messaging uses sockets only. Frontends do not
   call terminal REST endpoints for list, create, activate, title, action,
   removal, or history.
4. Shell membership is backend/FWS authority. A connected client receives one
   complete authoritative snapshot on connect and new complete snapshots after
   lifecycle changes.
5. Standalone `activeId` is client-local presentation state. A client selecting
   terminal A must not move another client from terminal B.
6. No periodic refresh exists. Reconnect snapshots and FWS lifecycle events
   repair missed notifications.
7. Terminal output/history hydration does not wait for shell-list decoration
   work.
8. Code TE2 historical terminal state is reconstructed by a headless terminal
   parser, not by replaying an arbitrary raw-log tail into browser xterm.
9. FWS output notifications wake the projection, but the flushed stdout log and
   its monotonically consumed byte offset are the exact output-order authority.

## Phase 1: Android Printable-Input Ownership

Patch the maintained xterm source so a Gboard composition transaction can
begin immediately after xterm's ordinary Enter path clears the helper textarea:

- preserve the transaction's existing internal projection;
- on key code `229`, validate the actual helper textarea projection;
- after Enter or Ctrl+C clears the helper, immediately reset the Android
  transaction;
- before yielding an ordinary printable keydown, restore the current projection
  if the helper is unguarded;
- restore the current guarded projection only when the textarea is unguarded;
- route unmodified printable key events through native textarea input;
- bypass xterm's upstream keypress emission while Android custom mode owns
  printable text;
- preserve non-text and modified keydown handling; and
- publish the resulting generated `lib/xterm.js` to TE2's vendored xterm asset.

This phase deliberately makes no terminal connection, listener-order,
queueing, Socket.IO, or backend change.

### Tests

Add a focused `AndroidInputTransaction` regression that reproduces:

- an active Android transaction;
- xterm clearing the helper textarea after Enter;
- key code `229` or ordinary printable keydown beginning the next Gboard input;
- guarded projection restoration before browser insertion; and
- exactly one first character reaching xterm.

Also cover ordinary printable textarea ownership and the captured
post-composition `keydown`/`keypress` echo, proving it produces exactly one
terminal character while the Terminal-level keypress path emits nothing in
Android custom mode.

Run the full xterm TypeScript build, package the UMD artifact, run the complete
Android transaction unit file, and validate the standalone Terminal frontend
and broker tests. Live Gecko acceptance is a separate boundary because the
Android client serves its versioned APK/OTA asset rather than the current
server copy; this slice was accepted after force-loading the rebuilt
same-version asset without advancing release versions.

## Phase 2: Standalone Multi-Client Lifecycle Lane

### Transport

Add a Terminal-owned Socket.IO app-worker route:

- public path: `/api/app/terminal/socket.io`
- namespace: `/terminal`
- upstream path: `/socket.io/`
- websocket-only client transport
- strict `msgpack-v1` application payloads with no JSON fallback

The route is declared by the Terminal manifest and its own `sio_service.json`.
It is independent of Code TE2's `/terminal` namespace.

### Server projections

The backend maintains a compact in-memory fact set for shell records whose
labels belong to the standalone Terminal. It is initialized by one
`fws.dashboard.open` snapshot after the FWS Socket.IO connection, then updated
only from:

- `fws.shell.created`
- `fws.shell.spawned`
- `fws.shell.updated`
- `fws.shell.exited`
- `fws.shell.removed`

The frontend receives complete revisioned snapshots rather than applying an
unbounded delta log. Reconnect always emits the latest snapshot.

### Commands

The control lane owns create, stop, kill, restart, remove, and explicit list
refresh commands. Successful mutations update the fact set and publish one new
snapshot to every connected client. A manual Refresh control, if retained,
requests a fresh socket snapshot; it does not issue HTTP.

The per-shell raw MessagePack connection continues to own attach, PTY input,
resize, destroy, checkpoint, output, exit, and ping/pong stream semantics.

### Multi-client acceptance

With clients A and B connected:

1. A creates a terminal while B is displaying either its list or another
   terminal.
2. B receives the new list revision without reload, polling, or opening its
   drawer.
3. A selecting the new terminal does not alter B's selected terminal.
4. Exit/removal is reflected on both clients through one lifecycle projection.

## Phase 3: Remove Code TE2 Terminal HTTP Messaging

### Socket command surface

Extend the existing Code TE2 `/terminal` namespace so the drawer uses it for:

- shell-list snapshot request/resync;
- create;
- activate;
- title update;
- destroy/remove;
- history/bootstrap; and
- existing input, resize, output, close, and rebind operations.

Control requests use correlated Socket.IO acknowledgements or request ids.
Input and resize remain fire-and-forget only while the client is connected.
There is no REST fallback.

### Critical-path ordering

`terminal:register` must:

1. resolve and bind the requested shell;
2. emit the exact shell id immediately;
3. begin/retain the output subscription;
4. send correlated history/bootstrap independently; and
5. publish shell-list metadata independently.

The renderer may display a terminal as soon as shell identity and history are
ready. Shell-list metadata must never gate PTY input or output.

### Event-retained shell facts

Generalize the existing Code TE2 FWS lifecycle bridge so terminal shell facts
are initialized from its one reconnect snapshot and maintained from lifecycle
events. Build project shell-list projections from:

- `ProjectSidecar` membership and titles; and
- retained FWS status/pid/label facts.

Do not run sequential `mgr.get_shell()` scans for every menu render or register.
An exact command may validate its one target shell before mutation.

### Frontend removal target

After this phase, `host-terminal-drawer.ts` must have no terminal API `fetch()`
calls. Asset loading remains ordinary browser resource loading and is outside
this messaging rule.

### Implemented result

The drawer now performs list, create, activate, title, remove/destroy, and
history/bootstrap work on the existing `/terminal` Socket.IO lane. Registration
and correlated commands use reliable emits; high-frequency input and resize
remain volatile. Disconnect rejects pending commands and clears Socket.IO's
send buffer so stale control intent cannot replay.

Registration emits `terminal:shell_id` with a bind generation before starting
the off-loop history read or shell-list projection. Live output is bounded and
buffered only until matching history arrives; history for an obsolete shell or
generation is discarded.

The frontend finalizes identity, generation, xterm reset, and pending-output
state synchronously. Cache-busted mobile helper rebinding starts only afterward
and is not awaited, so history cannot flash and then be erased by a late reset.

The existing Code TE2 FWS lifecycle connection now retains compact terminal
facts from one reconnect snapshot plus lifecycle events. Shell-list rendering
joins those facts with `ProjectSidecar` membership, titles, and active identity,
so menu/register paths no longer perform a manager lookup for every shell.
Exact create, activate, history fallback, and destroy operations may still
inspect their one target. Compatibility REST handlers delegate to the same
backend operations, but the drawer frontend no longer calls them.

## Phase 3.5: Code TE2 Headless Screen And Scrollback Projection

Replace raw terminal-history replay with one bounded Python-owned headless
projection per retained Code TE2 terminal shell:

- declare exact `pyte==0.8.2` runtime ownership;
- use `pyte.HistoryScreen` with the existing 5,000-line scrollback limit;
- feed raw stdout bytes through `pyte.ByteStream` so split UTF-8 input remains
  incremental and replacement does not occur at arbitrary log-read boundaries;
- initialize the screen from the complete raw stdout log off the asyncio loop,
  reading it incrementally so history size does not become process memory;
- retain only the five project-authorized terminal projections and discard a
  projection when its shell is removed;
- resize the projection whenever the PTY resize action succeeds; and
- rebuild if the stdout log inode changes or its size moves behind the consumed
  byte offset.

The FWS `fws.logs.chunk` event remains the event-driven notification source, but
its decoded text is not terminal authority. Each notification causes the
projection to consume bytes from its last exact raw-log offset to the current
flushed end. This makes repeated notifications harmless and removes the
bootstrap race without polling or a textual overlap heuristic.

History/bootstrap emits an ANSI checkpoint synthesized from Pyte's retained
styled cells, scrollback, cursor position, and cursor visibility, together with
the exact stdout byte offset represented by that checkpoint. Live output emits
raw bytes with exact start/end offsets. The browser buffers those records until
the matching bind-generation checkpoint arrives, drops records already covered
by the checkpoint, trims only an exact byte-prefix crossing its offset, and then
writes the remaining `Uint8Array` values to xterm.

This is deliberately analogous to the standalone Terminal's headless-xterm
checkpoint/live-delta split while leaving Framework-Shells as Code TE2's PTY
owner. There is no raw-tail replay fallback.

### ANSI replay acceptance

Focused tests must prove that a checkpoint preserves:

- carriage-return progress and prompt redraws;
- erase-line and cursor-position sequences;
- basic, bright, 256-color, and true-color SGR runs;
- bold, italic, underline, strike, reverse, and blink attributes;
- split UTF-8 input across log growth reads;
- bounded scrollback and the exact visible cursor; and
- live bytes that arrive before, during, and after checkpoint generation exactly
  once.

Unsupported xterm-private sequences must be explicitly characterized by tests;
they must not silently reactivate raw historical replay.

## Phase 4: Standalone Two-Row Mobile Keys

Render the exact layout:

```text
ESC  ≡        -     HOME  ↑     END    PGUP
TAB  CTRL     ALT   LEFT  DOWN  RIGHT  PGDN
```

Behavior:

- `≡` opens the shell-list drawer and does not write PTY input. Its reveal path
  suppresses pointer completion over newly exposed drawer controls for one
  short transition-bounded interval; ordinary header-menu opens are immediate.
- Navigation and `-` dispatch synthetic keydown/keyup through xterm's active
  helper textarea so xterm remains escape-sequence authority.
- Ctrl and Alt have independent visible states and can be armed together.
- A non-modifier key receives the combined modifier state and consumes only
  one-shot modifiers.
- Reuse the proven Code TE2 synthetic-key shape, including explicit `keyCode`
  and `which`, instead of hard-coding separate modified escape sequences.
- Soft-key pointer handling prevents focus theft and refocuses only the current
  terminal textarea.
- The list surface shared by the initial screen and minibar has a client-local
  `Show exited` checkbox. It defaults off, is not persisted or broadcast, and
  filters only rendering rather than lifecycle authority.

The implementation may factor a small shared synthetic-key utility, but the
standalone Terminal must not depend on Code TE2 frontend state or sockets.

The standalone Python transport boundaries must also remain strict-analysis
clean. Untyped Socket.IO, JSON, MessagePack, and binary framing values are
adapted to local protocols or decoded as `object`, then validated before use;
transport payloads must not propagate inferred `Any` into lifecycle state.

## Phase 5: Client-Local Active Card

- Render card activity solely from standalone `state.activeId`.
- Rerender after initial/sidebar restore, local selection, lifecycle snapshot,
  active-shell exit, and removal.
- Remove the click-only imperative class patch.
- Add `aria-current="true"` and a visually unambiguous active treatment using a
  stronger border/background/accent than hover.
- Preserve a different active card independently in every client.

## Phase 6: Terminal Latency Findings And Optimization

Keep the Node `node-pty` and headless-xterm broker for this release. A Rust PTY
broker or framework-owned callable PTY service is a separate architectural
project, not an optimization shortcut for this release.

Measure the existing boundaries independently before changing them:

- standalone lifecycle socket connect to authoritative snapshot;
- standalone create request to shell fact publication;
- raw PTY attach to checkpoint application and writable state;
- Code TE2 drawer open to shell identity, history/bootstrap, and writable
  state; and
- first-use Node runtime verification/install separately from warm starts.

Use monotonic correlation timestamps and existing runtime logs or bounded debug
instrumentation. Do not infer a Node, Python, FWS, font/helper, checkpoint, or
renderer bottleneck from total elapsed time alone.

Optimize only the measured critical path. Likely candidates include redundant
manager metadata reads, serial shell-list decoration, helper/font loading that
gates input readiness, checkpoint serialization, and Code TE2 history/bootstrap
ordering. Preserve event-driven state, strict MessagePack transports, and the
current Node broker ownership. No polling or silent fallback is permitted.

Acceptance targets:

- existing standalone and drawer shells become writable in under one second on
  localhost after their frontend surface is ready;
- noncritical shell-list decoration may settle after PTY readiness;
- warm shell opens perform no dependency installation or global shell scan; and
- before/after traces identify the exact reduced boundary.

## Validation

### Standalone Terminal

```bash
cd app/apps/terminal
npm run typecheck
npm test
npm run build
cd ../../..
basedpyright app/apps/terminal
```

Add focused frontend and backend protocol tests for input ordering, strict
codec handling, lifecycle snapshots, reconnect, cross-client fanout, and
client-local selection.

### Code TE2

```bash
cd app/apps/code_te2
npm run typecheck
node build.mjs
```

Add tests that reject terminal HTTP messaging in the drawer source and exercise
the Socket.IO command/bootstrap protocol, retained FWS facts, project switch,
stale-bind rejection, Pyte screen serialization, byte-offset ordering, and log
replacement/truncation recovery.

### Live acceptance

- Reproduce the exact Gboard state across at least 20 new prompt boundaries:
  press Enter, type the first character through composition, and verify no first
  character is lost.
- With Gboard held in the faulty composition state, type a space followed by one
  dash repeatedly and verify each gesture produces exactly one dash in both the
  standalone Terminal and Code TE2 terminal drawer.
- Confirm Gboard composition, Ctrl, Alt, combined modifiers, navigation, paste,
  Enter, and reconnect behavior.
- Open the Code TE2 terminal drawer with existing and new shells and record
  connect-to-ready latency. Target sub-second localhost readiness for an
  existing shell; shell-list decoration may settle afterward.
- Verify no terminal control/history HTTP request appears in browser network
  traffic.
- Verify cross-client create/exit/remove updates without polling.

## Documentation Completion

Implementation is not complete until:

- `docs/apps/terminal/terminal_app.md` describes the actual Node shellspec,
  MessagePack stream, lifecycle Socket.IO lane, input readiness, and client
  selection ownership;
- `docs/apps/code_te2/CODE_TE2.md` describes the drawer's socket-only bootstrap,
  terminal FWS facts, and latency boundary; and
- `.repo_memory.md` contains only the condensed durable invariants, with deeper
  protocol detail delegated to the two technical documents.
