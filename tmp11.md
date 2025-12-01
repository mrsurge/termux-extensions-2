# Explorer Card Menu Actions Restoration Plan

**Date:** 2025-12-01  
**Author:** VectorArc

---

## Overview

This plan documents the missing context menu ("⋮") actions in the current `explorer.js` (v2 / WS-driven) compared to the legacy `OLD_EXPLORER/explorer.js`, and outlines the steps to restore full feature parity.

---

## Gap Analysis

### Current v2 Explorer Card Menu (as implemented)

| For Dirs | For Files |
|----------|-----------|
| New File… | — |
| New Folder… | — |
| Rename… | Rename… |
| Delete | Delete |

### Legacy Explorer Card Menu (OLD_EXPLORER/explorer.js)

**Directory actions:**
- Enable select mode
- Add File
- Add Directory
- Open in File Explorer
- Rename
- Copy Name
- Copy Path
- Copy to…
- Move to…
- Copy from…
- Move from…
- Delete

**File actions:**
- Rename
- Copy Name
- Copy Path
- Copy to…
- Move to…
- Stage (conditional: `modified`, `untracked`, `added`)
- Unstage (conditional: `staged`, `staged_modified`)
- Restore… (conditional: file + dirty git status)
- Delete

**Select Mode actions (when enabled):**
- Disable select mode
- Copy selected (N)
- Move selected (N)
- Stage selected (N)
- Unstage selected (N)
- Delete selected (N)

---

## Missing Actions to Restore

### 1. File Actions (Git-related)

| Action | Condition | WS Event | Backend Handler |
|--------|-----------|----------|-----------------|
| **Stage** | `gitStatus` ∈ {modified, untracked, added} | `git:stage` | `handle_git_stage` |
| **Unstage** | `gitStatus` ∈ {staged, staged_modified} | `git:unstage` | `handle_git_unstage` |
| **Restore…** | file + `gitStatus` ≠ clean | `git:restore` | `handle_git_restore` |

### 2. File & Directory Actions (Clipboard / Move / Copy)

| Action | Scope | WS Event | Backend Handler |
|--------|-------|----------|-----------------|
| **Copy Name** | both | N/A (client-side clipboard) | N/A |
| **Copy Path** | both | N/A (client-side clipboard) | N/A |
| **Copy to…** | both | `explorer:copy` | `handle_explorer_copy` |
| **Move to…** | both | `explorer:move` | `handle_explorer_move` |
| **Copy from…** | dir only | `explorer:copyFrom` | `handle_explorer_copyFrom` |
| **Move from…** | dir only | `explorer:moveFrom` | `handle_explorer_moveFrom` |

### 3. Directory-Specific Actions

| Action | WS Event | Backend Handler |
|--------|----------|-----------------|
| **Open in File Explorer** | N/A (REST + redirect) | `/api/apps/file_explorer/open` |

### 4. Multi-Select Mode

| Action | WS Event | Backend Handler |
|--------|----------|-----------------|
| **Enable select mode** | N/A (client state) | N/A |
| **Disable select mode** | N/A (client state) | N/A |
| **Copy selected** | `explorer:batchCopy` | `handle_explorer_batchCopy` |
| **Move selected** | `explorer:batchMove` | `handle_explorer_batchMove` |
| **Stage selected** | `git:stage` (with `paths: [...]`) | `handle_git_stage` |
| **Unstage selected** | `git:unstage` (with `paths: [...]`) | `handle_git_unstage` |
| **Delete selected** | `explorer:batchDelete` | `handle_explorer_batchDelete` |

---

## Implementation Plan

### Phase 1: Client-Side Only Actions

**Step 1.1 – Add `Copy Name` and `Copy Path` menu items**
- Add items to `openCardMenuForEntry()` in `explorer.js`
- Use `navigator.clipboard.writeText()` for clipboard access
- Show toast on success/failure
- No backend changes required

### Phase 2: Single-Entry File/Dir Actions

**Step 2.1 – Add `Copy to…` and `Move to…` actions**
- Add menu items for both files and directories
- Integrate with `window.teFilePicker.openDirectory()` for destination selection
- Send `explorer:copy` / `explorer:move` via WS bus
- Backend handlers already exist (verify in `explorer_ws.py`)

**Step 2.2 – Add `Copy from…` and `Move from…` actions (directory only)**
- Add menu items (visible only for `kind === 'dir'`)
- Integrate with `window.teFilePicker.openFile()` or `openDirectory()` for source selection
- Send `explorer:copyFrom` / `explorer:moveFrom` via WS bus
- Backend handlers already exist (verify in `explorer_ws.py`)

**Step 2.3 – Add `Open in File Explorer` action (directory only)**
- Add menu item (visible only for `kind === 'dir'`)
- Use REST call: `POST /api/apps/file_explorer/open` with `{ params: { path } }`
- Redirect to returned URL on success

### Phase 3: Git Actions for Individual Entries

**Step 3.1 – Add `Stage` action**
- Add menu item conditionally: `gitStatus` ∈ {`modified`, `untracked`, `added`}
- Send `git:stage` with `{ paths: [entry.rel] }` via WS bus
- Verify `handle_git_stage` exists in `explorer_ws.py`

**Step 3.2 – Add `Unstage` action**
- Add menu item conditionally: `gitStatus` ∈ {`staged`, `staged_modified`}
- Send `git:unstage` with `{ paths: [entry.rel] }` via WS bus
- Verify `handle_git_unstage` exists in `explorer_ws.py`

**Step 3.3 – Add `Restore…` action**
- Add menu item conditionally: file only + `gitStatus` exists and ≠ `clean`
- Show confirmation dialog (warn about discarding changes)
- Send `git:restore` with `{ path: entry.rel, commit: 'HEAD' }` via WS bus
- Verify `handle_git_restore` exists in `explorer_ws.py`
- Trigger file reload if currently open file is restored

### Phase 4: Multi-Select Mode

**Step 4.1 – Add select mode state management**
- Add `selectModeDir` and `selectedEntries` Set to module state
- Implement `isInSelectMode(parentRel)` helper
- Implement `enableSelectMode(entry)` and `disableSelectMode()` functions
- Trigger tree re-render when entering/exiting select mode

**Step 4.2 – Render checkboxes in select mode**
- Modify `renderEntriesInto()` to render checkboxes when parent is in select mode
- Handle checkbox change events to update `selectedEntries` set

**Step 4.3 – Add batch action menu items**
- When `isInSelectMode(entry.rel)` is true, show select-mode menu:
  - Disable select mode
  - Copy selected (N)
  - Move selected (N)
  - Stage selected (N)
  - Unstage selected (N)
  - Delete selected (N)

**Step 4.4 – Implement batch action handlers**
- `batchCopyTo()`: Use file picker, send `explorer:batchCopy`
- `batchMoveTo()`: Use file picker, send `explorer:batchMove`
- `batchStage()`: Send `git:stage` with `{ paths: [...] }`
- `batchUnstage()`: Send `git:unstage` with `{ paths: [...] }`
- `batchDelete()`: Confirm, send `explorer:batchDelete`

### Phase 5: Backend Verification & Wiring

**Step 5.1 – Audit `explorer_ws.py` for required handlers**
Verify existence and correct implementation of:
- `handle_explorer_copy`
- `handle_explorer_move`
- `handle_explorer_copyFrom`
- `handle_explorer_moveFrom`
- `handle_explorer_batchCopy`
- `handle_explorer_batchMove`
- `handle_explorer_batchDelete`
- `handle_git_stage`
- `handle_git_unstage`
- `handle_git_restore`

**Step 5.2 – Add any missing handlers**
- Implement missing handlers following existing patterns
- Ensure each handler broadcasts appropriate state updates:
  - `explorer:setList` for parent directory refresh
  - `git:status` for git state changes
  - `explorer:updateDecorations` for draft flag updates

### Phase 6: Testing Plan Creation

**Step 6.1 – Create a comprehensive testing plan**
- Document test cases for each action
- Include edge cases (e.g., missing files, permission errors, non-git repos)
- Cover mobile/desktop layout differences
- Test select mode state persistence across tree refreshes

---

## Dependencies

1. **File Picker** (`window.teFilePicker`) – Required for destination/source selection
2. **WS Bus** (`window.__explorerBusSend`) – Required for all backend operations
3. **Clipboard API** (`navigator.clipboard`) – Required for Copy Name/Path

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Missing backend handlers | Phase 5.1 audit; add handlers if missing |
| Select mode state lost on tree refresh | Store `selectModeDir` and restore after refresh |
| File picker unavailable | Show toast "File picker not available" |
| Clipboard API blocked | Fallback to `document.execCommand('copy')` or toast error |

---

## Sign-off

This plan covers all missing context menu actions identified through comparison of the legacy and current explorer implementations. Execution should proceed phase-by-phase, with each phase tested before moving to the next.

— **VectorArc**, 2025-12-01
