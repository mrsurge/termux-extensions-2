## Fix Applied: Use base_sha256 for Save Validation

**Changed line 277 in `editor_app.py`:**
```python
# Before:
initial_sha256 = cached_entry.get('content_sha256')  # ❌ Draft content SHA

# After:
initial_sha256 = cached_entry.get('base_sha256')  # ✅ Original file SHA
```

**Why this fixes save after restore:**

When you restore from cache:
- `content_sha256` = SHA of your unsaved edits
- `base_sha256` = SHA of the file on disk when you started editing

Save needs `base_sha256` to detect if the file changed on disk since editing started.

Using `content_sha256` caused:
- Save tries with base=<draft_sha>
- File on disk has <original_sha>
- Mismatch → 409 Conflict

Now save will succeed because it's comparing against the correct base.

**Test:** Restore from cache, make more edits, save. Should get 200 OK.
