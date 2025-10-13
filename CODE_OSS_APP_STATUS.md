# Code OSS App: Current Wiring and Observed Gaps

## Overview
The Code OSS app now packages and installs a lightweight “mobile bridge” extension alongside the framework. The backend exposes install/status APIs, the launcher screen surfaces bridge state, and the full-screen wrapper loads Code OSS inside an iframe while a drawer mirrors workspace contents. Several core flows work, but two major behaviours are still missing (document view mirroring and explorer population).

## Wiring Summary
### Backend (`app/apps/code_oss/backend.py`)
- Starts/stops the code-server worker inside a framework shell.
- Packages the bridge as a VSIX (`app/apps/code_oss/bridge_extension/mobile-bridge-0.2.0.vsix`) and installs it via `code-server --install-extension`.
- Reports bridge install state/version by running `code-server --list-extensions`.
- Exposes `/api/app/code_oss/status`, `/start`, `/stop`, `/project`, and `/bridge/install`.

### Bridge Extension (`app/apps/code_oss/bridge_extension`)
- Declared as a web extension (`browser`, `extensionKind: ["web"]`).
- Responds to `_mobileShell` postMessages:
  - Emits explorer listings (`explorerTree`), active editor notifications, and workspace folders.
  - Executes commands (`openPath`, `requestExplorerChildren`, etc.) inside VS Code.

### Launcher UI (`app/apps/code_oss/template.html`, `main.js`)
- “Install/Reinstall Bridge” button triggers the `/bridge/install` endpoint.
- Status badge reflects CLI-reported bridge availability.
- Launch button opens `/api/app/code_oss/fullpage`.

### Full-Page Wrapper (`app/apps/code_oss/templates/fullpage.html`, `static/js/ide_fullpage.js`)
- Moves a shared iframe between “Document” and “Full IDE” tabs.
- Drawer should render a tree from bridge `explorerTree` messages.
- Status label shows bridge state in real time.

## Working Behaviours
- Starting/stopping code-server through the app shell succeeds.
- Bridge VSIX installs cleanly (CLI, launcher button).
- “Open Project…” restarts code-server with a new workspace path.
- The full IDE tab loads Code OSS and the extension list shows `termux.mobile-bridge`.

## Expected vs. Actual
| Feature | Expected | Actual |
| --- | --- | --- |
| Explorer drawer | Tree of workspace folders/files; active file highlighted | Stays in “Loading workspace…” state |
| Document tab | Standalone Monaco view of focused document | Displays entire Code OSS interface |
| Bridge status | Should flip to “installed” once tree/active editor events stream in | Remains “not installed” even after VSIX installs |

## Potential Causes
1. **Bridge activation in web worker:** the extension host may not activate web extensions under code-server’s native web worker unless the extension is packaged exactly the way VS Code expects (asset type, manifest, etc.). Despite installing, the runtime might not load it, leaving no explorer messages.
2. **Content Security / iframe isolation:** The bridge posts messages to `window.top`, but the wrapper iframe may run on a different origin or in a sandboxed environment that blocks the IPC.
3. **Event wiring regressions:** The launcher and wrapper assume `explorerTree` will stream on startup. If `postMessage` fails or the bridge hits an exception before notifying, the drawer never flips from placeholder to tree.
4. **Document mirroring logic:** The document view currently just reuses the full iframe; a custom Monaco embed was never implemented yet, so the tab naturally shows the full Code OSS workbench.

## Next Steps (not yet done)
- Investigate bridge activation logs (extension host) to ensure the web extension loads and posts messages.
- Verify iframe messaging: confirm `explorerTree` events are sent by temporarily logging from within the iframe or returning stub data from the bridge.
- Implement a custom document-only view or integrate VS Code’s webview API to render just the editor surface inside the Document tab.
