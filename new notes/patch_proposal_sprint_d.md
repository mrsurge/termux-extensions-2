# Patch Proposal — Sprint D (Sync Project with Gradle Files)

**Date:** 2025-12-26T01:25:00Z (revised)

## Goal
Add a UI action "Sync Project with Gradle Files" that:

1. Rebuilds the TE2-side dependency model (`te2_android_sidecar.json`)
2. Notifies kotlin-android LSP via `workspace/didChangeConfiguration` so it consumes the updated model

This is **Option A: Quick model rebuild only** — fast, synchronous, no Gradle compile.

---

## Current state

Sprint A–C provide:
- `te2_android_sidecar.json` with dependency model, fingerprints
- `syncFingerprint` that changes when Gradle files change
- Draft diagnostics (SDK/JDK missing hints)
- Explorer diagnostic indicators (red/yellow emoji markers)
- Ghost error suppression during editing

**Gap:** No explicit user-triggered sync. The sidecar updates on save, but users can't force a refresh when they know the environment changed (e.g., set `ANDROID_SDK_ROOT`, installed SDK platform).

---

## Proposed patches (Sprint D)

### 1) Backend endpoint: `/android/sync`

**File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

Add a new POST endpoint:

```python
@editor_router.post('/android/sync')
async def android_sync_project(data: dict = Body(...)):
    """Sync Project with Gradle Files: rebuild dependency model + notify LSP."""
    
    # 1) Get project roots (same logic as save path)
    base_project_root = Path(_history_store.get_active_project() or str(get_project_root()))
    effective_project_root = base_project_root
    try:
        rel_root = _history_store.get_lsp_server_root_rel(str(base_project_root), "kotlin-android")
        if rel_root:
            candidate = (base_project_root / rel_root).expanduser().resolve(strict=False)
            if candidate.exists() and candidate.is_dir():
                effective_project_root = candidate
    except Exception:
        pass
    
    # 2) Rebuild dependency model (fast, <1s)
    from app.apps.file_editor_cm6.android_lang.android_lsp_bridge import update_android_sidecar_for_project
    sidecar_path = await anyio.to_thread.run_sync(
        lambda: update_android_sidecar_for_project(
            project_root=base_project_root,
            effective_project_root=effective_project_root,
        )
    )
    
    # 3) Notify kotlin-android LSP so it consumes updated model
    from ..lsp_ws import send_lsp_notification, _compute_repo_fingerprint
    
    repo_fp = await anyio.to_thread.run_sync(
        lambda: _compute_repo_fingerprint(effective_project_root)
    )
    
    # Collect dirty files from ProjectSidecar
    dirty_files = []
    try:
        from ..project_sidecar import ProjectSidecar
        sidecar = ProjectSidecar.load_or_create(str(base_project_root))
        for entry in sidecar.list_project_drafts():
            fp = entry.get("file_path")
            if fp:
                dirty_files.append(str(fp))
    except Exception:
        pass
    
    # Send didChangeConfiguration with updated fingerprint
    lsp_notified = await send_lsp_notification(
        language_id="kotlin-android",
        project_root=effective_project_root,
        message={
            "jsonrpc": "2.0",
            "method": "workspace/didChangeConfiguration",
            "params": {
                "settings": {
                    "te2Android": {
                        "repoFingerprint": repo_fp,
                        "dirtyFiles": dirty_files,
                    }
                }
            },
        },
        spawn_if_missing=False,
    )
    
    return {
        "ok": True,
        "sidecar_path": str(sidecar_path),
        "lsp_notified": lsp_notified,
    }
```

### 2) Frontend: Add sync button to LSP settings modal

**File:** `app/apps/file_editor_cm6/static/js/main.js` (or wherever LSP modal is defined)

Add a "Sync Project" button in the kotlin-android section of the Language Servers modal:

```javascript
// In the LSP settings modal, kotlin-android section
const syncBtn = document.createElement('button');
syncBtn.className = 'fe-btn fe-btn-secondary';
syncBtn.textContent = '🔄 Sync Project';
syncBtn.title = 'Rebuild dependency model from Gradle files';
syncBtn.onclick = async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = '⏳ Syncing...';
  try {
    const resp = await fetch('/api/app/file_editor_cm6/android/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const json = await resp.json();
    if (json.ok) {
      toast('Project synced successfully');
    } else {
      toast('Sync failed: ' + (json.error || 'unknown error'));
    }
  } catch (e) {
    toast('Sync failed: ' + e.message);
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = '🔄 Sync Project';
  }
};
```

### 3) Concurrency: Add simple lock

To prevent concurrent sync requests from stomping each other:

```python
_android_sync_lock: dict[str, asyncio.Lock] = {}

@editor_router.post('/android/sync')
async def android_sync_project(data: dict = Body(...)):
    # ... get base_project_root ...
    
    lock_key = str(base_project_root)
    if lock_key not in _android_sync_lock:
        _android_sync_lock[lock_key] = asyncio.Lock()
    
    async with _android_sync_lock[lock_key]:
        # ... rest of sync logic ...
```

---

## Acceptance criteria (Sprint D)

- [ ] "Sync Project" button visible in kotlin-android LSP settings
- [ ] Clicking it rebuilds `te2_android_sidecar.json` with fresh dependency model
- [ ] LSP receives `workspace/didChangeConfiguration` with updated fingerprint
- [ ] Toast confirms success/failure
- [ ] Explorer diagnostic dots update after sync completes (via existing broadcast loop)
- [ ] Concurrent clicks are serialized (no stomping)

---

## Explicitly out of scope (Sprint D v1)

- **Gradle compile trigger** — users can save a .kt file to trigger compile; full async compile is a future sprint
- Automatic sync detection (watching Gradle files for changes)
- Progress bar (sync is fast, <1s)

---

## Future: Sprint D.5 or E (Sync & Compile)

If needed later, add explicit Gradle compile via framework_shells/jobs:
- Async job with progress tracking
- Explicit `./gradlew :app:compileDebugKotlin` (or similar)
- Not a didSave hack

---

## Notes

- Endpoint path: `/android/sync` under editor_router → full path `/api/app/file_editor_cm6/android/sync`
- Reuses existing `update_android_sidecar_for_project()` and `send_lsp_notification()`
- The 1s diagnostics broadcast loop in `explorer_ws.py` will pick up any LSP diagnostic changes automatically
