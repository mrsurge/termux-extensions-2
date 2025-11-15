**Fix Applied - Watcher Skip on Cache Restore**

**Changes made to `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`:**

1. **Line 191:** Added `cached_was_restored = False` flag
2. **Line 200:** Set `cached_was_restored = True` when cache is restored
3. **Lines 258-267:** Added logic to skip first watcher snapshot if cache was restored

**What this fixes:**

The file watcher's `subscribe()` function immediately sends a snapshot of the file from disk when you first subscribe. This was overwriting the cached edits you just restored.

Now:
- ✅ When cache is restored, the first watcher snapshot is ignored
- ✅ Your cached edits stay in the editor
- ✅ Subsequent file changes (real disk modifications) still trigger updates as expected
- ✅ Save function works (already fixed)
- ✅ Cache captures edits correctly (already fixed)

**Test:**
1. Type some edits (should see SHA change in logs)
2. Wait 1 second for cache persist
3. Reload page
4. Should see log: `[FILE_WATCH] Skipping initial snapshot, cache was restored`
5. Your edits should be visible in the editor
