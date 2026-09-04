# Terminal App

The Terminal app lives under `app/apps/terminal/` and is now the canonical broker-backed terminal implementation for TE2.

## Overview
- **Backend**: `backend.py` exposes `/api/app/terminal/` and manages pipe-backed terminal shells through framework-shells.
- **Frontend**: `src/main.ts` is bundled to `static/dist/main.js` and provides the shell list, xterm renderer, replay/hydration, reconnect handling, and mobile helper-key support.
- **Shell contract**: browser PTY traffic uses strict one-object-per-frame MessagePack over the raw worker WebSocket. Framework-Shell pipe traffic uses uint32 big-endian length-prefixed MessagePack.
- **Shellspec**: `shellspec/node_terminal_stream.yaml` is the only supported shellspec. Its persistent Node worker owns `node-pty`, headless xterm state, sequence assignment, and reconnect checkpoints.

## Backend Endpoints
These REST routes remain compatibility surfaces. The current frontend does not
use them for application control and has no HTTP fallback. Responses use the
`{ "ok": true, "data": ... }` envelope.

| Method & Path | Purpose |
| --- | --- |
| `GET /api/app/terminal/shells` | List terminal shells owned by this app. |
| `POST /api/app/terminal/shells` | Start a new shell with optional `shell`, `cwd`, `cols`, and `rows`. |
| `GET /api/app/terminal/shells/<id>` | Describe a shell. |
| `POST /api/app/terminal/shells/<id>/input` | Send terminal input through the broker/control path. |
| `POST /api/app/terminal/shells/<id>/resize` | Resize the shell. |
| `POST /api/app/terminal/shells/<id>/action` | `stop`, `kill`, or `restart` the shell. |
| `DELETE /api/app/terminal/shells/<id>` | Remove a shell and its session state. |

## Lifecycle Socket.IO

The Terminal manifest declares `sio_service.json`, which proxies the
websocket-only `/api/app/terminal/socket.io` path to the app worker's
`/socket.io` mount. The logical namespace is `/terminal`.

Every application payload is binary `msgpack-v1`. `terminal_request` carries a
correlated `id`, method, and params; its acknowledgement carries the same id and
either a result or explicit error. `terminal_snapshot` carries a complete shell
list with a worker generation, monotonic revision, and readiness flag.

One FWS `fws.dashboard.open` snapshot establishes the complete list. Thereafter
the backend updates its bounded in-memory facts only from created, spawned,
updated, exited, and removed lifecycle events. Reconnect obtains another full
snapshot; there is no timer or polling loop. Worker generation fencing allows a
long-lived frontend to accept a lower revision after an app-worker restart.

The lane owns shell list/resync, create, stop/kill/restart, removal, and the
Terminal app's Sidebar CWD/state bridge. The selected shell remains local to
each frontend and is never part of the shared lifecycle snapshot.

## WebSocket
The worker WebSocket endpoint is `/ws/terminal`, proxied to the browser as `/ws/app/terminal/terminal`.

The client sends MessagePack objects with `attach`, `input`, `resize`,
`destroy`, and `ping` types. The server sends `checkpoint`, `output`, `exit`,
`error`, and `pong` objects. Binary PTY data stays binary; there is no
JSON/base64 or stdout-log replay fallback.

The Node broker keeps a 5,000-row headless xterm checkpoint plus a monotonic
output sequence. Attach establishes a checkpoint boundary, and output produced
during checkpoint delivery is retained until the browser can apply it in
sequence.

## Frontend Behavior
- xterm is loaded from shared vendored assets under `/static/vendor/xterm/`.
- Reconnects use `reconnecting-websocket`.
- Reconnect requests a fresh broker checkpoint rather than replaying stdout logs.
- Vendored Android helper scripts under `vendor/android-terminalapp-assets-js/` provide Ctrl-key and touch-to-mouse behavior.
- The frontend keeps dead-shell history visible and suppresses unnecessary "Shell is not writable" toasts.
- Shell-card state comes from lifecycle snapshots, while the active card comes
  only from that frontend's local `activeId`. The selected card uses
  `aria-current="true"` and a stronger inset accent independently of its
  running/exited status.

### Mobile soft keys

The standalone Terminal renders two fixed seven-key rows:

```text
ESC  ≡        -     HOME  ↑     END    PGUP
TAB  CTRL     ALT   LEFT  DOWN  RIGHT  PGDN
```

The dock is created only for Android/mobile user agents. A `Keys` control beside
the font-size buttons defaults on and hides or restores the dock for the current
frontend instance. This visibility state is not persisted or shared.

`≡` opens the client-local shell drawer and never sends PTY input. That soft-key
path captures the originating pointer and suppresses interaction with newly
revealed drawer controls for 300 ms, preventing the release/click from selecting
a shell behind the key. The normal header menu button is not delayed. The
remaining action keys dispatch synthetic `keydown` and `keyup` events through
the active xterm helper textarea, including legacy `keyCode` and `which`
values. Xterm therefore remains responsible for application-cursor and
modifier-specific escape sequences; the frontend does not hard-code arrow
bytes.

Plain dash is the exception because Android xterm intentionally suppresses
unmodified printable keydown events. The dash key inserts into the guarded
cumulative textarea and dispatches `insertText`, using the same printable-text
authority as Gboard. Ctrl/Alt-modified dash remains on the synthetic keyboard
path.

Ctrl and Alt are independent. One Ctrl tap arms it for one action, a second tap
within 350 ms locks it, and a locked Ctrl survives subsequent actions until it
is tapped again. Alt is one-shot. A non-modifier soft key receives the combined
Ctrl+Alt state and consumes only one-shot modifiers. Pointer handling prevents
the dock from taking focus and restores the active terminal textarea after each
action.

The four directional keys repeat after a 420 ms hold delay at a 55 ms cadence.
The gesture captures its exact xterm/textarea target and modifier state at
pointer-down, emits once immediately, and consumes one-shot Ctrl/Alt only when
the gesture ends. Pointer release/cancel, lost capture, window blur, document
hiding, or frontend disposal stops repetition. Other action keys remain
single-dispatch controls.

Gboard Ctrl chords do not infer the pressed character from the guarded
textarea during key-code-229 events. The shared helper registers xterm's
source-owned `attachCustomInputEventHandler` hook and translates the final
character in `InputEvent.data` during `beforeinput`. Xterm then cancels the
native insertion, restores its guarded projection, and suppresses any trailing
`input`, so one chord produces exactly one control byte. The hook survives
terminal reset. Monaco does not expose this xterm API and retains its existing
keyboard-event adapter.

The initial list and slide-in minibar are the same DOM surface. Their `Show
exited` checkbox defaults off and exists only in the current frontend's memory;
it neither persists nor changes the lifecycle snapshot shared with other
clients.

The TypeScript frontend is strict, and the Python Socket.IO, JSON, MessagePack,
and binary-frame boundaries validate untrusted values before they enter
lifecycle state. `basedpyright app/apps/terminal` is expected to report zero
errors and zero warnings.

### Android printable input

TE2's xterm fork uses a guarded cumulative helper-textarea projection on
Android. In that mode, native textarea `input` is the sole authority for
printable letters, spaces, punctuation, and composition. Xterm's upstream
`keypress` fallback is bypassed so a Gboard post-composition key echo cannot
duplicate text. Keydown remains authoritative for Enter, Backspace,
navigation, modifiers, shortcuts, and other non-text terminal keys.

After xterm clears its helper textarea for Enter or Ctrl+C, it immediately
resets the Android transaction so the empty guarded projection is restored.
Both key-code-229 composition and ordinary printable keydown also repair a
missing guard before Android inserts text. This prevents the first character at
a new prompt from being discarded. A claimed custom input event resets the same
transaction before returning control to the browser. Non-Android and
screen-reader input retain upstream xterm behavior.

Update this document whenever the terminal app contract, shellspec, or frontend transport changes.
