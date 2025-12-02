# Project Session Management — Final Implementation Plan

**Date:** 2025-12-02T05:50Z  
**Status:** Approved for Implementation  
**Contributors:** VectorArc, Atlas

---

## Problem Statement

When a project is deleted and re-cloned to the same path, stale session caches, diff bases, and job tracking from the old project contaminate the new one. There is no "project session boundary" — the editor assumes continuity when there is none.

---

## Solution: Per-Project Sidecars with Session Counters

Each project gets a dedicated sidecar file. A session counter detects fresh starts and triggers cache cleanup.

---

## Architecture

### File Structure

```
~/.cache/cm6_editor/
└── projects/
    ├── <sha1_hash_1>.json      # Sidecar for /home/user/project-a
    ├── <sha1_hash_2>.json      # Sidecar for /home/user/project-b
    └── ...
```

**No master ledger.** The existing `history_store.json` remains the source of truth for `active_project` and `recent_projects`. Sidecar path is derived deterministically: `sha1(project_path)` → filename.

### Sidecar Schema

```json
{
  "version": 1,
  "project_path": "/data/data/com.termux/files/home/git-clone/termux-extensions-2",
  "session_count": 3,
  "created_at": "2025-12-01T10:00:00.000Z",
  "last_boot_at": "2025-12-02T05:00:00.000Z",
  
  "diff_base": {
    "ref": "HEAD",
    "commit_sha": "e891f27feeb9526b39f7a36ce189d828edcc2c39"
  },
  
  "session_cache": {
    "<file_cache_key>": {
      "content": "...",
      "content_sha256": "...",
      "base_sha256": "...",
      "unsaved": true,
      "run_id": "...",
      "updated_at": "..."
    }
  },
  
  "tracked_jobs": ["job-abc123", "job-def456"],
  
  "recent_files": [
    "src/main.py",
    "README.md"
  ]
}
```

### What Lives Where

| Data | Location | Reason |
|------|----------|--------|
| `active_project` | `history_store.json` | Global singleton, drives PTY/agent lifecycle |
| `recent_projects` | `history_store.json` | Cross-project, needed for project picker |
| `terminal_shell_id` | `history_store.json` | Runtime state, not editor state |
| `session_count` | Project sidecar | Per-project session boundary |
| `session_cache` | Project sidecar | Per-project drafts |
| `diff_base` | Project sidecar | Per-project comparison ref |
| `tracked_jobs` | Project sidecar | Per-project in-flight ops |
| `recent_files` | Project sidecar | Per-project MRU |

---

## Component Responsibilities

### 1. `main.py` — The Clock

**Role:** Increment session counter on every cold boot.

```python
def initialize_project_session() -> Optional[ProjectSidecar]:
    """Called once at editor boot. Returns the active project's sidecar."""
    project_path = _history_store.get_active_project()
    
    if not project_path or not Path(project_path).exists():
        return None
    
    sidecar = ProjectSidecar.load_or_create(project_path)
    sidecar.increment_session()
    
    if sidecar.session_count == 1:
        # Fresh project switch — clear stale state
        sidecar.clear_session_cache()
        sidecar.clear_tracked_jobs()
    
    sidecar.save()
    return sidecar
```

### 2. Explorer (WebSocket Handlers) — The Gatekeeper

**Role:** Reset session counter on explicit project switch.

```python
def reset_project_session(new_project_path: str) -> None:
    """Called when user explicitly switches projects."""
    # Update active project in master store
    _history_store.set_active_project(new_project_path)
    
    # Get or create sidecar for new project
    sidecar = ProjectSidecar.load_or_create(new_project_path)
    
    # Reset session count — next boot will see 1 and know it's fresh
    sidecar.session_count = 0
    sidecar.clear_session_cache()
    sidecar.clear_tracked_jobs()
    sidecar.save()
    
    # Update module-level reference
    global _active_project_sidecar
    _active_project_sidecar = sidecar
```

### 3. All Other Components — Use `get_project_sidecar()`

```python
from app.apps.file_editor_cm6.stores import get_project_sidecar

def some_function():
    sidecar = get_project_sidecar()
    if not sidecar:
        return  # No project active
    
    # Read/write project-specific state
    diff_base = sidecar.get_diff_base()
    sidecar.set_diff_base("HEAD~5")
    
    cached = sidecar.get_cached_document(file_path)
    sidecar.upsert_cached_document(file_path, content, ...)
```

---

## State Transitions

| Scenario | session_count | Action |
|----------|---------------|--------|
| Normal editor boot (same project) | 5 → 6 | Increment only, keep caches |
| Project switch via explorer | New project: 0 → (next boot) 1 | Clear caches on boot |
| Delete + re-clone same path | Reset to 0 by explorer | Clear caches on boot |
| Crash recovery | 5 → 6 | Keep caches, detect via `run_id` mismatch |

---

## Manual Reset: "Clear Project State"

**Location:** Edit menu  
**Guard:** Confirmation dialog

```
┌─────────────────────────────────────────┐
│  Clear Project State?                   │
│                                         │
│  This will discard:                     │
│  • Unsaved drafts                       │
│  • Diff base setting                    │
│  • Recent files list                    │
│  • Pending job tracking                 │
│                                         │
│  The project itself is not affected.    │
│                                         │
│         [Cancel]    [Clear State]       │
└─────────────────────────────────────────┘
```

**Implementation:**

```python
def clear_project_state(project_path: str) -> bool:
    """Delete the project sidecar entirely."""
    sidecar_path = ProjectSidecar.get_sidecar_path(project_path)
    if sidecar_path.exists():
        sidecar_path.unlink()
        return True
    return False
```

After clearing, next boot creates a fresh sidecar with `session_count = 1`.

---

## Orphan Cleanup

**When:** On startup, before loading active project sidecar.

**Logic:**
```python
def cleanup_orphaned_sidecars():
    """Remove sidecars for projects that no longer exist."""
    sidecar_dir = Path.home() / ".cache" / "cm6_editor" / "projects"
    if not sidecar_dir.exists():
        return
    
    for sidecar_file in sidecar_dir.glob("*.json"):
        try:
            data = json.loads(sidecar_file.read_text())
            project_path = data.get("project_path")
            if project_path and not Path(project_path).exists():
                sidecar_file.unlink()
        except Exception:
            pass  # Corrupt sidecar, leave it
```

---

## Migration Plan

### Phase 1: Create `ProjectSidecar` Class

**File:** `app/apps/file_editor_cm6/project_sidecar.py`

```python
class ProjectSidecar:
    VERSION = 1
    
    def __init__(self, project_path: str):
        self.project_path = str(Path(project_path).resolve())
        self._path = self.get_sidecar_path(self.project_path)
        self._data = self._default_data()
        self._load()
    
    @staticmethod
    def get_sidecar_path(project_path: str) -> Path:
        normalized = str(Path(project_path).resolve())
        hash_key = hashlib.sha1(normalized.encode()).hexdigest()
        return Path.home() / ".cache" / "cm6_editor" / "projects" / f"{hash_key}.json"
    
    @classmethod
    def load_or_create(cls, project_path: str) -> "ProjectSidecar":
        return cls(project_path)
    
    def _default_data(self) -> dict:
        return {
            "version": self.VERSION,
            "project_path": self.project_path,
            "session_count": 0,
            "created_at": _utc_timestamp(),
            "last_boot_at": None,
            "diff_base": {"ref": "HEAD", "commit_sha": None},
            "session_cache": {},
            "tracked_jobs": [],
            "recent_files": [],
        }
    
    def increment_session(self):
        self._data["session_count"] += 1
        self._data["last_boot_at"] = _utc_timestamp()
    
    @property
    def session_count(self) -> int:
        return self._data["session_count"]
    
    @session_count.setter
    def session_count(self, value: int):
        self._data["session_count"] = value
    
    def clear_session_cache(self):
        self._data["session_cache"] = {}
    
    def clear_tracked_jobs(self):
        self._data["tracked_jobs"] = []
    
    def save(self):
        # Atomic write with temp file
        ...
    
    def _load(self):
        # Load from disk if exists
        ...
```

### Phase 2: Wire Boot Sequence

**File:** `app/apps/file_editor_cm6/main.py`

- Call `cleanup_orphaned_sidecars()` on module load
- Call `initialize_project_session()` on module load
- Expose `get_project_sidecar()` in `stores.py`

### Phase 3: Migrate Session Cache + Job Tracking

- Move `get_cached_document`, `upsert_cached_document`, `clear_cached_document` to `ProjectSidecar`
- Move `tracked_jobs` logic from `ExplorerDispatcher` to sidecar
- Update callers to use `get_project_sidecar()`
- Remove old methods from `HistoryStore`

### Phase 4: Migrate Diff Base + Recent Files

- Move `get_diff_base`, `set_diff_base` to `ProjectSidecar`
- Move `recent_files` (per-project) to sidecar
- Keep `recent_projects` (global) in `HistoryStore`
- Update callers

### Phase 5: Wire Explorer Project Switch + UI

- Add `reset_project_session()` calls to open/create/clone flows in `explorer_ws.py`
- Add "Clear Project State" menu item in Edit menu
- Add confirmation dialog
- Test full cycle: open → edit → switch → re-open → manual clear

---

## Summary

| Component | Reads | Writes |
|-----------|-------|--------|
| `main.py` | `history_store`, sidecar | sidecar |
| `explorer_ws.py` | `history_store` | `history_store`, sidecar |
| `editor_app.py` | sidecar | sidecar |
| `git_helper.py` / `diff_helper.py` | sidecar | sidecar |
| Job handlers | sidecar | sidecar |

**Key Insight:** `session_count == 1` means "first boot after switch, clear stale state."

**Nuclear Option:** Delete sidecar file = guaranteed clean slate.

---

*Atlas — TE2 Contributor*  
*2025-12-02T05:50Z*
