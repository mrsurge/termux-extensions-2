# Multi-File Session Draft Architecture

**Date:** 2025-11-28
**Status:** Implemented (Backend/Core Logic), Pending (Explorer UI Polish)
**Context:** Enabling "code-server" style persistence where unsaved changes across multiple files survive reloads, crashes, and navigation.

---

## 1. Core Philosophy: Disk-Backed Ephemerality

The architecture adheres to a strict "Single Source of Truth" (SSOT) model where the **Disk** is the primary authority, and **Session Sidecars** are the overlay authority for unsaved work.

*   **No Browser State:** `localStorage` or in-memory browser caches are strictly forbidden for document content.
*   **No Database:** Persistence relies on the filesystem.
*   **Convergence:** The backend reconciles the "Real File" (Git/Disk) with the "Draft File" (Sidecar) at the moment of access.

---

## 2. Persistence Layer: The Sidecar Model

### 2.1 Storage Mechanism
Drafts are stored as individual JSON "sidecar" files in `~/.cache/cm6_sessions/`.
*   **Keying:** SHA1 hash of `"{project_root}::{file_absolute_path}"`. This ensures unique keys per file per project while handling symlinks via normalization.
*   **Schema:**
    ```json
    {
      "project_path": "/data/.../project",
      "file_path": "/data/.../project/src/main.py",
      "content": "...",
      "base_sha256": "a1b2...",  // SHA of the disk file when editing started
      "content_sha256": "c3d4...", // SHA of the draft content
      "unsaved": true,
      "updated_at": "2025-11-28T..."
    }
    ```

### 2.2 The "Unsaved" Contract
A sidecar is only considered a valid draft if `unsaved: true`. This flag is calculated during persistence:
`unsaved = (content_sha256 != base_sha256)`

If `unsaved` is false, the sidecar effectively says "The user was editing, but the content matches the disk." In this case, the system ignores the draft and loads from disk to ensure freshness.

---

## 3. The Lifecycle of a Draft

### 3.1 Creation (The Debounce Loop)
1.  **User types:** Frontend sends updates to NiceGUI backend.
2.  **`_on_editor_change`:** Updates `editor._cached_content` immediately.
3.  **Debounce:** A 1-second timer schedules `_persist_to_cache_debounced`.
4.  **Persist:** The backend writes the sidecar. It uses `get_current_file_sha256()` as the `base_sha256`.

### 3.2 Context Switching (The Immediate Flush)
When a user switches from File A to File B:
1.  **Frontend:** Calls `set_content` for File B.
2.  **Backend (`set_editor_content`):**
    *   Detects `old_path` (File A) is different from `new_path`.
    *   Calls `_persist_active_draft_immediately(reason='switch')`.
    *   **Crucial:** This bypasses the debounce timer to ensure File A's latest state is flushed to disk *before* the editor buffer is replaced with File B.

### 3.3 Restoration (The Handshake)
When opening a file (File A):
1.  **Frontend (`main.js`):** Calls `apiPost('editor/check_cache', { path: ... })`.
2.  **Backend:** Checks if a sidecar exists with `unsaved: true`.
3.  **Frontend:**
    *   If `has_draft: true`: Sends the **Draft Content** and the **Base SHA** (from the sidecar) to `set_content`.
    *   If `has_draft: false`: Reads the file from disk (`/read`) and sends **Disk Content** and **Disk SHA** to `set_content`.

### 3.4 The Safeguard (Backend Override)
To prevent race conditions or frontend logic failures:
*   In `set_editor_content`, the backend checks: "Do I have a draft for this file?"
*   If **Yes**, and the incoming content matches the **Base SHA** (Disk), it assumes the frontend erroneously loaded the disk version.
*   **Action:** The backend forcibly overrides the content with the cached draft.

---

## 4. Conflict Resolution & The Watcher

The system must handle external edits (e.g., `git pull` or external tools) without destroying user drafts.

### 4.1 The "Watcher Wipe" Protection
Previously, any file watcher event caused a draft to be cleared because `Draft != Disk`.
**The Fix:**
1.  Watcher fires `replace_full` with `Disk Content` and `Disk SHA`.
2.  Backend (`_apply_watcher_replace`) retrieves the draft's `base_sha256`.
3.  **Comparison:**
    *   If `Disk SHA == Base SHA`: The disk has not changed relative to when the draft started. This is just an echo or initialization event. **Ignore it.**
    *   If `Disk SHA != Base SHA`: The disk *has* changed. This is a conflict. **Clear the draft** (or in future, prompt for merge).

---

## 5. Multi-File Management ("Review Edits")

### 5.1 Aggregation
The `/review/list` endpoint acts as the registry for all active drafts.
*   It scans `~/.cache/cm6_sessions/*.json`.
*   It filters for entries matching the active project.
*   It returns a list of files that have `unsaved: true`.

### 5.2 Bulk Operations
*   **Save:** Iterates selected files, writes content to disk, updates timestamps, clears sidecars.
*   **Discard:** Deletes sidecars. The editor (if open on a discarded file) listens for this and reverts to disk content immediately via `handle_external_discard`.

---

## 6. Known Issues: Explorer UI & State

While the backend architecture is robust, the frontend visual representation is currently lagging.

### 6.1 State Propagation Lag
*   **Problem:** The Explorer tree ("file cards") relies on a mix of event-based updates (`cm6:draft-updated`) and polling.
*   **Symptom:** When a draft is created or discarded, the yellow accent on the file card may not appear/disappear immediately, or may revert incorrectly when switching files.
*   **Cause:** The event bus (`window.postMessage` from iframe -> host) primarily communicates about the *active* file. Changes to background files (via bulk actions) or the initial state of the tree do not have a robust synchronization mechanism yet.

### 6.2 CSS & Visual Glitches
*   **Problem:** The styling for draft cards is inconsistent.
*   **Symptom:** Highlight accents (yellow borders) might be missing, or conflicting with Git status styling (modified/untracked). The visual hierarchy between "Git Modified" (Orange/Left) and "Draft Modified" (Yellow/Right) is not fully stabilized in the CSS.

---

## 7. Explorer Integration (Server-Driven Draft Awareness)

**Goal:** Keep the explorer tree, review overlay, and inline editor in sync without relying on polling.

1. **`list_dir()` Augmentation**
   * Reads the active project's sidecars via `HistoryStore.list_project_drafts`.
   * Adds `hasDraft: true/false` to every entry before the host renders the card.
   * Result: Draft accents render deterministically during tree builds and survive refreshes.

2. **Tree Rendering**
   * `addTreeChildren()` stamps each `<li>` with `data-has-draft` and applies `.fe-draft` / `.fe-draft-parent` immediately.
   * `cm6:draft-updated` events still work, but now they only update the affected nodes.

3. **Review Overlay Hooks**
   * Clicking either the file header or an individual hunk invokes `openFileAndMaybeJump(rel, line)`.
   * `data-line` attributes on hunk headers / rows preserve the exact line offsets so navigation mirrors “Search by Changes”.

---

## 8. Combined Diff & Minimap Styling

* Draft hunks now propagate explicit `diffKind` tags (`insert-draft`, `delete-draft`).
* Gutters and line numbers emit draft-specific markers (`cm-diff-*-draft`) to keep yellow accents everywhere the git pipeline used red.
* The minimap scans both git and draft decorations and collapses them into color buckets:
  * Git add/delete → green/red (unchanged).
  * Draft add/delete → blue/yellow.
* Result: Users can visually distinguish autosaved-on-disk changes (git) from unsaved drafts in both the editor gutter and the minimap.

---

## 9. Autosave & Draft Diff Interop

* Autosave mode suppresses sidecar writes and streams changes straight to disk, but it still emits draft diff decorations until the save completes (so the user sees yellow indicators during the write).
* When autosave is toggled on, the backend clears any active draft cache for the current file and broadcasts a `state='clean'` signal; toggling off resumes sidecar persistence immediately.
* The combined diff builder hides draft hunks while autosave is enabled, preventing duplicate highlights once the disk write succeeds.
