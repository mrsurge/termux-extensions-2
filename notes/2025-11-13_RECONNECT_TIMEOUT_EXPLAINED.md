# NiceGUI reconnect_timeout Parameter - Detailed Explanation

**Date:** 2025-11-13  
**Context:** Understanding what `reconnect_timeout=0` does and whether it's still needed after the editor refactor

---

## What Is reconnect_timeout?

Parameter: `@ui.page('/nc', reconnect_timeout=X)`

It controls what happens when the WebSocket connection between browser (client) and server (Python) is **lost**.

**Common causes of disconnect:**
- App goes to background (mobile)
- Network hiccup
- Server restart
- Browser sleep/suspend
- Inactivity timeout

---

## The Three Scenarios

### Scenario 1: `reconnect_timeout=0` (CURRENT - Disabled Reconnection)

**Timeline:**
1. User has file open with unsaved edits
2. WebSocket disconnects (app backgrounded)
3. User returns to app
4. NiceGUI sees `reconnect_timeout=0` → **NO RECONNECTION ALLOWED**
5. NiceGUI creates **FRESH** Client instance
6. `editor_page()` function runs **AGAIN** from scratch
7. Auto-load logic executes (lines 88-115 in editor_app.py)
8. Loads **SAVED** file content from disk
9. `editor.set_value(initial_content)` ← **Overwrites unsaved edits**
10. User's edits are **GONE**

**Result:**
- ❌ Unsaved edits **LOST**
- ✅ Settings always fresh from disk
- ✅ No stale state issues
- ❌ Poor UX for unsaved work

**Browser behavior:**
- Might see brief reload/flash
- Or seamless transition (CodeMirror DOM preserved)
- But content is **replaced** with disk version

---

### Scenario 2: `reconnect_timeout=3.0` (DEFAULT - Enabled Reconnection)

**Timeline:**
1. User has file open with unsaved edits
2. WebSocket disconnects (app backgrounded)
3. User returns to app **WITHIN 3 seconds**
4. NiceGUI attempts to **RECONNECT** to existing Client instance
5. `editor_page()` function does **NOT** re-run
6. Python reconnects to **SAME** editor object in memory
7. CodeMirror state **unchanged**
8. Unsaved edits **PRESERVED**

**Result:**
- ✅ Unsaved edits **SURVIVE**
- ⚠️  Settings might be stale (old client state)
- ✅ No reload/flash
- ✅ Seamless reconnection

**What if user returns AFTER 3 seconds?**
- Connection attempt times out
- Falls back to fresh page load (like Scenario 1)
- Edits lost if >3 seconds

---

### Scenario 3: `reconnect_timeout=None` (INFINITE)

**Timeline:**
1. User has file open with unsaved edits
2. WebSocket disconnects
3. User returns **HOURS** later
4. NiceGUI **STILL** tries to reconnect to old Client
5. If successful: Unsaved edits preserved
6. If failed: Fresh page load

**Result:**
- ✅ Maximum preservation of unsaved work
- ⚠️  Old clients linger in memory
- ⚠️  Potential memory leaks
- ⚠️  Stale state more likely

---

## Detailed Mechanics

### When `reconnect_timeout > 0`:

**Server-side:**
- NiceGUI keeps Client object alive in memory
- `_active_editor` reference stays valid
- All Python state preserved
- Waits for client to reconnect

**Client-side (Browser/Iframe):**
- Socket.IO attempts reconnection
- CodeMirror editor stays in DOM
- All editor content/state in browser memory
- No page reload

**On successful reconnect:**
- WebSocket re-establishes
- Python and browser sync up
- `editor.value` contains unsaved edits
- Everything continues as if nothing happened

---

### When `reconnect_timeout = 0`:

**Server-side:**
- NiceGUI immediately destroys old Client
- `_active_editor` reference cleared
- Python state reset
- New Client created on next request

**Client-side (Browser/Iframe):**
- Socket.IO sees connection refused
- Triggers page reload (or equivalent)
- `editor_page()` runs fresh
- DOM might be preserved but...

**On "reconnection" (actually fresh load):**
- New WebSocket connection
- New Client instance
- `editor_page()` executes
- Auto-load runs → disk content loaded
- **Unsaved edits overwritten**

---

## The Critical Difference

### `reconnect_timeout > 0`:
- Preserves Python objects (`_active_editor`, state)
- Preserves browser DOM (CodeMirror instance)
- `editor_page()` does **NOT** re-run
- Auto-load does **NOT** run
- **Unsaved edits SURVIVE**

### `reconnect_timeout = 0`:
- Destroys Python objects (fresh start)
- May preserve browser DOM (implementation detail)
- `editor_page()` **ALWAYS** re-runs
- Auto-load **ALWAYS** runs
- **Unsaved edits LOST** (overwritten by disk content)

---

## Your Current Situation

**With `reconnect_timeout=0`:**

1. Browser/CodeMirror DOM appears preserved (no visible flash)
2. But `editor_page()` runs again behind the scenes
3. Auto-load logic runs: `initial_content = Path(last_file).read_text()`
4. Editor value reset: `editor.set_value(initial_content)`
5. Unsaved edits replaced with saved content
6. **Result:** "Looks the same but edits are gone"

**Why it appears to "retain state":**
- The browser DOM (HTML, CSS, CodeMirror widget) might be cached/preserved
- So visually it looks unchanged
- But the Python code ran fresh and loaded disk content
- Overwriting what was in the editor

---

## The Settings Refresh Issue (Why reconnect_timeout=0 Was Added)

### OLD PROBLEM (before refactor):

**Scenario:**
- User changes theme in settings
- Settings saved to disk
- User refreshes browser

**With `reconnect_timeout > 0`:**
- NiceGUI reconnected to OLD client
- `editor_page()` did NOT re-run
- Old theme still applied
- New theme from disk NOT loaded
- **Result:** Stale settings displayed

### SOLUTION (the "silver bullet"):
- `reconnect_timeout=0` forced fresh page load
- `editor_page()` always ran
- Settings always read from disk
- Fresh theme applied

---

## NEW REALITY (After Refactor with Auto-Load)

**The refactor changed the game:**

With auto-load logic now in `editor_page()`:

**If `reconnect_timeout > 0` on normal reconnect:**
- `editor_page()` does **NOT** re-run
- Auto-load does **NOT** run
- Editor content preserved ✅
- Settings already applied from initial load ✅

**On TRUE page refresh (user F5):**
- `editor_page()` **DOES** run (new page)
- Auto-load runs
- Settings loaded fresh
- Everything works! ✅

---

## Recommendation Analysis

### If you KEEP `reconnect_timeout=0`:
- ✅ Settings always fresh (but not needed anymore)
- ❌ Unsaved edits lost on every disconnect
- ❌ Jarring UX
- ❌ Auto-load runs too often

### If you REMOVE `reconnect_timeout=0` (use default like `3.0`):
- ✅ Unsaved edits preserved on reconnect
- ✅ Settings work (applied on initial load)
- ✅ Auto-load only on TRUE fresh page load
- ✅ Better UX
- ⚠️  If settings change while app backgrounded, won't update until page refresh
  - (But this is expected browser behavior anyway)

---

## Final Answer

### What `reconnect_timeout=0` does:
- Forces `editor_page()` to run on **EVERY** disconnect
- Runs auto-load **EVERY** time
- Discards unsaved edits **EVERY** time
- Provides fresh settings **EVERY** time (redundant with refactor)

### What removing `reconnect_timeout=0` (or setting > 0) will do:
- Preserves `editor_page()` state on reconnect
- Skips auto-load on reconnect
- Keeps unsaved edits intact
- Only reloads on TRUE page refresh (user-initiated)

---

## Recommendation

**REMOVE `reconnect_timeout=0`** or change it to NiceGUI's default (e.g., `3.0` seconds)

**Why:**
- The original problem (stale settings) is solved by the refactor
- Auto-load still fixes the "blank editor on fresh page load" bug
- Unsaved edits will be preserved on temporary disconnects
- Much better user experience

**The auto-load becomes:**
- A feature for "blank editor after true page refresh" (intended)
- NOT a feature that runs on every WebSocket disconnect (unintended side effect)

---

**Status:** `reconnect_timeout=0` is now redundant and harmful to UX  
**Action:** Remove or set to default value  
**Benefit:** Preserves unsaved edits while maintaining all other functionality

---

## Update: 2025-11-13 19:07 UTC

**Context:** Editor refactor and reconnect_timeout investigation

**Issue Discovered:**
After the editor refactor (making editor self-sufficient with auto-load), the `reconnect_timeout=0` setting was causing preference thrash and discarding unsaved edits on WebSocket disconnect.

**Root Cause:**
- `reconnect_timeout=0` was forcing fresh page loads on every disconnect
- Auto-load logic would re-run, loading saved content from disk
- Unsaved edits were being overwritten
- This was the "silver bullet" for settings refresh in the old architecture, but became redundant after refactor

**Resolution:**
- Changed `reconnect_timeout=0` to `reconnect_timeout=3.0` in `editor_app.py`
- Now unsaved edits survive temporary disconnects (within 3 seconds)
- Settings still work correctly (applied on initial page load)
- Auto-load only runs on true page refresh, not on reconnect

**Files Modified:**
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` (line 77)

**Related Documentation:**
- See `2025-11-13_EDITOR_REFACTOR_PLAN.md` for full refactor details
- See `2025-11-13_RECONNECT_TIMEOUT_EXPLAINED.md` for detailed explanation of reconnect behavior
