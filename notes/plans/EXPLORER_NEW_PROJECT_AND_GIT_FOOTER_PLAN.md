# Explorer Drawer Enhancements: New Project & Git Footer Actions

**Date:** 2025-11-16 05:40:00 UTC  
**Scope:** `file_editor_cm6` explorer drawer header/footer  
**Status:** Draft – ready for implementation

---

## Goals
1. **New Project Control (Section 2.A in main plan):**
   - Add a "New Project…" button next to "Open Project…" in the drawer header.
   - Presents a warning modal outlining that a new project directory will be created.
   - Launches the shared file picker (`window.teFilePicker`) to choose destination and project name.
   - Calls a backend endpoint to scaffold the project (create directory, optional boilerplate) before switching active project.

2. **Footer Git Actions (Section 3.C in main plan):**
   - Separate basic file operations from git actions via a horizontal divider in the card menus.
   - Expose per-item git operations (stage, unstage, restore) via the `...` menu.
   - Add global git controls in the footer:
     - `Reset Hard…` button with commit picker modal.
     - `Init Repository` button (visible when repo absent).

---

## Implementation Steps

### 1. New Project Button & Flow
1.1 **UI Layout**
- Modify `app/apps/file_editor_cm6/template.html` header to include a secondary button `#fe-new-project`.
- Style it in `explorer.css` to match existing controls (solid background, hover states).

1.2 **Modal & Picker**
- In `explorer.js`, add `openNewProjectPrompt()`:
  - Show a confirmation modal explaining that a directory will be created.
  - On confirm, call `window.teFilePicker.openDirectory({ startPath: '~', selectLabel: 'Use Folder' })` to choose a parent directory.
  - Prompt for project folder name (input box).

1.3 **Backend Endpoint**
- Add `/project/create` endpoint in `main.py`:
  - Validates target path and name via `explorer_helper`.
  - Creates directory (`mkdir`) and optional scaffolding.
  - Marks git cache dirty and updates `history_store` active project.

1.4 **UX Flow**
- After success, toast confirmation and reload the page (same as `openProjectPrompt`).
- Ensure the new project shows up in recents/state.

### 2. Git Footer Enhancements
2.1 **Card Menu Separator**
- Update `buildMenuItems()` in `explorer.js` to insert a divider between basic file ops (add/rename/delete) and git actions (stage/unstage/restore).

2.2 **Per-Item Git Actions**
- Extend menu items when `entry.gitStatus` warrants it:
  - `Stage` (if modified/untracked).
  - `Unstage` (if staged/staged_modified).
  - `Restore…` (opens commit list modal for that path).
- Implement handlers that call new endpoints:
  - `/git/stage_item`, `/git/unstage_item`, `/git/restore_path`.

2.3 **Footer Buttons**
- In `template.html`, augment footer with:
  - `Reset Hard…` (`#fe-git-reset-hard`)
  - `Init Repo` (`#fe-git-init`)
- Only show Reset/Init depending on repo status (`gitStatusCache.isRepo`).

2.4 **Modals**
- Implement shared modal component for commit selection:
  - `fetch('/api/app/file_editor_cm6/git/commits')` for global reset.
  - `fetch('/api/app/file_editor_cm6/git/commits_for_path?rel=...')` for per-file restore.

2.5 **Backend Support**
- Extend `git_helper.py` with helpers for:
  - `list_commits(root, limit=50)`
  - `list_commits_for_path(root, rel)`
  - `reset_hard(root, commit)`
  - `restore_path(root, rel, commit)`
- Add endpoints in `main.py` as outlined above.

### 3. Testing & Validation
- Confirm new project flow creates directories, updates active project, and reloads explorer.
- Verify card menu shows correct git actions per entry state, and git endpoints mutate status appropriately.
- Test Reset Hard and Init buttons with/without existing repos.
- Ensure modals close on success/failure and toasts display messages.

---

## Deliverables
- Updated template (`template.html`), stylesheet (`explorer.css`), script (`explorer.js`), backend endpoints (`main.py`), helper functions (`explorer_helper.py`, `git_helper.py`).
- Optional: new modal markup in template or shared component re-use.
- Documentation updates in `notes/2025-11-16_EXPLORER_REWRITE_PROGRESS_LOG.md` upon completion.

---

## Risks & Mitigations
- **Directory creation safety:** enforce project root sandboxing and warn users before creating directories outside `~/`.
- **Git operations:** provide clear warnings/toasts for destructive actions (reset hard, restore).
- **Shared File Picker availability:** guard with fallback alert if `window.teFilePicker` is missing.
