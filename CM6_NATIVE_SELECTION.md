# CM6 Native Selection Mechanism

This project’s CodeMirror 6 editor exposes Android’s native selection handles without giving up CodeMirror’s own rendering. The trick is to let the real `.cm-content` element temporarily behave like a regular editable surface while keeping the rest of the view intact.

## What Happens on Long‑Press

1. **Timer on touch start** – In `apps/file_editor_cm6_native/main.js`, `touchstart` starts a 300 ms timer (`LONG_PRESS_MS`). If the finger stays down, `enableNativeSelection()` runs.
2. **Flip `.cm-content` into `contenteditable`** – `enableNativeSelection()` grabs the live CodeMirror content node and sets:
   - `contenteditable="true"`
   - `-webkit-user-modify: read-write-plaintext-only`
   - `user-select: text`
   CodeMirror’s DOM (line numbers, syntax-highlight spans, diagnostics, etc.) never gets replaced, so all styling stays visible.
3. **Focus the CodeMirror surface** – The same routine focuses `.cm-content`, which makes Android treat it as a native text field and show the selection handles.

## Handing Control Back to CodeMirror

Native selection is only needed while the user is selecting text. Several listeners disable the temporary mode as soon as real editing should resume:

- `pointerdown` and `beforeinput` events call `disableNativeSelection()`.
- That function removes the `contenteditable` attribute and clears the inline CSS overrides.
- CodeMirror’s input pipeline sees the next event and continues as usual, with syntax decoration and history intact.

## Why This Works

- **Single surface** – Because the live CodeMirror markup is never hidden, there is no need to copy text or re-render syntax highlighting.
- **Browser cooperation** – Android WebView shows its native handles whenever an element is both focusable and editable. Using `read-write-plaintext-only` keeps the browser from injecting styled HTML that would confuse CodeMirror.

This combination delivers native touch affordances with zero visual downgrade and without forking CodeMirror’s renderer.
