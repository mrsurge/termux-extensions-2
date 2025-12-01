# Git Status Tree Rendering - Session Log

**Date:** 2025-12-01  
**Author:** VectorArc

---

## Original Issue

After implementing Steps 1-3 of the Explorer Card Menu restoration plan (git actions: stage, unstage, restore; file actions: copy/move/rename; clipboard actions), a regression was discovered:

- Git statuses were not rendering correctly on the explorer tree
- Parent directories were not inheriting their children's git statuses
- The "breadcrumb trail" (orange outline) to modified files was broken

---

## Root Cause Analysis

### Problem 1: Backend git handlers didn't refresh tree

Git operation handlers in `explorer_ws.py` only broadcast `git:status` (footer summary) but did NOT update tree entries with new `gitStatus` values.

### Problem 2: Priority-based directory inheritance was wrong

`_derive_git_status()` used `_select_highest_priority()` which would return `staged` instead of `modified` for directories with mixed children. This broke the orange outline breadcrumb.

### Problem 3: Tree collapsed on file open

`main.js` had `scheduleExplorerRefresh()` calls on `replace_full` and `diff_changed` events, causing the entire tree to collapse whenever a file was opened.

### Problem 4: Drawer didn't close on mobile

When clicking a file in the tree, the drawer wasn't closing on mobile/portrait view.

---

## What We Implemented

### 1. New `explorer:updateGitStatus` WebSocket event

**Backend (`explorer_helper.py`):**
- Added `get_all_git_statuses()` - returns map of `rel_path -> gitStatus` for all files with non-clean status

**Backend (`explorer_ws.py`):**
- Added `broadcast_git_decorations()` helper
- All git handlers now call `mark_git_cache_dirty()` + `broadcast_git_decorations()`:
  - `handle_git_stage`
  - `handle_git_unstage`
  - `handle_git_stageAll`
  - `handle_git_unstageAll`
  - `handle_git_restore`
  - `handle_git_commit`
  - `handle_git_pull`
  - `handle_git_reset`

**Frontend (`explorer.js`):**
- Added `explorer:updateGitStatus` handler that:
  1. Clears all `fe-git-*` and `fe-dir-has-*` classes from all nodes
  2. Applies file statuses to DOM nodes
  3. Computes ancestor directories from path strings (not DOM traversal)
  4. Applies appropriate classes to directories

### 2. Fixed directory inheritance logic

**Backend (`explorer_helper.py` - `_derive_git_status()`):**

Changed from priority-based selection to explicit status categorization:

- **Orange outline statuses** (`modified`): `modified`, `staged`, `staged_modified`, `added`, `deleted`, `renamed`, `conflict`
- **Blue background statuses** (`untracked`): `untracked` (only if no orange-outline children)
- **Excluded**: `clean`, `ignored`

Directories now return:
- `modified` if ANY child has an orange-outline status
- `untracked` if children are only untracked (no tracked changes)
- `clean` otherwise

### 3. Fixed tree collapse on file open

**`main.js`:**
- Removed `scheduleExplorerRefresh()` calls from `replace_full` and `diff_changed` event handlers
- Git status updates are now handled by `explorer:updateGitStatus` without full tree refresh

### 4. Fixed drawer not closing on mobile

**`explorer.js`:**
- Added `closeDrawerIfMobile()` call after `appOpenFileRel()` in tree click handler

### 5. Frontend directory class application

**`explorer.js` - `explorer:updateGitStatus` handler:**

Now applies BOTH class systems:
- `fe-git-modified` / `fe-git-untracked` - direct status classes
- `fe-dir-has-modified` / `fe-dir-has-untracked` - aggregated flags for CSS styling

The CSS uses `fe-dir-has-*` classes for directory backgrounds:
- `.fe-dir-has-untracked` → blue background
- `.fe-dir-has-staged` → green background
- `.fe-dir-has-untracked.fe-dir-has-staged` → blue→green gradient

---

## Current State (Unverified)

The following behaviors are intended but not yet confirmed working:

1. **Orange outline breadcrumb**: Directories containing `modified`, `staged`, `staged_modified`, `added`, `deleted`, `renamed`, or `conflict` files should show orange outline all the way to project root

2. **Blue background for untracked**: Directories containing ONLY `untracked` files (no tracked changes) should show blue background

3. **Mixed state**: Directory with both tracked changes AND untracked files should show orange outline (modified wins) plus blue background via `fe-dir-has-untracked`

4. **Ignored files**: Should NOT trigger any parent styling

5. **Tree preservation**: Tree expansion state should be preserved during git operations and file opens

6. **Drawer behavior**: Should close on mobile when file is clicked

---

## Files Modified

- `app/apps/file_editor_cm6/explorer_helper.py`
  - Added `get_all_git_statuses()`
  - Rewrote `_derive_git_status()` with explicit status categorization

- `app/apps/file_editor_cm6/explorer_ws.py`
  - Added import for `get_all_git_statuses`
  - Added `broadcast_git_decorations()` method
  - Updated all git handlers to call it

- `app/apps/file_editor_cm6/static/js/explorer.js`
  - Added `explorer:updateGitStatus` handler with 7-step process
  - Added `closeDrawerIfMobile()` to tree file click handler
  - Removed `refreshOpenDirectoriesAfterGit()` call from `git:status` handler

- `app/apps/file_editor_cm6/main.js`
  - Removed `scheduleExplorerRefresh()` calls from `replace_full` and `diff_changed` handlers

---

## Potential Issues to Investigate

1. **Initial render vs live update**: The `explorer:updateGitStatus` event only fires after git operations. Initial tree render uses `list_dir()` → `_derive_git_status()`. Both paths need to produce consistent results.

2. **Collapsed directories**: The frontend computes ancestor paths from status keys (string manipulation), which should work for collapsed directories. But the CSS class application requires the DOM node to exist.

3. **Two class systems**: There are now two overlapping systems:
   - `fe-git-*` classes (direct status)
   - `fe-dir-has-*` classes (aggregated from children)
   
   Both need to be applied correctly and cleared together.

4. **Root node handling**: The root node uses `data-rel="."` which may need special handling in path computations.

---

— **VectorArc**, 2025-12-01T01:50:00Z
