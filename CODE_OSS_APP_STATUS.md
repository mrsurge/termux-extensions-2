# Code OSS App: Current Status

## Version Snapshot
- **App Wrapper** (`app/apps/code_oss/templates`, `static/js/ide_fullpage.js`): 0.2.1  
- **Bridge Extension** (`mobile-bridge` VSIX): 0.6.0  
- **Backend Blueprint** (`app/apps/code_oss/backend.py`): rev 2025-10-12  
- **Last Reviewed**: 2025-10-12

## Overview
The Code OSS app embeds the bundled `code-server` runtime inside the Termux Extensions framework. A mobile-focused wrapper presents:

1. A **Document view** intended to mirror the currently focused Monaco editor.
2. A **Full IDE view** that exposes the entire Code OSS interface in a drawer-based layout.
3. A **chat/assistant rail** reserved for future bridge extensions.

Communication between the wrapper and code-server now flows through a backend state cache instead of direct `postMessage` calls. This change works around browser security restrictions that prevent VS Code web extensions from talking directly to parent frames.

## Wiring Summary

### Backend (`app/apps/code_oss/backend.py`)
- Launches code-server inside a framework shell with persistent `user-data`, `extensions`, and `config` directories.
- Installs the vendored bridge extension (`mobile-bridge-0.6.0.vsix`) on startup or via `/api/app/code_oss/bridge/install`.
- Provides REST endpoints: `/status`, `/start`, `/stop`, `/project`, `/file`, and the new `/state` stream.
- `/state` accepts POSTed bridge events, stores them in a bounded ring buffer, and exposes snapshots/past events via `GET /api/app/code_oss/state?since=<seq>`.
- Resets the event cache whenever the code-server shell restarts to avoid leaking stale explorer/document metadata.

### Bridge Extension (`app/apps/code_oss/bridge_extension`)
- Queues bridge payloads and flushes them to `/api/app/code_oss/state` with `fetch`, retrying on transient failures.
- Accepts a new `_mobileShell` command `configureBridge` to update endpoint, flush cadence, and retry delays from the wrapper.
- Still emits explorer listings, active-editor notifications, workspace folder updates, and chat provider metadata.
- Exposes the same command surface (`openPath`, `requestExplorerTree`, `requestExplorerChildren`, etc.) so the wrapper can manipulate the VS Code session.

### Full-Page Wrapper (`app/apps/code_oss/static/js/ide_fullpage.js`)
- On iframe load, sends a `hello` message and a `configureBridge` command with the correct backend endpoint.
- Polls `/api/app/code_oss/state` every ~1.5s with jitter, applying new events and bootstrapping from the cached summary on first load.
- Automatically reinitialises the poller when the project changes or the shell restarts.
- Keeps the manual “Test Bridge” control, now augmented to push `configureBridge` as well as `hello`.

### Launcher UI (`app/apps/code_oss/main.js`, `template.html`)
- Shows bridge install status and allows reinstall via the backend CLI helper.
- Opens the full-page IDE wrapper at `/api/app/code_oss/fullpage`.
- Provides “Open Project…” and “Back” affordances in the drawer header.

## Behaviours Confirmed After Update
- ✅ Bridge extension packages cleanly with `vsce` → `mobile-bridge-0.6.0.vsix`.
- ✅ `/state` endpoint accepts batched events and returns cached summaries with `sequence` cursors.
- ✅ Wrapper poller advances `since` cursors and replays bridge events as they arrive.
- ✅ “Open Project…” still restarts the worker and preserves persistence directories.
- ✅ Back button + hamburger placement matches the requested layout.

## Known Gaps
| Area | Expected | Current Behaviour | Notes |
| --- | --- | --- | --- |
| Document view | Mirror focused Monaco editor only | Still renders the full IDE iframe | Requires bridge-driven Monaco embedding or webview approach. |
| Explorer drawer | Folder/file tree synced with VS Code | Bridge events arriving, but drawer still shows placeholder until event cadence verified | Needs deeper debugging with real payloads once bridge is polled live. |
| Chat rail | Extension-provided panel | Placeholder only | Awaiting final chat extension scope. |
| Extension install UX | Report success & diagnostics | Button triggers CLI, but no frontend toast/log surface | Capture backend response + display state in launcher. |

## Next Steps / Open Questions
1. **Validate live explorer payloads**: confirm the new polling flow delivers `explorerTree` events end-to-end. Instrument backend logs if the queue stays empty.
2. **Decide on the document view approach**: either continue with the full iframe and add native Monaco mirroring via the bridge, or pivot to a VS Code webview that streams editor content.
3. **State diffing on the wrapper**: dedupe explorer updates to avoid rerender storms once large workspaces are opened.
4. **Surface bridge diagnostics**: expose `/state` error history in the UI so users can see when the bridge fails to push state.
5. **Longer term**: explore a backend watcher (filesystem + code-server REST APIs) to populate explorer/chat panes even when the bridge is paused.

_See `TODO.md` (§ Code-OSS Full-Page App Integration) for the task-level checklist that depends on this status update._
