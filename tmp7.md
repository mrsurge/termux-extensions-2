# Framework Shells Implementation Review — Beefs

**Date:** December 15, 2025  
**Reviewer:** Atlas

**Approach:** We're going for a **"break then fix"** approach, not a "fallback safety" approach. The new `framework_shells/` package should fully replace `app.libs.framework_shells` — no compatibility shims, no try/except fallbacks.

---

## Issue 0: Migration incomplete — TE2 still using old system

The new `framework_shells/` package exists but TE2 hasn't been migrated to use it.

All app code still imports from the old location:
```python
from app.libs.framework_shells import get_manager, FrameworkShellManager
```

One place (`sessions_and_shortcuts/main.py`) has a try/except that attempts to import from the new package, but this fallback pattern contradicts the "break then fix" approach.

**Action:** Fully migrate TE2 to use `framework_shells/` package. No fallbacks.

---

## Issue 1: Missing `shutil` import in CLI

**File:** `framework_shells/cli/main.py`  
**Line:** 109

```python
dtach_bin = shutil.which("dtach") or "dtach"
```

`shutil` is never imported at the top of the file. This will crash on `fs attach`.

---

## Issue 2: `TE_REPO_FINGERPRINT` not set for standalone CLI

**File:** `framework_shells/cli/main.py`

The CLI handles missing `FRAMEWORK_SHELLS_SECRET` by generating a temporary one, but `RuntimeStore.__init__()` will still raise because `TE_REPO_FINGERPRINT` is required (store.py line 36).

Standalone CLI usage is broken — you can't run `fs list` without the full env var setup from `run_framework.sh`.

---

## Issue 3: Dead/confusing code in `store.py`

**File:** `framework_shells/store.py`  
**Lines:** 19-35

```python
if not fingerprint:
    # Fallback for dev/debug if env var missing but secret present
    # or raise? Plan says: "Hard prerequisites".
    # But let's be slightly robust for testing.
    if not os.getenv("FRAMEWORK_SHELLS_ALLOW_NO_FINGERPRINT"):
         pass # Warning or error?
         # Actually, run_framework.sh exports it.
         # If running via 'fs', we need to compute it or rely on existing files.
         # For now, let's assume TE_REPO_FINGERPRINT is set by the environment
         # or we compute it on the fly if needed (duplicates logic).
         pass

if not fingerprint:
     # Try to compute it if we are in a recognizable repo
     # This is a bit tricky for a pipx installed package.
     # Let's rely on the env var being set or raise validation error.
     if not os.environ.get("TE_REPO_FINGERPRINT"):
          raise RuntimeError("TE_REPO_FINGERPRINT environment variable is required")
```

Multiple `pass` statements that do nothing. The nested `if` checks the same condition twice. This is confusing WIP code that should be cleaned up — either implement the fallback or just raise cleanly.

---

## Issue 4: Missing `Path` import in FastAPI router

**File:** `framework_shells/api/fastapi_router.py`  
**Line:** 109

```python
path = Path(record.stdout_log)
```

`Path` is never imported. The `/replay` endpoint will crash.

---

## Issue 5: `get_manager()` creates new instance per request

**File:** `framework_shells/api/fastapi_router.py`  
**Lines:** 13-17

```python
async def get_manager() -> FrameworkShellManager:
    # TODO: Shared instance logic?
    # For now, create one per request or use a global if initialized
    # Ideally should be injected
    return FrameworkShellManager()
```

This is wrong. Each request gets a fresh manager with:
- Empty `_pty` dict (no PTY state)
- Fresh `_event_bus` reference (events won't reach other requests' subscribers)
- No adoption of existing shells on first call

The event bus model requires a singleton manager. The execution plan Phase 6.2 shows the correct pattern with `get_te2_manager()`.

---

## Issue 6: `ensure_framework_secret()` called before `REPO_ROOT` is set

**File:** `scripts/run_framework.sh`  
**Lines:** 83-113 vs 183

The functions `compute_repo_fingerprint()` and `ensure_framework_secret()` are defined starting at line 83, and `ensure_framework_secret` is **called** on line 113.

But `REPO_ROOT` isn't set until line 183:
```bash
REPO_ROOT="$(cd "$(dirname "$REAL_SCRIPT")/.." && pwd)"
```

With `set -u` (unbound variable check), this crashes:
```
scripts/run_framework.sh: line 86: REPO_ROOT: unbound variable
```

The call to `ensure_framework_secret` needs to be moved **after** `REPO_ROOT` is set.

---

## Summary

| # | File | Issue | Severity |
|---|------|-------|----------|
| 0 | `app/**/*.py` | Migration incomplete — still using `app.libs.framework_shells` | Blocker |
| 1 | `cli/main.py` | Missing `import shutil` | Crash |
| 2 | `cli/main.py` | `TE_REPO_FINGERPRINT` not handled | Crash |
| 3 | `store.py` | Dead code / confusing logic | Cleanup |
| 4 | `api/fastapi_router.py` | Missing `from pathlib import Path` | Crash |
| 5 | `api/fastapi_router.py` | Manager not singleton | Broken events/state |
| 6 | `run_framework.sh` | `ensure_framework_secret()` called before `REPO_ROOT` set | Crash |

—Atlas
