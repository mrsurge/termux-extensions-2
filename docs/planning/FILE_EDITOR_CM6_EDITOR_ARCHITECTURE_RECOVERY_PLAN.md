# File Editor CM6 Editor Architecture Recovery Plan

## Purpose

This document makes the current editor-open/jump mess tractable before more fixes land.

It does two things:

1. freezes the intended ownership boundary
2. names the current regressions and architectural violations clearly enough to clean them up without adding more routes

## Intended Architecture

- Editor Python ownership is anchored under `app/apps/file_editor_cm6/monaco_editor/m_editor_app.py` and editor-owned helper modules.
- Editor frontend ownership is in `app/apps/file_editor_cm6/monaco_editor/m_editor_app.js`.
- `app/apps/file_editor_cm6/monaco_editor/editor_ws.py` is a narrow `/editor` transport bridge, not the long-term home for sidebar-specific editor orchestration.
- `app/apps/file_editor_cm6/ui_ipc/sidebar_ws.py` normalizes sidebar-originated payloads and hands them directly to the editor owner.
- `app/apps/file_editor_cm6/main.js` does not own sidebar-originated editor open semantics.
- Explorer frontend / Explorer RPC are not in the sidebar-to-editor open path.
- `_history_store` / project sidecar remain the SSOT for current file, MRU scroll state, and active-file propagation.

## Current Architecture Drift

- Sidebar-originated opens have been routed through multiple competing paths:
  - `/sidebar_ipc`
  - Explorer RPC notifications
  - `main.js`
  - HTTP queue / poller paths
  - direct helper injection into editor transport code
- `app/apps/file_editor_cm6/main.js` still contains editor-open orchestration that should not be host-owned.
- `app/apps/file_editor_cm6/monaco_editor/editor_ws.py` has accumulated editor-open business logic beyond narrow `/editor` transport work.
- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.py` still carries deprecated iframe-era route naming and comments.
- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.js` is applying editor open/jump behavior while other layers also try to decide open/jump semantics.

## Regressions

- Cross-file line targets can race MRU restore because open and jump decisions are split across layers.
- Sidebar-originated opens can report transport success without a live editor navigation because the payload has been bounced through unrelated routes.
- Active-file UI surfaces can drift when non-SSOT paths try to update state “helpfully.”
- Fixes are brittle because each regression has tended to add another path instead of reducing ownership to one path.

## Architectural Violations

- Explorer is in the sidebar-to-editor open path.
- `main.js` owns editor-open semantics that should be editor-owned.
- HTTP queue / poller fallback exists for editor open.
- Sidebar-specific orchestration has been pushed into generic host glue.
- New editor-open ownership has landed in whichever file was easiest instead of the intended editor boundary.

## Recovery Rules

- One editor open contract:
  - `path`
  - optional `line`
  - optional `column`
  - optional focus / scroll hints
- One editor owner:
  - editor-open semantics live in editor-owned modules only
- One sidebar route:
  - sidebar payload goes directly to the editor owner
  - no Explorer
  - no host reroute
  - no HTTP fallback
- One post-open jump implementation:
  - same-file jump and cross-file line-target open must use the same editor-side jump primitive
- One SSOT rule:
  - UI surfaces observe SSOT-backed active-file state
  - they do not invent parallel active-file ownership

## Cleanup Order

1. Freeze the ownership boundary and stop adding new open routes.
2. Re-anchor the Python editor boundary under `m_editor_app.py` plus editor-owned helper modules.
3. Move sidebar-originated editor-open entry to that boundary directly.
4. Remove sidebar-to-editor reroutes through Explorer, host glue, and HTTP queue/poller paths.
5. Collapse duplicate open/jump logic onto one editor-side contract and one shared jump primitive.
6. Remove deprecated iframe-era references after behavior is stable.

## Definition Of Done

- Sidebar-originated open reaches the editor without Explorer or host reroute.
- No HTTP queue / poller path remains for editor open.
- `main.js` consumes editor state but does not own sidebar-originated editor-open behavior.
- Same-file jump and cross-file line-target open behave through one editor-side contract.
- SSOT-backed active-file updates remain authoritative.
- Deprecated iframe-era ownership comments no longer describe current behavior.
