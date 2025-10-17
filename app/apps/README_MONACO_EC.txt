Monaco + EditContext variant
============================

What this is
------------
A drop-in app that replaces your Ace-based File Editor with **Monaco** configured to use
**EditContext** when the runtime supports it (Chromium/WebView ≥ 121). It falls back to
the legacy hidden `<textarea>` path on older engines.

Files
-----
apps/file_editor_monaco/manifest.json   - App manifest (new app id)
apps/file_editor_monaco/main.py         - Your existing backend blueprint (unchanged)
apps/file_editor_monaco/template.html   - Toolbar + container
apps/file_editor_monaco/main.js         - Monaco + EditContext editor
scripts/vendor_monaco.sh                - Vendoring script for static assets

Install
-------
1) Copy this folder into your project root (same level as your current `apps/`).
2) Run: `bash scripts/vendor_monaco.sh`
   This creates: static/vendor/monaco/vs/... (CSS/JS assets loaded at runtime).
3) Register/enable the app via `apps/file_editor_monaco/manifest.json` in your framework.
4) Start your supervised process as usual.

Notes
-----
- EditContext detection: we enable `editor.editContext` when `window.EditContext` exists
  or the `HTMLElement.prototype` exposes `editContext`. Monaco then routes text input
  through the platform's native IME/selection stack.
- Fallback: older WebView/Chrome will continue to work via the legacy input path.
- You can keep your current Ace app in parallel; this ships as a different app id.
