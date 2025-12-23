# Issues Overlay Bug Analysis

## Summary

After investigating the codebase, I've identified the root causes of the Issues Overlay bugs documented in `tmp.md`. The issues stem from **state synchronization problems** between the iframe's LSP client lifecycle and the Issues state model, particularly around URI tracking and page reload handling.

---

## Bug 1: Kotlin Squiggles Don't Render (Overlay Works)

### Symptoms
- Overlay shows correct error/warning counts and issue rows
- No underline decorations appear in the editor text

### Root Cause: **`currentUri` Mismatch**

The squiggle application in `handlePublishDiagnostics()` (line 980) has a conditional guard:

```javascript
if (state.currentUri === uri) {
  this.applyIssueSquiggles(entry.filteredDiagnostics || []);
}
```

**The problem:** For Kotlin, the LSP server may emit diagnostics with a URI that doesn't exactly match `state.currentUri`. This can happen due to:

1. **Path normalization differences**: The URI constructed in `connectLSP()` (line 1468) uses:
   ```javascript
   this._lspFileUri = filePath ? ('file://' + filePath) : ('file://' + projectRoot + '/untitled');
   ```
   But the Kotlin LSP server may return URIs with:
   - Different path separators
   - Canonicalized paths (resolved symlinks)
   - Different encoding of special characters

2. **URI vs Path comparison**: `state.currentUri` is a `file://` URI, but the comparison is strict string equality. Any variation (trailing slash, encoding, etc.) causes mismatch.

### Evidence
The overlay works because `_recomputeIssuesForUri(uri)` stores diagnostics by the **incoming URI** (whatever the LSP sends), and the overlay renders from `state.byUri.get(uri)` using that same key. But squiggles require `state.currentUri === uri`, which fails.

### Fix Direction
Normalize URIs before comparison, or use a URI-aware comparison that handles path equivalence.

---

## Bug 2: Issues Only Work for JavaScript on Initial Load

### Symptoms
- JavaScript files show squiggles immediately on first page load
- Other languages (Python, TypeScript, Kotlin) don't show squiggles even when LSP is connected

### Root Cause: **Race Condition in `connectLSP()` Initialization**

The `lsp_server_to_client` handler is registered **inside the async IIFE** in `connectLSP()` (lines 1416-1441):

```javascript
transport.socket.on('lsp_server_to_client', (data) => {
  // Tap into publishDiagnostics for the Issues Overlay state.
  if (data && typeof data === 'object' && data.method === 'textDocument/publishDiagnostics') {
    this.handlePublishDiagnostics(data.params || {});
  }
  // ... forward to lsp-client
});
```

**The problem:** This handler is only registered after:
1. Socket.IO connects
2. Backend sends `lsp_initialized`
3. LSPClient is created and `connect()` is called

For **JavaScript**, the TypeScript LSP server is fast and emits diagnostics *after* all this setup completes.

For **slower servers** (Kotlin, Pyright on first startup), diagnostics may arrive:
- During the initialization handshake (before handler is registered)
- Or be emitted but the handler isn't ready to intercept them

### Evidence
The code has retry logic for `lsp_initialized` (lines 1310-1321) with up to 3 attempts over ~35 seconds total, suggesting slow server startup is a known issue. But diagnostics arriving during this window are lost.

### Fix Direction
Register the `lsp_server_to_client` handler earlier (at socket creation), or buffer diagnostics until initialization completes.

---

## Bug 3: Page Reload Breaks Issues Feature

### Symptoms
- After refreshing the page while an LSP is running, squiggles and live updates stop working
- Sticky scroll and LSP itself still work

### Root Cause: **Backend Session Reuse Without Frontend Re-registration**

Looking at `lsp_ws.py`, the backend maintains `backend_sessions` keyed by `(language_id, project_root)` (line 99-100). When a client reconnects:

1. **Backend**: The existing LSP shell is reused if healthy (`_ensure_backend_session()` line 196)
2. **Backend**: The `reader_task` (stdout bridge) continues running from the old session
3. **Frontend**: A new Socket.IO connection is established with a **new `sid`**

**The problem:** The session's `current_sid` is updated (line 301), but:

1. The `lsp_server_to_client` handler in the **old frontend context** was torn down when the page unloaded
2. The **new frontend** registers a new handler, but the LSP server has **already sent** the initial diagnostics to the old session
3. No `textDocument/didOpen` is sent because the LSP client thinks the file is already open (server-side state)
4. Without `didOpen`, no new diagnostics are emitted

### Evidence
The backend correctly handles session reuse for the LSP protocol layer, but the **Issues state on the frontend** (`_ensureIssuesState()`) starts fresh on page load with empty `byUri` map. There's no mechanism to request a "replay" of diagnostics.

### Fix Direction
1. Frontend should send `textDocument/didOpen` on reconnect even if the server thinks it's already open
2. Or backend should re-emit cached diagnostics when a new `sid` attaches to an existing session
3. Or frontend should request diagnostics refresh after reconnect (`textDocument/publishDiagnostics` is pushed, but could trigger via a `workspace/diagnostic` pull request)

---

## Bug 4: Issues Don't Update During Live Edits

### Symptoms
- Squiggles and overlay show initial load state only
- Typing new errors doesn't trigger new diagnostics

### Root Cause: **Missing `textDocument/didChange` Notification Forwarding**

The LSP protocol requires the client to send `textDocument/didChange` notifications when the document content changes. Looking at `codemirror.js`, the LSP client extension (`this.lspClient.plugin()` at line 1500) should handle this, but:

1. The `lsp-client` library may not be configured to track document versions correctly
2. The `on_change` callback in `editor_app.py` (line 731) only handles cache persistence, not LSP notifications

### Evidence
The `@codemirror/lsp-client` library typically auto-syncs via `didChange`, but the current integration may be:
- Missing the document sync capability negotiation
- Or not properly wiring the CM6 update loop to the LSP client

### Additional Factor
The `serverDiagnostics()` extension (line 1367-1368) is a fallback that may not be installed in all bundles:
```javascript
if (!lspExtensions.length && typeof CM.serverDiagnostics === 'function') {
  lspExtensions.push(CM.serverDiagnostics());
}
```

Without this extension, the CM6 editor won't process incoming diagnostics for display.

### Fix Direction
Verify the LSP client's document sync mode and ensure `didChange` notifications are being sent on every edit.

---

## Architectural Observations

### Issue State Model Location
The Issues state (`_issues`, `byUri`, `currentUri`, etc.) lives in the **Vue component instance** (`codemirror.js`). This means:
- State is lost on component unmount/remount
- No persistence across page loads
- No synchronization with backend state

### URI Management
Multiple places construct file URIs:
- `_lspFileUri` in frontend (line 1468)
- `rootUri` in LSPClient constructor (line 1379)
- `params.uri` from LSP server responses

There's no centralized URI normalization, leading to string comparison failures.

### Event Handler Registration Timing
The `lsp_server_to_client` handler is registered late in the initialization flow, creating a window where diagnostics can be missed.

---

## Recommended Fixes (Priority Order)

1. **URI Normalization** (Bug 1, 3)
   - Add a `normalizeUri()` function that canonicalizes paths
   - Use it in `handlePublishDiagnostics()` and when setting `currentUri`

2. **Early Event Handler Registration** (Bug 2)
   - Move `lsp_server_to_client` handler registration to `SocketIOTransport` constructor
   - Buffer received messages until `connectLSP()` completes

3. **Reconnect Diagnostics Refresh** (Bug 3)
   - After `lsp_initialized`, send a fresh `textDocument/didOpen` even if reconnecting
   - Or implement backend diagnostics caching with replay on new `sid` attachment

4. **Document Sync Verification** (Bug 4)
   - Audit `lsp-client` integration for `didChange` flow
   - Ensure `textDocument/didChange` is sent on every CM6 doc update

---

## Files to Modify

| File | Changes |
|------|---------|
| `app/static/vendor/nicegui/elements/codemirror/codemirror.js` | URI normalization, early handler registration, reconnect logic |
| `app/apps/file_editor_cm6/lsp_ws.py` | Diagnostics caching/replay on reconnect |
| `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` | Ensure `didOpen` sent on set_content/reconnect |
