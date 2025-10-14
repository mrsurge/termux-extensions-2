# Code OSS App: Current Status and Recent Fixes

## Version Info
- **App Version**: 0.2.0
- **Bridge Extension**: 0.3.0
- **Last Updated**: 2024-10-14

## Overview
The Code OSS app integrates code-server (VS Code in the browser) into the Termux Extensions framework with a mobile-optimized interface. The app features a "mobile bridge" extension for communication between the wrapper and VS Code, separate Document and Full IDE viewing modes, and persistent sessions across browser refreshes. Most major issues have been resolved with comprehensive debugging added.

## Wiring Summary
### Backend (`app/apps/code_oss/backend.py`)
- Starts/stops the code-server worker inside a framework shell.
- Packages the bridge as a VSIX (`app/apps/code_oss/bridge_extension/mobile-bridge-0.3.0.vsix`) and installs it via `code-server --install-extension`.
- Reports bridge install state/version by running `code-server --list-extensions`.
- Exposes `/api/app/code_oss/status`, `/start`, `/stop`, `/project`, `/bridge/install`, and `/file` endpoints.
- **NEW**: Uses persistent directories for user data, extensions, and config at `~/.cache/termux_extensions/code_oss/`
- **NEW**: Passes `--disable-workspace-trust` flag to prevent security prompts

### Bridge Extension (`app/apps/code_oss/bridge_extension`)
- **FIXED**: Now declared with `extensionKind: ["ui", "workspace"]` for web compatibility
- **FIXED**: Message flag alignment - receives `_mobileShell`, sends `_mobileBridge`
- **NEW**: Debug logging added with `[Mobile Bridge]` prefix for troubleshooting
- Responds to `_mobileShell` postMessages:
  - Emits explorer listings (`explorerTree`), active editor notifications, and workspace folders.
  - Executes commands (`openPath`, `requestExplorerChildren`, etc.) inside VS Code.

### Launcher UI (`app/apps/code_oss/template.html`, `main.js`)
- “Install/Reinstall Bridge” button triggers the `/bridge/install` endpoint.
- Status badge reflects CLI-reported bridge availability.
- Launch button opens `/api/app/code_oss/fullpage`.

### Full-Page Wrapper (`app/apps/code_oss/templates/fullpage.html`, `static/js/ide_fullpage.js`)
- **FIXED**: Separate iframes for Document (Monaco) and Full IDE views
- **FIXED**: Document view now shows standalone Monaco editor via `document-viewer.html`
- **NEW**: Monaco vendored locally at `/app/apps/code_oss/static/vendor/monaco/`
- **NEW**: Debug logging added with `[Bridge Wrapper]` and `[ide_fullpage]` prefixes
- **NEW**: "Test Bridge" button added for manual debugging
- Drawer renders tree from bridge `explorerTree` messages
- Status label shows bridge state in real time

## Working Behaviours
- Starting/stopping code-server through the app shell succeeds ✅
- Bridge VSIX installs cleanly (CLI, launcher button) ✅
- "Open Project…" restarts code-server with a new workspace path ✅
- The full IDE tab loads Code OSS and extension shows `termux.mobile-bridge` ✅
- Sessions persist across browser refreshes ✅
- Document tab shows standalone Monaco editor ✅
- Bridge extension compatible with web version of VS Code ✅

## Current Status
| Feature | Expected | Actual | Status |
| --- | --- | --- | --- |
| Session persistence | Maintain state across refreshes | Works with persistent directories | ✅ Fixed |
| Document tab | Standalone Monaco view | Shows Monaco editor separately | ✅ Fixed |
| Bridge compatibility | Install in web VS Code | Works with `["ui", "workspace"]` | ✅ Fixed |
| Message communication | Bidirectional messages | Messages flow with correct flags | ✅ Fixed |
| Explorer drawer | Tree of workspace files | May need manual trigger | ⚠️ Debug mode |

## Fixes Applied
1. **Message flag alignment**: Fixed mismatch between `_mobileShell` and `_mobileBridge` flags
2. **Extension compatibility**: Changed `extensionKind` to `["ui", "workspace"]` for web support  
3. **Session persistence**: Added persistent directories and `--disable-workspace-trust` flag
4. **Document view**: Implemented separate Monaco editor instance with vendored Monaco library
5. **Debug logging**: Added comprehensive logging in both extension and wrapper

## Debugging the Explorer
If the explorer doesn't populate immediately:
1. Open browser console (F12) and look for debug messages:
   - `[Mobile Bridge]` messages from the extension
   - `[Bridge Wrapper]` or `[ide_fullpage]` messages from the wrapper
2. Click the "Test Bridge" button to manually trigger communication
3. Check that messages show:
   - Extension receiving: `{_mobileShell: true, type: "hello"}`
   - Extension sending: `{_mobileBridge: true, type: "explorerTree", ...}`
4. If no messages appear, the extension may not be activated - try refreshing the page
