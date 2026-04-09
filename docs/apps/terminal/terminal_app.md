# Terminal App

The Terminal app lives under `app/apps/terminal/` and is now the canonical broker-backed terminal implementation for TE2.

## Overview
- **Backend**: `backend.py` exposes `/api/app/terminal/` and manages pipe-backed terminal shells through framework-shells.
- **Frontend**: `src/main.ts` is bundled to `static/dist/main.js` and provides the shell list, xterm renderer, replay/hydration, reconnect handling, and mobile helper-key support.
- **Shell contract**: browser input/control uses JSON-RPC notifications over the worker WebSocket, while shell output/replay is framed as JSONL events from the terminal stream backend.
- **Shellspec**: `shellspec/terminal_stream.yaml` is the active shellspec for the native terminal pipe path. `shellspec/node_terminal_stream.yaml` remains as the parked Node broker reference.

## Backend Endpoints
All responses use the `{ "ok": true, "data": ... }` envelope.

| Method & Path | Purpose |
| --- | --- |
| `GET /api/app/terminal/shells` | List terminal shells owned by this app. |
| `POST /api/app/terminal/shells` | Start a new shell with optional `shell`, `cwd`, `cols`, and `rows`. |
| `GET /api/app/terminal/shells/<id>` | Describe a shell. |
| `GET /api/app/terminal/shells/<id>/history?after_seq=N` | Read replayable framed history directly from the shell stdout log. |
| `POST /api/app/terminal/shells/<id>/input` | Send terminal input through the broker/control path. |
| `POST /api/app/terminal/shells/<id>/resize` | Resize the shell. |
| `POST /api/app/terminal/shells/<id>/action` | `stop`, `kill`, or `restart` the shell. |
| `DELETE /api/app/terminal/shells/<id>` | Remove a shell and its session state. |

## WebSocket
The worker WebSocket endpoint is `/ws/terminal`, proxied to the browser as `/ws/app/terminal/terminal`.

The client sends JSON-RPC notifications such as:
- `terminal.connect`
- `terminal.input`
- `terminal.resize`
- `terminal.destroy`
- `terminal.ping`

The server streams framed events such as:
- `hello`
- `data`
- `closed`
- `error`
- `pong`

## Frontend Behavior
- xterm is loaded from shared vendored assets under `/static/vendor/xterm/`.
- Reconnects use `reconnecting-websocket`.
- History hydration comes from the explicit `/history` endpoint rather than the old 4 KB log-tail path.
- Vendored Android helper scripts under `vendor/android-terminalapp-assets-js/` provide Ctrl-key and touch-to-mouse behavior.
- The frontend keeps dead-shell history visible and suppresses unnecessary "Shell is not writable" toasts.

Update this document whenever the terminal app contract, shellspec, or frontend transport changes.
