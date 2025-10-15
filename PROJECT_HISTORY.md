# Project History & Current Status

## Overview
- Working repository: `termux-extensions-2` (Gemini Code Assistant context).
- Focus of recent work: the Code OSS mobile wrapper, bridge extension, and Monaco document mirror for the full-page IDE integration.
- Environment: Termux-hosted Flask framework with framework shells supervising code-server / Code OSS workers.

## Interaction Timeline
- **Runtime strategy** – Confirmed dual-runtime approach: web `code-server` continues to run, while X-backed Code OSS remains optional for richer capabilities. No vendored binaries; users supply their own runtime.
- **Bridge feedback / collaboration** – Authored feedback memo (`CODE_OSS_BRIDGE_FEEDBACK.md`) summarising sandbox pain points, runtime split, and required transport contract.
- **Author responses** – Reviewed `Answers.md` (MVP decisions) and `X_Code-OSS_Lifecycle_via_Framework_Shells.md` (framework-shell orchestration plan).
- **Tooling decisions** – Chose to pursue document streaming via the bridge, using Monaco inside the mobile wrapper, and a REST-based command channel.
- **Vendoring Monaco** – Pulled `monaco-editor@0.51.0`, copied the minified bundle into `app/apps/code_oss/static/vendor/monaco/`, and documented the workflow (`README.md`).
- **Backend enhancements** – Extended `app/apps/code_oss/backend.py` with:
  - Bridge event/cache storage, command queue, and document snapshot tracking.
  - Filtered `/api/app/code_oss/state` output and new `/api/app/code_oss/edits` endpoint with CORS `Authorization` header support.
- **Bridge extension updates** – Implemented doc streaming, revision tracking, command polling/ack flow, and inbound edit application in `app/apps/code_oss/bridge_extension/extension.js`.
- **Bridge packaging** – Bumped version to **0.7.0** and produced `mobile-bridge-0.7.0.vsix` using `vsce package`.
- **Frontend integration** – Updated the full-page template, CSS, and JS to load Monaco, mirror the active document, and expose a sample “✎” edit control.

## Files & Assets Touched
- `CODE_OSS_BRIDGE_FEEDBACK.md`
- `CODE_OSS_APP_STATUS.md` (previous sessions, referenced)
- `TODO.md` (Code OSS section adjustments)
- `app/apps/code_oss/backend.py`
- `app/apps/code_oss/bridge_extension/extension.js`
- `app/apps/code_oss/bridge_extension/package.json`
- `app/apps/code_oss/bridge_extension/mobile-bridge-0.7.0.vsix`
- `app/apps/code_oss/static/css/ide_fullpage.css`
- `app/apps/code_oss/static/js/ide_fullpage.js`
- `app/apps/code_oss/templates/fullpage.html`
- `app/apps/code_oss/static/vendor/monaco/**`
- Misc. helper docs/scripts invoked via shell commands (`npm pack`, `vsce package`, etc.).

## Current Behaviour Snapshot
### Working
- Monaco assets are locally available and load via AMD loader for the document view.
- Backend records bridge events and merges command queues; `/api/app/code_oss/edits` accepts payloads.
- Bridge extension v0.7.0 packages successfully and contains the new streaming logic.
- UI changes (document tab, sample edit button, Monaco container) render correctly when active.

### Not Yet Working / Unverified
- **Bridge event flow** – `/api/app/code_oss/state` still reports no events after runtime start, indicating the bridge is not posting `doc_state`/`doc_changes` yet (likely due to CORS/endpoint or extension installation gaps).
- **Explorer drawer** – Still empty; depends on the same bridge event stream.
- **Document activation** – Without bridge events, the Monaco mirror does not receive content and the ✎ button stays hidden/disabled.
- **Sample edit** – Requires the document stream to deliver valid `doc_id`/`rev`; currently untestable until events flow.
- **Console access** – VS Code web console not yet reachable in the test setup, preventing inspection of bridge logs.

## Outstanding Questions / Next Steps
1. **Verify bridge deployment** – Ensure `termux.mobile-bridge@0.7.0` is installed in code-server (`--list-extensions`) and re-run `--install-extension` with the new VSIX if needed.
2. **Endpoint/CORS check** – Confirm the bridge worker can reach `/api/app/code_oss/state` (likely requires same-origin reverse proxy or explicit CORS allowlist).
3. **Runtime logs** – Surface bridge install status/logs in the launcher, or capture fetch errors via server logs until the console is accessible.
4. **Explorer/chat** – Once document streaming works, extend the wrapper to consume explorer tree/chat provider updates from the bridge state cache.
5. **Lifecycle control** – Follow `X_Code-OSS_Lifecycle_via_Framework_Shells.md` to wire Code OSS start/stop through framework shells (still pending implementation).

## Summary
We now have the plumbing for Monaco mirroring and agent edits, but the critical bridge messages are still not arriving on the backend. Resolving the connection (likely CORS/origin or bridge installation) is the next gate before the document tab and explorer can function. Once events are flowing, the ✎ button and Monaco mirror should activate automatically and allow end-to-end testing of `/edits`.
