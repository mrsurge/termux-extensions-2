## Status Update: Save Works, But Header Issues Remain

### ✅ Fixed: Save Function
The 200 OK confirms save is working now. The backend must be getting the correct `_current_file_path`.

### ❌ Issue 1: Header Shows "Untitled"

**Root cause:** The frontend `main.js` has `currentPath = ''` (empty) because:

1. Backend loads file in NiceGUI iframe ✅
2. Backend sets `_current_file_path` ✅
3. **BUT** frontend `currentPath` is never updated ❌
4. `updatePathDisplay()` checks `if (!currentPath)` → displays "Untitled"

**The barrier:** NiceGUI iframe backend cannot directly communicate with host frontend JavaScript.

**Current flow that SHOULD work but doesn't:**
- Line 1800 in main.js: `currentPath = restoredPath` (from `serverState.lastFile`)
- This relies on `/api/app/file_editor_cm6/state` returning `lastFile`
- But this only happens during boot, not after cache restore

**The fix:** After backend restores cache, ensure `_history_store.touch_file()` is called so `/state` endpoint returns the correct file. OR the frontend needs to call `/state` again after page load.

### ❌ Issue 2: Dynamic Asterisk (Unsaved Indicator)

**You're right - this requires iframe → parent communication.**

**Options:**

1. **Polling (Simple, No Vendoring):**
   - Frontend calls `/editor/cache_state` every 2-3 seconds
   - Updates asterisk based on response
   - No vendor changes needed
   - Downside: 2-3 second delay

2. **WebSocket from Backend (Better, Requires Vendor Changes):**
   - Add method to vendored codemirror.py: `notify_parent_unsaved(bool)`
   - Call it from `_on_editor_change` callback
   - Have NiceGUI send WebSocket message to host
   - Frontend listens and updates asterisk immediately
   - Downside: More complex, requires understanding NiceGUI's WebSocket internals

3. **postMessage from Iframe (Cleanest, Requires Vendor Changes):**
   - In vendored codemirror.js, add:
     ```javascript
     window.parent.postMessage({
       type: 'editor_state',
       unsaved: true,
       path: '...'
     }, '*');
     ```
   - Frontend listens:
     ```javascript
     window.addEventListener('message', (e) => {
       if (e.data.type === 'editor_state') {
         updateAsterisk(e.data.unsaved);
       }
     });
     ```
   - Call from Python via `run_javascript()`
   - This is probably the cleanest for real-time updates

**Recommendation for now:** 
- Fix the "Untitled" issue first (make sure frontend gets the path)
- Use polling (option 1) for the asterisk as a quick win
- Later, implement postMessage (option 3) for real-time updates if needed

**The header path issue is separate from asterisk** - that should be fixable without vendor changes, just need frontend `currentPath` to sync with backend state.
