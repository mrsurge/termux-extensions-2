# Terminal App

The Terminal app is a full-screen experience located under `app/apps/terminal/`. It
exposes embedded shells powered by the framework shell manager so users can launch,
monitor, and interact with long-lived terminals without leaving the browser UI.

## Overview
- **Backend**: `backend.py` registers a Flask blueprint under `/api/app/terminal/`.
  It uses the shared `FrameworkShellManager` to spawn PTY-backed shells (labelled
  `terminal-app`) and to stream their output.
- **Frontend**: `main.js` renders the list/terminal views, drives the WebSocket
  connection, and layers basic soft-keys. `template.html` defines the responsive
  layout (list drawer + terminal viewport) and action buttons.
- **Manifest**: `manifest.json` describes the app for the launcher: id, name,
  backend, template, and frontend module.

## Backend Endpoints
All responses use the `{ "ok": true|false, ... }` envelope.

| Method & Path | Purpose |
| --- | --- |
| `GET /api/app/terminal/shells` | List existing terminal shells (filtered by `label == "terminal-app"`). |
| `POST /api/app/terminal/shells` | Spawn a new PTY shell. Body accepts `shell` (array or string command) and `cwd` (defaults to `~`). |
| `GET /api/app/terminal/shells/<id>` | Describe a shell. Query `logs=true&tail=N` fetches recent stdout/stderr tail. |
| `POST /api/app/terminal/shells/<id>/input` | Write text to the PTY (`{ data: "...", newline?: true }`). |
| `POST /api/app/terminal/shells/<id>/resize` | Resize the PTY (`{ cols, rows }`). |
| `POST /api/app/terminal/shells/<id>/action` | `stop`, `kill`, or `restart` the shell via the manager. |
| `DELETE /api/app/terminal/shells/<id>` | Remove the shell, forcing termination and deleting logs/metadata. |

### WebSocket
`register_ws_routes(app)` wires `/api/app/terminal/ws/<id>` using the global `Sock`
instance. The route:
1. Subscribes to PTY output (`manager.subscribe_output`), streaming chunks to the
   browser until disconnect.
2. Relays incoming WebSocket messages back to the PTY input.
3. Cleans up subscriptions/threads when the socket closes.

## Frontend Behaviour (`main.js`)
- **List View**: Fetches `/shells` and renders a card for each shell (status dot,
  uptime, cwd). Clicking a card activates the shell.
- **Terminal View**: Uses `xterm.js` (lazy loaded) and websocket streaming to
  display interactive output. A fit addon keeps the terminal sized to the viewport.
- **Soft Keys**: Provides on-screen controls for Ctrl, Tab, Esc, and arrow keys.
  `Ctrl` toggles a chord mode (Ctrl+A..Z) when the next key is pressed.
- **Actions**: Buttons allow Stop, Kill, Remove (DELETE) and a drawer button shows
  the list on narrow screens. New terminals spawn via `POST /shells` (defaulting to
  `bash -l -i` unless overridden).
- **Log Priming**: When a shell is selected the frontend requests
  `GET /shells/<id>?logs=true&tail=2000` to pre-fill the terminal with recent output
  so context survives reloads.
- **Fallback Input Path**: If the WebSocket isn’t ready, `POST /shells/<id>/input`
  is used as a backup channel.

## Template Highlights (`template.html`)
- Defines a responsive layout with a list drawer and terminal pane.
- Includes buttons for spawning, refreshing, and shell actions.
- Creates the soft-key toolbar and placeholders used by `main.js`.
- Applies styling for list items, status dots, control buttons, and the drawer
  overlay.

## Interaction Flow
1. Launcher instantiates the app via `manifest.json`.
2. `main.js` loads, requests `/api/app/terminal/shells`, and renders the list.
3. When a shell is selected the app:
   - Creates an `xterm.js` instance and primes recent logs.
   - Opens a WebSocket subscription to stream live output.
   - Sends resize and input actions through the REST/WebSocket channels.
4. Users can spawn additional shells, stop/kill/restart existing ones, or remove
   them entirely. Removing a shell disposes of the PTY and deletes its metadata.

This document serves as the canonical overview for the Terminal app; update it when
behaviour or endpoints change.
