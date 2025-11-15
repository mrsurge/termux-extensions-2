## Root Cause: File Watcher Overwrites Restored Cache

### The Issue:

When `subscribe()` is called in `core_read.py`, it **immediately sends a `replace_full` snapshot** with content from disk (line 310-327).

The watcher callback (editor_app.py line 256-268) receives this and calls:
```python
editor.set_value(new_content)  # ❌ Overwrites cached edits with disk content!
```

**Sequence:**
1. Backend restores cached edits → `initial_content` = edits ✅
2. Editor created with cached edits ✅
3. Subscribe to watcher
4. Watcher immediately fires `replace_full` with **disk content** (original)
5. Callback calls `editor.set_value(disk_content)` ❌
6. Cached edits are overwritten!

### The Fix:

Add a flag to skip the initial snapshot overwrite when cache was restored:

```python
# After cache restore (around line 189):
cached_was_restored = False
if cached_entry and isinstance(cached_entry.get('content'), str):
    # ... restore logic ...
    cached_was_restored = True

# In watcher callback (around line 256):
first_snapshot_seen = False

def on_file_change(event):
    nonlocal first_snapshot_seen
    
    if event.get('type') == 'replace_full':
        # Skip the first snapshot if we restored from cache
        if not first_snapshot_seen and cached_was_restored:
            first_snapshot_seen = True
            print(f"[FILE_WATCH] Skipping initial snapshot, cache was restored", file=sys.stderr)
            return
        
        first_snapshot_seen = True
        new_content, new_sha256 = event.get('content', ''), event.get('sha256')
        editor.set_value(new_content)
        # ... rest of callback ...
```

This way:
- If cache was restored, skip the first watcher snapshot
- Subsequent disk changes (real file modifications) still trigger updates
- Cache edits are preserved on page load
