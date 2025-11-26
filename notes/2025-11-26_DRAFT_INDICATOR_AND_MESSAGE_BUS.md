# Draft Indicator & Message Bus Re-implementation

**Date:** 2025-11-26
**Status:** In Progress

## Achievements
- **Discard Functionality Fixed:** The frontend now correctly calls `DELETE /session_cache` with both `project` and `path` parameters. The indicator click handler is robust.

## Current Issues
- **Indicator Persistence:** The red asterisk (*) fails to persist through a full page reload when a draft is restored. It likely gets cleared by initialization logic (`openFile` or `markUnsaved(false)`) clobbering the restoration state.
- **Missing Message Bus:** The robust iframe-to-parent messaging system (previously implemented but lost in reset) is needed to:
    1.  Route internal editor toasts (NiceGUI `ui.notify`) to the parent frame's system toast.
    2.  Reliably signal the "Draft Restored" state to the parent *after* initialization is stable, ensuring the asterisk persists.

## Plan
1.  **Re-implement Message Bus:**
    -   Extend `codemirror.js` with `notifyParent(type, data)`.
    -   Extend `codemirror.py` with `notify_parent(type, data)`.
    -   Update `main.js` to listen for `notification` messages.
2.  **Migrate Toasts:**
    -   Replace `ui.notify` calls in `editor_app.py` with `editor.notify_parent`.
3.  **Fix Indicator Persistence:**
    -   Use `notify_parent('draft_state', ...)` (or similar) in `editor_app.py` immediately after successful draft restoration.
    -   Update `main.js` to handle this message and force the indicator state, overriding any race-condition clears.
