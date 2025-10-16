# Code OSS App: Current Status

## Version Snapshot
- **App Wrapper** (`app/apps/code_oss/templates`, `static/js/ide_fullpage.js`): 0.3.0
- **Bridge Extension** (`mobile-bridge` VSIX): 0.8.3
- **Backend Blueprint** (`app/apps/code_oss/backend.py`): rev 2025-10-14
- **Last Reviewed**: 2025-10-14

## Overview
The Code OSS app embeds a `code-server` runtime. The bridge extension that allows communication between the UI and the IDE is now activating correctly, and the File Explorer is successfully populated.

The next phase is to implement the "Monaco focused Open document view" and a series of significant UI/UX improvements for mobile.

## Wiring Summary

### Backend (`app/apps/code_oss/backend.py`)
- Launches `code-server` and handles installing the bridge extension.
- Provides REST endpoints, including `/api/app/code_oss/file` for direct file reads and `/api/app/code_oss/state` to receive events from the bridge.
- Correctly handles CORS, allowing `fetch` calls from the sandboxed extension.

### Bridge Extension (`app/apps/code_oss/bridge_extension`)
- Packaged with `--target web` and no `extensionKind` to ensure it loads correctly as a web worker.
- Reads its configuration (`mobile-bridge.endpoint`) from VS Code User/Workspace settings.
- On activation, sends workspace information (explorer tree, etc.) to the backend `/state` endpoint via `fetch`.
- The directory loading depth has been increased to provide a more complete initial tree.

### Full-Page Wrapper (`app/apps/code_oss/static/js/ide_fullpage.js`)
- The script is loaded with a static `<script defer>` tag to prevent race conditions.
- Polls the `/state` endpoint to receive live events from the bridge, like the `explorerTree`.

### Launcher UI (`app/apps/code_oss/main.js`, `template.html`)
- Features separate "Start Server" and "Open IDE" buttons for clear lifecycle control.

## Behaviours Confirmed After Update
- ✅ **File Explorer Drawer populates correctly** with a deep file/folder tree from the bridge.
- ✅ Bridge extension activates and successfully sends data to the backend via `fetch`.
- ✅ Bridge correctly reads its configuration from VS Code settings.

## Known Gaps
| Area | Expected | Current Behaviour | Notes |
| --- | --- | --- | --- |
| Document view | Clicking a file in the explorer should open its content in the Monaco view. | Currently does nothing or has partial implementation. | This is the next feature to build. |
| Document Sync | Changes should stream in both directions. | Not implemented. | Blocked until the Document View is functional. |
| UI Layout | Edge-to-edge Monaco view on mobile with a collapsible assistant panel. | Standard, non-optimized layout. | Major UI/UX refactoring is required. |
| Header Text | Project/file names should be shortened for mobile. | Full paths are currently shown. | Part of the UI/UX refactoring. |

## Next Steps / Open Questions
1. **Implement UI/UX Refactoring:**
    - Implement the edge-to-edge mobile layout.
    - Create the collapsible Assistant Panel with a footer toggle and state-saving.
    - Fix header text to show shortened names.
2. **Implement Document View:**
    - Make files clicked in the explorer open in the Monaco view.
    - Implement bi-directional sync for document changes.
