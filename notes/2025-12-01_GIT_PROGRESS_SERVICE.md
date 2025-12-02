# Git Progress Service Implementation Log

**Date:** 2025-12-01  
**Author:** VectorArc

---

## Overview

Implementation of GitPython-based push/pull/clone operations with structured progress reporting, integrated with the Job Registry, and bridged to the explorer WebSocket for real-time progress updates in Code CM6.

---

## Session Timeline

### Initial Implementation (18:00 UTC)

**Files Created:**
- `app/libs/git_service.py` (~440 lines)
  - `CallbackProgress(RemoteProgress)` — GitPython progress wrapper
  - `git_push_with_progress()` — push with callback
  - `git_pull_with_progress()` — pull with callback
  - `git_clone_with_progress()` — clone with callback
  - `@register_job_handler("git_push")`
  - `@register_job_handler("git_pull")`
  - `@register_job_handler("git_clone")`

**Files Modified:**
- `app/apps/file_editor_cm6/explorer_ws.py`
  - Added job listener bridge in `ExplorerDispatcher`
  - `_pump_job_events()` task to forward job progress to WS clients
  - `handle_git_push` / `handle_git_pull` now create jobs instead of direct CLI calls
  - Added `handle_git_clone` for WS-based clone with progress

- `app/apps/file_editor_cm6/static/js/explorer.js`
  - Added `job:progress` event handler
  - Added `git:pushStarted` / `git:pullStarted` / `git:cloneStarted` handlers
  - Added `showGitProgressBar()` / `hideGitProgressBar()` helpers
  - Ephemeral progress bar at top of git footer
  - Right-aligned progress text in status row

---

### Bug #1: Job Progress Events Not Forwarded (18:30 UTC)

**Symptom:** No `job:progress` events reaching frontend despite job creation.

**Root Cause:** `Job.to_public_dict()` does not include `params`, so filtering by `repo_path` in the pump task always failed (params was empty).

**Fix:** Changed filtering strategy to track job IDs locally:
- Added `_tracked_job_ids: set` to `ExplorerDispatcher`
- When creating a job, add its ID to the tracking set
- Only forward `job:progress` events for tracked job IDs
- Remove from tracking when job completes (succeeded/failed/cancelled)

---

### Bug #2: "Unknown job type: git_push" (18:45 UTC)

**Symptom:** Server log showed `ValueError: Unknown job type: git_push`

**Root Cause:** Job handlers registered via `@register_job_handler` only execute when the module is imported. The main framework's `load_services()` imports `app/libs/*.py`, but Code CM6 runs in a **separate worker process** that doesn't run `load_services()`.

**Fix:** Added explicit import in `explorer_ws.py`:
```python
# Import git_service to register job handlers in worker process
import app.libs.git_service  # noqa: F401 - registers git_push, git_pull, git_clone handlers
```

**Lesson Learned:** Worker processes are isolated. Any module with `@register_job_handler` decorators must be imported in the worker context, not just the main framework.

---

### Bug #3: Progress Bar "Boomerang" Effect (19:00 UTC)

**Symptom:** When hiding the progress bar, it animated back to 0% width before disappearing, creating a "boomerang" visual.

**Fix:** Changed hide behavior to fade opacity first, then reset dimensions:
```javascript
function hideGitProgressBar() {
  if (gitProgressBarEl) {
    gitProgressBarEl.style.opacity = '0';
    setTimeout(() => {
      if (gitProgressBarEl && gitProgressBarEl.style.opacity === '0') {
        gitProgressBarEl.style.width = '0';
        gitProgressBarEl.style.height = '0';
      }
    }, 300);
  }
  // Similar for progress text...
}
```

---

### Enhancement: Git Status Flash (19:05 UTC)

**Feature:** When git status values change (staged/unstaged/untracked/ahead/behind counts), the status bar text briefly flashes blue to draw attention.

**Implementation:**
- Track previous values in `prevGitStatus` object
- Compare on each render
- If changed (and not initial load), apply blue color with CSS transition
- Reset to default after 400ms

---

## Final Architecture

```
User clicks Push/Pull
       ↓
explorer.js → __explorerBusSend('git:push', {...})
       ↓
explorer_ws.py → handle_git_push() → job_manager.create_job("git_push", {...})
       ↓                            → _tracked_job_ids.add(job.id)
       ↓                            → emit "git:pushStarted"
       ↓
git_service.py → job_git_push() runs in background thread with GitPython
       ↓
CallbackProgress.update() → ctx.set_progress() → job_manager.notify_job_update()
       ↓
ExplorerDispatcher._pump_job_events() → filters by _tracked_job_ids
       ↓                              → emit_personal("job:progress", ...)
       ↓
explorer.js → case 'job:progress': → showGitProgressBar(pct, detail)
       ↓
On completion → hideGitProgressBar() with fade animation
             → git:status refresh
             → toast notification
```

---

## Files Modified (Final List)

| File | Changes |
|------|---------|
| `app/libs/git_service.py` | **NEW** - GitPython wrappers + job handlers |
| `app/apps/file_editor_cm6/explorer_ws.py` | Job bridge, tracked IDs, git handlers |
| `app/apps/file_editor_cm6/static/js/explorer.js` | Progress bar UI, event handlers, status flash |

---

## Testing Verified

- [x] Push with progress bar animation
- [x] Pull with progress bar animation  
- [x] Clone job handler registered
- [x] Progress bar fades out smoothly (no boomerang)
- [x] Git status text flashes blue on change
- [x] Job tracking correctly filters events per-client
- [x] Cleanup on job completion removes from tracking set

---

**Session End:** 2025-12-01T19:05:00Z

— *VectorArc*
