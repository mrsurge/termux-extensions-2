# Terminal Input Latency Patch Plan

## Goal

Reduce visible terminal typing latency in both:

- the Code CM6 terminal drawer
- the standalone terminal app

This plan is based on read-only code inspection. It does not assume any runtime benchmark data yet.

## Scope

The two affected stacks currently share the same input hot-path shape:

- xterm emits input chunks immediately from the browser
- the frontend sends one `terminal:input` event per chunk
- the backend re-resolves shell state per event
- the backend awaits one `write_to_pty(...)` per event
- the traffic crosses a main-process websocket proxy before it reaches the app worker

Relevant files:

- `app/apps/file_editor_cm6/static/js/terminal.js`
- `app/apps/file_editor_cm6/terminal_backend.py`
- `app/apps/file_editor_cm6/terminal_shell.py`
- `app/apps/file_editor_cm6/services/terminal_transport.py`
- `app/apps/terminal/main.js`
- `app/apps/terminal/terminal_socketio_state.py`
- `app/apps/terminal/backend.py`
- `app/apps/terminal/services/terminal_transport.py`
- `worktrees/framework-shells/framework_shells/manager.py`

## Step A

Compare transport efficiency before patching behavior.

### A.1 Dedicated Main-Process WS Shims

Targets:

- `app/apps/file_editor_cm6/services/terminal_transport.py`
- `app/apps/terminal/services/terminal_transport.py`
- `app/apps/file_editor_cm6/services/editor_transport.py`

Observation:

- All three use the same basic pattern:
  - accept a FastAPI websocket
  - resolve the worker port
  - connect to the worker with `websockets.connect(...)`
  - forward client packets to worker
  - forward worker packets back to client
- None of them do payload rewriting in the hot websocket loop.
- The terminal shims are structurally the same as `editor_transport.py`.
- The Code CM6 terminal drawer is not using a distinct extra main-process proxy path beyond this dedicated terminal shim.

Steady-state forwarding ranking:

1. Tie:
   - `app/apps/file_editor_cm6/services/editor_transport.py`
   - `app/apps/file_editor_cm6/services/terminal_transport.py`
   - `app/apps/terminal/services/terminal_transport.py`

Practical note:

- These three should be treated as effectively tied for steady-state websocket forwarding cost.
- Any measured difference is more likely to come from the app-side protocol and handler work behind them than from the shim code itself.
- `editor_transport.py` is still a weak latency benchmark for terminal planning because its meaningful downstream work leaves the shim immediately and goes into the editor/WBA path rather than a PTY path.

### A.2 Shared Proxy-Shell System

Targets:

- `app/extensions/apps/proxy_shell.py`
- `app/apps/_templates/proxy_shell_wrapper/README.md`
- `app/apps/_templates/proxy_shell_wrapper/main.js`
- `app/apps/codex_agent/README.md`

Observation:

- The shared `proxy_shell` websocket path also forwards packets with a similar two-task websocket bridge.
- It is more general than the dedicated shims:
  - manifest lookup
  - app-id routing
  - configurable websocket max size
  - optional HTTP payload rewriting
  - optional Socket.IO path injection support
- The websocket hot loop is still lean, but the system as a whole is not as narrow as the dedicated per-path shims.

Steady-state websocket forwarding ranking:

1. dedicated shims in `editor_transport.py` / terminal transport shims
2. shared websocket forwarding in `app/extensions/apps/proxy_shell.py`

Reason:

- The shared engine is still efficient, but it pays for genericity and a broader contract.

### A.3 End-to-End Wrapper-System Ranking

If the comparison includes full wrapper startup behavior rather than only steady-state websocket packet forwarding, then the ranking changes further:

1. dedicated websocket shims
2. shared `proxy_shell` websocket forwarding
3. full proxy-shell wrapper path

Reason:

- the wrapper path adds:
  - proxy metadata fetch
  - readiness polling against health URL
  - iframe bootstrap
  - optional HTTP rewrite work on served assets

### A.4 Step A Conclusion

The terminal slowness is unlikely to be primarily caused by the dedicated terminal websocket shim itself, because:

- it is materially the same shape as `editor_transport.py`
- both terminal implementations are slow in the same way
- the biggest costs are further downstream in per-input event handling and PTY write behavior

Step A is still worth documenting because it establishes that transport replacement should not be the first patch.

### A.5 Important Caveat

If the real goal is minimum keystroke latency, the meaningful lower-overhead transport comparison is not:

- dedicated shim vs `proxy_shell`

It is:

- current Socket.IO terminal path vs existing raw PTY websocket path

Existing raw PTY websocket routes:

- `app/apps/file_editor_cm6/terminal_backend.py`
- `app/apps/terminal/backend.py`

Current UIs do not use those raw websocket routes. That makes them the real transport-thinning candidate for Step C, whereas replacing dedicated shims with `proxy_shell` would likely produce only a smaller effect.

## Step B

Experimental pipe-backed framed-stream track in a new `terminal_testing` app.

The intent of this step is to test a cleaner terminal transport from a fresh context instead of trying to progressively untangle the current standalone terminal app in place.

### B.1 Experimental App Shape

Initial direction:

- create a fresh `terminal_testing` app from the current `app/apps/terminal` baseline
- user preference is to treat the current terminal app as the experimental seed and rename it into `terminal_testing`
- if the experiment succeeds, keep that app as the forward path

Reason:

- this reduces the risk of mixing exploratory transport work with the current drawer/runtime expectations
- it gives a clean place to test framed transport, replay, and resume semantics without entangling the existing drawer
- it keeps the browser/websocket transport decision separate from the shell-side serialization decision
- in this repo, shellspecs are iterative-development scaffolding, not an end-user surface, so using a broker command in shellspec is acceptable for the prototype stage

### B.2 Pipe-Backed Framed Byte-Stream Protocol

The experimental transport should not treat terminal output as per-character events.

The intended model is:

- the real interactive shell remains PTY-backed
- `terminal_testing` does not treat that PTY session itself as the framework shell contract
- instead, a wrapper module is launched as a pipe-backed FWS shell through shellspec
- that wrapper owns the PTY session and serializes terminal byte chunks into structured envelopes before they go over the FWS pipe
- frontend decodes framed byte chunks and writes them into xterm
- backend acts primarily as shell/session gatekeeper and transport bridge, not as terminal renderer

This deliberately splits the system into two transport layers:

1. browser to app worker
   - websocket transport
2. app worker to framework-shells shell
   - pipe-backed framed protocol

Preferred envelope shape:

- JSON control envelopes
- chunk payload carried as base64 byte content
- wrapper stdout log written as one framed record per line when practical

Representative message types:

- `hello`
- `input`
- `data`
- `resize`
- `closed`
- `resume`
- `error`

Representative payloads:

```json
{"type":"hello","session_id":"...","seq":0}
{"type":"input","data_b64":"..."}
{"type":"data","seq":101,"data_b64":"..."}
{"type":"resize","cols":120,"rows":40}
{"type":"resume","after_seq":88}
{"type":"closed","seq":102,"exit_code":0}
```

Rationale:

- framed chunks reduce race opportunities caused by per-key event emission
- the stream becomes deterministic and replayable
- logs and resume semantics become much cleaner than raw unstructured terminal text
- the shell log itself can become the structured rehydration source instead of a plain-text approximation

#### B.2.1 Shell Ownership Model

Preferred experimental shape:

- add a small terminal wrapper module that:
  - creates or attaches to the real PTY-backed shell
  - reads PTY output bytes
  - emits structured framed records on stdout
  - accepts structured input / resize / destroy commands on stdin
- run that wrapper module under a pipe-backed FWS shellspec
- let the app worker communicate with the wrapper through:
  - `subscribe_output_bytes(...)`
  - `write_to_pipe(...)`

The wrapper should be responsible for serialization and stream framing.
The app worker should not be the place that reconstructs a replayable protocol after raw PTY bytes have already crossed multiple boundaries.

Broker progression note:

- first prototype the broker as a shellspec-launched `pipe` shell command
- use Node first if that is the fastest path to validate:
  - framing
  - replay
  - hydration
  - input latency
- if the broker contract proves out, move it into native FWS code rather than keeping it as "just another shellspec command"
- at productization time, give it a distinct backend or engine name such as `terminal_stream` instead of overloading raw `pipe`

This progression matters because the long-term value is not "more pipe glue in app code". The long-term value is moving PTY lifecycle, framing, resize, replay contract, and sequencing into native FWS machinery where the hot path can live in machine code.

#### B.2.2 Browser Route Shape

Recommended first browser route shape:

- framework-facing websocket:
  - `/ws/app/terminal_testing/terminal`
- worker-facing websocket:
  - `/ws/terminal`

Reason:

- this fits the existing generic app websocket proxy in `app/main.py`
- it avoids baking shell identity into the URL path
- session binding can happen in the initial control frame instead of route parsing

This route shape only covers browser to app-worker traffic.
The shell-side experimental change is still the pipe-backed wrapper behind the worker.

#### B.2.3 Session Model

The websocket connection should be transport-only. Shell/session ownership should be established by the first control message.

Recommended server-managed identifiers:

- `session_id`
  - stable reconnect token for the framed terminal session
- `shell_id`
  - framework-shell identifier for the pipe-backed wrapper shell
- `inner_shell_id`
  - optional wrapper-managed identifier for the underlying PTY session if that distinction becomes necessary
- `seq`
  - strictly increasing server output sequence number

Recommended client-maintained state:

- `last_seq_applied`
- current `session_id`
- current `shell_id`
- current cols/rows

The backend should remain the gatekeeper for shell creation and session binding, not for rendering or decoding terminal output.
The wrapper should remain the owner of PTY byte framing.

#### B.2.4 Client To Server Control Plane

Input and control traffic should use JSON-RPC 2.0 envelopes.

That applies to:

- browser to worker over raw WebSocket
- worker to broker over FWS pipe stdin

The intent is:

- JSON-RPC for named input and control methods
- JSONL event objects for stdout and replay
- do not mix JSON-RPC responses into the stdout event stream

Recommended first-cut rule:

- use JSON-RPC notifications for the hot-path control/input methods
- reserve request `id` usage for future cases that truly need request-response semantics
- keep broker stdout append-only and event-shaped

Recommended initial method set:

`terminal.connect`
```json
{
  "jsonrpc": "2.0",
  "method": "terminal.connect",
  "params": {
    "session_id": "optional reconnect token",
    "shell_id": "optional known shell id",
    "project_path": "optional project path",
    "cols": 120,
    "rows": 40,
    "resume_after_seq": 88,
    "create_if_missing": true
  }
}
```

`terminal.input`
```json
{
  "jsonrpc": "2.0",
  "method": "terminal.input",
  "params": {
    "data_b64": "base64 bytes",
    "flush": "auto"
  }
}
```

`terminal.resize`
```json
{
  "jsonrpc": "2.0",
  "method": "terminal.resize",
  "params": {
    "cols": 120,
    "rows": 40
  }
}
```

`terminal.destroy`
```json
{
  "jsonrpc": "2.0",
  "method": "terminal.destroy",
  "params": {}
}
```

`terminal.ping`
```json
{
  "jsonrpc": "2.0",
  "method": "terminal.ping",
  "params": {
    "nonce": "optional"
  }
}
```

Notes:

- `terminal.input.params.data_b64` is framed byte input, not per-character semantics
- `flush` is advisory and allows explicit immediate flush behavior for edge cases
- no blind client-side replay of old input after reconnect
- browser-side key events should still be coalesced before serialization into `terminal.input`
- worker-to-broker stdin should serialize one JSON-RPC envelope per line so the pipe remains line-delimited and machine-parseable

Notification vs request rules:

- current preferred prototype posture is notification-only for:
  - `terminal.connect`
  - `terminal.input`
  - `terminal.resize`
  - `terminal.destroy`
  - `terminal.ping`
- `terminal.connect` is acknowledged by a normal outbound `hello` event, not by a JSON-RPC response object
- `terminal.ping` is acknowledged by a normal outbound `pong` event, not by a JSON-RPC response object
- reserve request `id` usage for a future case that truly requires request-response semantics without polluting stdout

Responsibility split:

- browser:
  - batch xterm input locally
  - serialize coalesced chunks into `terminal.input`
  - send `terminal.connect` on open and reconnect
  - apply only server-owned output `seq`
- worker:
  - validate JSON-RPC method and params
  - own shell creation, session binding, replay planning, and browser websocket lifecycle
  - forward normalized control/input notifications to broker stdin
  - translate broker stdout JSONL into browser-visible output events
- broker:
  - own the PTY and inner shell lifecycle
  - decode JSON-RPC stdin notifications
  - apply `pty.write(...)`, resize, and destroy actions
  - emit ordered JSONL output events on stdout

#### B.2.5 Server To Client Frames

Recommended initial frame set:

`hello`
```json
{
  "type": "hello",
  "session_id": "stable session token",
  "shell_id": "fws shell id",
  "next_seq": 101,
  "resume_mode": "fresh"
}
```

`data`
```json
{
  "type": "data",
  "seq": 101,
  "data_b64": "base64 bytes"
}
```

`closed`
```json
{
  "type": "closed",
  "seq": 102,
  "exit_code": 0,
  "reason": "exited"
}
```

`error`
```json
{
  "type": "error",
  "code": "bad_resume",
  "message": "human-readable detail",
  "fatal": false
}
```

`pong`
```json
{
  "type": "pong",
  "nonce": "optional"
}
```

Optional UI-oriented control frames:

- `shell_list`
- `rehydrate_start`
- `rehydrate_end`

The minimum contract should stay small. `data`, `hello`, `closed`, and `error` are the real core.

Important rule:

- stdout remains event-only JSONL
- do not turn PTY output into JSON-RPC responses
- if a connect or ping acknowledgment is needed, emit a normal event such as `hello` or `pong`

#### B.2.6 Sequencing And Replay Rules

Rules:

1. `seq` is assigned only by the server or wrapper-owned output stream authority.
2. Every emitted output chunk increments `seq`.
3. The client tracks `last_seq_applied`.
4. On reconnect, the client sends `resume_after_seq = last_seq_applied`.
5. The server either:
   - replays from in-memory buffer
   - replays from persisted framed log
   - or returns a recoverable `error` explaining that replay is unavailable

Replay must preserve:

- chunk ordering
- exact chunk boundaries as stored in the framed log or replay buffer

The client must not guess missing output. It should only accept ordered replay from the server.

#### B.2.7 Input Flush Policy

The framed protocol improves correctness, but input performance still depends on coalescing rules.

Recommended initial policy:

- maintain a small input buffer client-side or server-side
- flush on whichever comes first:
  - short timer window
  - byte threshold
  - explicit immediate-flush input

Recommended immediate-flush cases:

- newline / Enter
- Ctrl-C
- Ctrl-D
- escape-heavy control sequences where latency matters

Recommended first-cut defaults:

- target coalescing window: single-digit milliseconds
- keep burst aggregation bounded and predictable

The goal is to collapse key-repeat bursts without making normal typing feel sticky.

### B.3 Reconnect Policy

For browser reconnect behavior, evaluate vendoring `worktrees/reconnecting-websocket` through npm and loading it as a frontend module.

Why it is attractive:

- browser-compatible API
- configurable reconnect timing
- connection timeout support
- pluggable URL provider

Important guardrail:

- do not blindly replay buffered terminal input after reconnect
- reconnect logic should restore transport and session state
- stale buffered input must not be injected into the wrong resumed shell

Recommended `reconnecting-websocket` posture for terminals:

- use it for reconnection timing and lifecycle
- do not treat its buffered-send behavior as terminal replay logic
- prefer zero or tightly bounded queued outbound messages while disconnected
- keep replay/resume server-driven through `resume_after_seq`

Recommended reconnect behavior:

- reconnect browser transport
- rebind session
- request replay with `resume_after_seq`
- only send new input after resume is established

### B.4 Rehydration Model

Terminal logs are already used as a rehydration path today:

- CM6 drawer preloads log tail from `app/apps/file_editor_cm6/static/js/terminal.js`
- standalone terminal preloads log tail from `app/apps/terminal/main.js`

The experimental path should keep rehydration as a first-class feature, but upgrade it from plain tail loading to ordered replay semantics:

1. short in-memory replay window keyed by `seq`
2. persisted shell log as fallback rehydration source
3. if the requested resume point is too old for the in-memory replay window, replay from persisted log

Preferred persisted replay source for `terminal_testing`:

- the pipe-backed shell stdout log itself, if the wrapper emits one framed JSON record per line
- if that proves awkward in practice, fall back to a dedicated framed JSONL sidecar written by the backend

Representative persisted `data` record:

```json
{"type":"data","seq":101,"ts":1712360000000,"data_b64":"..."}
```

Representative persisted `closed` record:

```json
{"type":"closed","seq":102,"ts":1712360001234,"exit_code":0,"reason":"exited"}
```

Why:

- plain terminal text tails are adequate for rough history priming
- they are not a strong resume format
- framed JSONL logs allow exact ordered replay and cleaner future tooling
- if the wrapper emits the authoritative framed stream directly, the shell log can be the rehydration method instead of an after-the-fact reconstruction

### B.5 Browser WebSocket Proxy Options

There are three realistic browser-side proxy options for `terminal_testing`.

#### Option 1: Generic app websocket proxy in `app/main.py`

Route:

- `app/main.py`

Behavior:

- framework route `/ws/app/{app_id}/{route:path}` proxies to worker `/ws/{route}`

Why it is attractive:

- already exists
- generic
- no new dedicated main-process shim required
- fits a raw websocket browser route naturally

Recommended initial browser choice:

- use this first for `terminal_testing`

Reason:

- it is the lowest-effort way to test the browser transport without adding another bespoke proxy surface

#### Option 2: Dedicated app-specific websocket shim

Examples:

- `app/apps/file_editor_cm6/services/terminal_transport.py`
- `app/apps/terminal/services/terminal_transport.py`

Why to use it:

- only if `terminal_testing` needs app-specific websocket path normalization or transport behavior that the generic `/ws/app/...` proxy does not provide

#### Option 3: Shared `proxy_shell` engine

Files:

- `app/extensions/apps/proxy_shell.py`
- `app/apps/_templates/proxy_shell_wrapper/*`

Why it is not the first choice for this experiment:

- it is better suited to proxied app UIs and generic wrapper bootstrapping
- it is not the leanest path for a purpose-built browser terminal route

### B.6 Direct PTY Raw-WebSocket Fallback

The earlier direct PTY raw-websocket design is still useful as a fallback reference:

- keep the shell PTY-backed
- expose a raw websocket endpoint from the worker
- frame byte chunks at the worker layer instead of at a pipe-backed wrapper

Why it remains useful:

- it is a thinner implementation path
- it is easier to compare against the current standalone terminal app
- it avoids wrapper/module work if the pipe-backed design turns out to be too expensive to stand up

Why it is no longer the preferred Step B path:

- it leaves shell-side framing later in the pipeline
- it makes the shell log less naturally useful as the structured rehydration source
- it underuses the planned pipe-shell observability direction

Important caveat on the preferred pipe-backed design:

- the current FWS native pipe optimization primarily helps stdout/read-side flow
- `write_to_pipe(...)` still writes to stdin via `stdin.write(...)` and `await stdin.drain()`

So even with the wrapper design, input coalescing and flush policy still matter.

Design note:

- in this repo, the shellspec used for the prototype is not considered a user-facing contract
- in the `framework-shells` repo, once this is productized, the backend/engine naming becomes user-facing to maintainers and consumers and should no longer expose the temporary broker shape

### B.7 Concrete Prototype Checklist

This is the concrete file-by-file prototype checklist for the first broker-backed `terminal_testing` pass.

Frontend direction update:
- `terminal_testing` should use xterm as the browser renderer, not hterm
- keep the Rust-backed broker contract unchanged
- keep the app-local TypeScript/esbuild frontend backbone
- keep the explicit TE2 console bridge init path
- use the Android helper scripts in `~/downloads/android-terminalapp-assets-js-20260407-223402/` as reference material for mobile Ctrl handling first, and touch-to-mouse bridging only later if needed

#### B.7.1 Reset The Stale Experimental Copy

Targets:

- `app/apps/terminal_testing/backend.py`
- `app/apps/terminal_testing/src/main.ts`
- `app/apps/terminal_testing/manifest.json`
- `app/apps/terminal_testing/template.html`
- `app/apps/terminal_testing/shellspec/*`

Checklist:

- treat the current `terminal_testing` frontend implementation as stale from the hterm detour
- keep the broker-first transport design rather than revisiting the abandoned direct PTY/raw-websocket track
- rewrite the frontend back onto xterm while preserving the broker contract
- keep the useful UI/template/build/console-bridge pieces from the current experimental app

#### B.7.2 Broker Module

Primary target:

- add a broker module under `app/apps/terminal_testing/`

Recommended first filename:

- `app/apps/terminal_testing/terminal_stream_broker.mjs`

Broker responsibilities:

- own the real PTY-backed inner shell
- assign monotonic output `seq`
- emit framed JSONL records on stdout
- accept JSON-RPC control/input envelopes on stdin
- support:
  - `terminal.connect`
  - `terminal.input`
  - `terminal.resize`
  - `terminal.destroy`
  - `terminal.ping`
  - `closed`
- keep stdout reserved for the framed protocol
- send debug/errors to stderr

Contract rule:

- stdin is JSON-RPC 2.0, one envelope per line
- stdout is JSONL event objects only
- do not mix JSON-RPC responses into the stdout lane

Dependency checkpoint:

- there is no existing `node-pty` package declaration in the repo package manifests today
- the Node-first prototype is now locked to:
  - an app-local Node PTY dependency for `terminal_testing`
  - specifically `node-pty` unless a concrete incompatibility blocks it
- keep that dependency app-local to the experiment instead of treating it as a repo-global assumption

#### B.7.3 Prototype Shellspec

Primary targets:

- `app/apps/terminal_testing/shellspec/terminal_stream.yaml`
- `app/apps/terminal_testing/shellspec/app_worker.yaml`

Checklist:

- create a dedicated prototype shellspec for the broker-backed terminal stream instead of reusing the old direct PTY shellspec name
- use FWS `pipe` for the prototype host contract
- have the shellspec launch the broker command and pass the real inner shell command as broker args or context
- keep the shellspec shape explicit that this is:
  - broker process under `pipe`
  - real shell behind the broker

Representative prototype direction:

```yaml
backend: pipe
command:
  - node
  - terminal_stream_broker.mjs
  - --
  - bash
  - -l
  - -i
```

Productization note:

- once validated in FWS itself, the desired end state is a distinct backend or engine such as `terminal_stream`
- that productization step should remove the temporary broker-command shape from the shellspec contract

#### B.7.4 Worker Bridge

Primary target:

- `app/apps/terminal_testing/backend.py`

Checklist:

- stop treating the worker as the PTY owner
- treat the worker as:
  - broker-shell launcher
  - session manager
  - replay coordinator
  - browser websocket endpoint
- communicate with the broker shell through:
  - `subscribe_output_bytes(...)`
  - `write_to_pipe(...)`
- validate and forward JSON-RPC input/control notifications toward the broker
- parse framed JSONL broker stdout into session events
- keep an in-memory replay window keyed by `seq`
- map browser session ids to broker shell ids
- never reconstruct terminal frames by scraping plain terminal text after the fact

#### B.7.5 Browser Protocol

Primary target:

- `app/apps/terminal_testing/src/main.ts`

Checklist:

- replace Socket.IO with raw websocket for the prototype browser transport
- use the app-local `reconnecting-websocket` npm dependency for reconnect lifecycle only
- send `terminal.connect` on connect/reconnect
- send bounded coalesced `terminal.input` notifications with `data_b64`
- send `terminal.resize` and `terminal.destroy` as JSON-RPC control notifications
- track `last_seq_applied`
- decode `data_b64` and write decoded output to xterm
- keep the TE2 console bridge initialization path in the frontend
- do not replay stale buffered input after reconnect
- plan the Android mobile helper layer around:
  - Ctrl synthesis using the `ctrl_key_handler.js` pattern
  - optional touch-to-mouse conversion later using the `touch_to_mouse_handler.js` pattern if xterm selection needs it

Protocol split:

- client-originated control/input is JSON-RPC
- server-originated output/replay is JSONL event data
- browser websocket transport may carry those as ordinary JSON messages, but the contract should still follow the same method and event families

Primary browser route target:

- `/ws/app/terminal_testing/terminal`

#### B.7.6 Type-Safe Minified Frontend Build

Primary targets:

- `app/apps/terminal_testing/package.json`
- `app/apps/terminal_testing/build.mjs`
- `app/apps/terminal_testing/tsconfig.json`
- `app/apps/terminal_testing/src/main.ts`
- `app/apps/terminal_testing/manifest.json`

Checklist:

- do not keep the experimental frontend as an unbundled plain `main.js` file
- make the new frontend type-safe
- make the production-style build minified
- retain the existing console bridge integration as part of the frontend contract
- follow the existing in-repo pattern used by `file_editor_cm6`:
  - app-local TypeScript config
  - app-local esbuild entrypoint
  - bundled output under `static/dist/`
- point the manifest `frontend_script` at the built output rather than the raw source file

Recommended first output shape:

- source:
  - `app/apps/terminal_testing/src/main.ts`
- bundled output:
  - `app/apps/terminal_testing/static/dist/main.js`

Build requirements:

- watch build may keep sourcemaps and skip minification
- non-watch build should be minified
- build scripts should live with the app instead of depending on a vague repo-root convention
- the reconnect client should come from an app-local typed npm dependency rather than an ad hoc absolute vendor import

#### B.7.7 Replay And Log Contract

Primary ownership:

- broker stdout framed JSONL is the preferred authoritative replay source
- worker in-memory replay buffer is the fast reconnect path

Checklist:

- preserve exact frame ordering and chunk boundaries
- use `resume_after_seq` on reconnect
- replay from memory first
- fall back to the broker shell log if needed
- return a recoverable error if the requested replay gap cannot be satisfied
- keep client-side replay limited to requesting resume, not inventing missing output

#### B.7.8 Metadata And App Surface

Primary targets:

- `app/apps/terminal_testing/manifest.json`
- `app/apps/terminal_testing/template.html`

Checklist:

- align app id/name with `terminal_testing`
- remove stale transport/service assumptions from the copied manifest
- update the manifest to reference the built frontend bundle under `static/dist/`
- keep the UI shell simple and focused on validating transport behavior
- avoid mixing unrelated UX changes into the transport prototype

#### B.7.9 Validation Pass

Checklist:

- static-check the broker module
- `python -m py_compile app/apps/terminal_testing/backend.py`
- validate the manifest JSON
- validate that the browser transport code matches the agreed frame contract
- typecheck the `terminal_testing` frontend
- run the app-local frontend build and confirm the output is minified in non-watch mode
- do not restart the shared main framework server as part of this validation

Implementation checkpoint:

- `backend.py` compiles with `py_compile`
- the app-local frontend passes `npm run typecheck`
- the non-watch frontend build emits a minified `static/dist/main.js`

## Step C

Sideband improvements for the existing `file_editor_cm6` terminal drawer.

This track is intentionally narrower and lower-risk than the experimental `terminal_testing` app.

### C.1 Remove Redundant Per-Input Shell Resolution

Problem:

- the drawer backend resolves or validates shell binding on every `terminal:input` event even after `terminal:register` has already bound the socket to a shell

Targets:

- `app/apps/file_editor_cm6/terminal_backend.py`

Patch shape:

- treat `terminal:register` as the authoritative shell-binding step
- on `terminal:input`, read the bound shell directly from the sid-to-shell map
- only rebind on explicit register or reconnect recovery
- stop sending `shell_id` on every drawer input event unless a specific fallback requires it

### C.2 Add Bounded Input Coalescing

Problem:

- the drawer emits tiny per-key input chunks
- backend then awaits one `write_to_pty(...)` per chunk

Targets:

- `app/apps/file_editor_cm6/static/js/terminal.js`
- `app/apps/file_editor_cm6/terminal_backend.py`

Patch shape:

- coalesce adjacent input chunks
- define a bounded flush policy
- flush immediately for Enter and control-heavy input when necessary

Recommended first cut:

- backend-side buffering is the safer starting point
- frontend-side micro-batching can be evaluated later if needed

### C.3 Drawer Output Follow-Up

Only if C.1 and C.2 are insufficient:

- batch adjacent output chunks before emitting to the client
- keep close / exit markers immediate

Targets:

- `app/apps/file_editor_cm6/terminal_backend.py`

## Step D

Decision point after `terminal_testing` results.

If `terminal_testing` is materially better:

1. decide whether to keep it as the new standalone terminal path
2. decide whether to port the same framed transport into the CM6 drawer
3. decide whether the CM6 drawer should also talk to a similar pipe-backed wrapper or stop at smaller drawer-side fixes

If `terminal_testing` is not materially better:

1. keep the smaller drawer-side improvements
2. decide whether to fall back to the thinner direct PTY raw-websocket variant before abandoning the transport rewrite

## Implementation Order

1. Step A baseline and transport comparison
2. Step B experimental `terminal_testing` pipe-backed framed-stream plan
3. Step C sideband drawer fixes:
   - remove per-input shell resolution
   - add bounded input coalescing
4. measure both tracks
5. decide whether to:
   - keep `terminal_testing`
   - port framed transport to the drawer
   - fall back to the thinner direct PTY raw-websocket variant if the pipe-backed design does not justify itself

## Measurement Checkpoints

At minimum, collect:

- hold-backspace perceived latency
- normal typing perceived latency
- reconnect correctness
- resume correctness
- input events per second
- `write_to_pty(...)` calls per second
- average payload bytes per write
- echoed output events per second

If runtime instrumentation is added later, prefer:

- p50 / p95 input-to-echo latency
- replay success rate for reconnects
- replay gap size before log fallback

## Risks

### Step B Risks

- reconnect logic can accidentally replay stale input
- bad resume semantics can duplicate or skip output
- framed protocol adds implementation scope even if it improves correctness
- the wrapper/module boundary adds another moving part to shell lifecycle management

### Step C Risks

- buffering can make typing feel sticky if flush policy is too aggressive
- stale sid binding can misroute input if reconnect logic is incomplete

### Direct PTY Fallback Risks

- easier to build, but weaker structured-log story
- may solve transport thinness without solving observability / replay as cleanly

## Recommendation

Pursue two tracks in parallel:

1. experimental `terminal_testing` app with a pipe-backed framed wrapper and browser-side raw websocket transport
2. modest drawer-side fixes in `file_editor_cm6` for immediate input-path cleanup

That gives one clean experiment and one pragmatic short-term improvement path without forcing an all-or-nothing transport rewrite.
