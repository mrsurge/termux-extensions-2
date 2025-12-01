# Explorer Drawer Visual & Functional Redesign Plan

**Date:** 2025-11-16
**Status:** Draft – Ready for Implementation
**Scope:** `file_editor_cm6` explorer drawer (layout, styling, and actions)

---

## 0. Goals & Constraints

- Improve the **visual aesthetics** and **functional power** of the explorer drawer without regressing:
  - Existing session cache, inline diffs, and editor integration.
  - Shared file picker behavior and Git plumbing.
- Keep the **host/frontend display-only** for filesystem and Git mutations:
  - All actual operations (create, rename, copy, move, delete, git) live in backend Python.
  - Frontend calls explicit endpoints and updates its UI based on responses.
- Respect iframe boundaries and vendoring rules from:
  - `docs/core/nicegui_iframe_feature_adding_guideline.md`
  - `docs/core/shared_file_picker.md`
- Preserve existing data flows and entrypoints:
  - Explorer JS module: `app/apps/file_editor_cm6/static/js/explorer.js`
  - Backend helpers: `app/apps/file_editor_cm6/explorer_helper.py`, `git_helper.py`, `history_store.py`
  - App shell: `app/apps/file_editor_cm6/main.py`, `main.js`, `template.html`

Implementation will be staged and feature-flag friendly so we can test incrementally.

---

## 1. Visual Aesthetics Changes

### 1.1 Remove transparency and hover highlight (mobile-safe)

**Intent:** Explorer drawer should use solid colors, and hover affordances should not depend on desktop-only pointer behavior.

**Current state:**
- `explorer.css` line 17: `.fe-drawer` has `backdrop-filter: blur(12px)` and `background: var(--card)`
- `explorer.css` line 54: `.fe-drawer-head` has `background: rgba(from var(--border) r g b / 0.2)` - TRANSPARENCY
- `explorer.css` lines 137-138: `.fe-tree li:hover` has `background: rgba(255, 255, 255, 0.06)` - no mobile guard
- `explorer.css` lines 255-272: Git status backgrounds use `rgba(..., 0.15)` and `rgba(..., 0.22)` on hover
- `template.html` lines 8-12: CSS variables define `--bg: #0b0f1a` and `--card: #0b0f1a`

**Planned changes:**
- In `explorer.css`:
  - **Line 11** `.fe-drawer`: Remove `backdrop-filter: blur(12px)`, ensure solid background
  - **Line 54** `.fe-drawer-head`: Replace `background: rgba(from var(--border) r g b / 0.2)` with solid color like `background: var(--card)` or `#0b1220`
  - **Lines 136-138** `.fe-tree li:hover`: Wrap in `@media (hover: hover) and (pointer: fine)` to disable on touch devices
  - **Lines 275-281** Git status hover states: Wrap in same media query
  - Consider `.fe-drawer-backdrop` (line 38) opacity already transitions properly for mobile
- All backgrounds should use solid colors from existing palette: `var(--bg)`, `var(--card)`, `var(--border)`

**Files / selectors to touch:**
- `app/apps/file_editor_cm6/static/js/explorer.css`:
  - `.fe-drawer` (line 11)
  - `.fe-drawer-head` (line 54)
  - `.fe-tree li:hover` (line 137)
  - `.fe-tree-node.fe-git-modified[data-kind="file"]:hover` (line 275)
  - `.fe-tree-node.fe-git-untracked[data-kind="file"]:hover` (line 279)

### 1.2 Icons on explorer cards + new "..." card menu affordance

**Intent:** Each entry in the tree should read as a card with icon and a standard overflow menu affordance.

**Current state:**
- `explorer.js` lines 480-507: `addTreeChildren()` creates entries with structure: `li > [twisty button][text span]`
- Current DOM per entry (line 494-506):
  ```
  <li class="fe-tree-node" data-kind="..." data-rel="..." data-open="false">
    <button class="fe-tree-twisty">▸/▾/empty</button>
    <span class="fe-tree-text">filename</span>
  </li>
  ```
- `applyEntryStyling()` (lines 640-669) already applies classes: `.fe-entry-dir`, `.fe-entry-exec`, `.fe-entry-file`
- Git badges are already appended to label for files (lines 656-668) as `<span class="fe-git-badge fe-git-badge-modified/untracked">M/U</span>`
- `explorer.css` line 114: `.fe-tree li` uses `display: grid; grid-template-columns: 20px 1fr;`

**Planned changes:**
- In `explorer.js` function `addTreeChildren()` (around line 494-506):
  - After creating `twisty` button and before appending, insert:
    - Icon span element: `<span class="fe-entry-icon fe-entry-icon-{kind}"></span>` where kind is 'dir' or 'file'
    - After text span, add: `<button class="fe-card-menu-btn">⋮</button>` (vertical ellipsis or dots)
  - New structure: `[twisty][icon][text with badges][menu-btn]`
  - Update grid in CSS to accommodate: `grid-template-columns: 20px 20px 1fr auto`
- In `explorer.js`, add click handler for `.fe-card-menu-btn` in `onTreeClick()` or separate listener:
  - Prevent event bubbling to avoid triggering directory expand/collapse
  - Call `showCardMenu(entry, buttonElement)` function (to be created)
- In `explorer.css`:
  - Add `.fe-entry-icon` styles: simple folder/file glyphs using CSS or unicode
  - Add `.fe-card-menu-btn` styles: minimal button, only visible on hover (with mobile media query)
  - Add `.fe-card-menu` styles: floating dropdown menu (reuse `.fe-dropdown` pattern)

**Files / selectors to touch:**
- `app/apps/file_editor_cm6/static/js/explorer.js`:
  - `addTreeChildren()` function (lines 466-511)
  - `onTreeClick()` or new event handler (lines 590-638)
  - New function: `showCardMenu(entry, anchorEl)`
- `app/apps/file_editor_cm6/static/js/explorer.css`:
  - `.fe-tree li` grid update (line 114)
  - New: `.fe-entry-icon`, `.fe-entry-icon-dir`, `.fe-entry-icon-file`
  - New: `.fe-card-menu-btn`
  - New: `.fe-card-menu` (can extend `.fe-dropdown` pattern from template.html)

### 1.3 Project root card fills vertical height & stays expanded

**Intent:** The **project root** should visually anchor the tree: a top-level card that remains expanded and flexes to fill the drawer.

**Current state:**
- `template.html` line 1274-1276: `.fe-drawer-body` contains `<ul id="fe-file-tree" class="fe-tree">` which is the root container
- `explorer.js` lines 454-464: `renderTreeRoot()` calls `addTreeChildren(treeEl, '.')` - root is '.' (current directory)
- `explorer.js` lines 601-637: `onTreeClick()` handles directory expand/collapse - ALL directories including root can be collapsed
- `explorer.css` lines 95-111: `.fe-drawer-body` has `flex: 1; display: flex; flex-direction: column`
- `explorer.css` lines 104-111: `.fe-tree` has `flex: 1; overflow-y: auto`
- Root directory entries are added directly to `#fe-file-tree` without a parent wrapper

**Current issue:**
- The root directory '.' is not represented as a visible node; its children are rendered directly
- There's no persistent "Project" card that stays expanded
- The tree root can become empty if project not selected (line 457-462)

**Planned changes:**
- In `explorer.js` `renderTreeRoot()` (lines 454-464):
  - Instead of directly calling `addTreeChildren(treeEl, '.')`, create a root node:
    ```javascript
    const rootLi = document.createElement('li');
    rootLi.className = 'fe-tree-node fe-tree-root';
    rootLi.dataset.kind = 'dir';
    rootLi.dataset.rel = '.';
    rootLi.dataset.open = 'true';  // Always open
    
    const twisty = document.createElement('button');
    twisty.className = 'fe-tree-twisty';
    twisty.textContent = '▾';  // Always expanded
    
    const text = document.createElement('span');
    text.className = 'fe-tree-text';
    text.textContent = basename(currentProjectPath) || 'Project';
    
    const childList = document.createElement('ul');
    childList.className = 'fe-tree';
    
    rootLi.appendChild(twisty);
    rootLi.appendChild(text);
    rootLi.appendChild(childList);
    treeEl.appendChild(rootLi);
    
    await addTreeChildren(childList, '.');
    ```
- In `explorer.js` `onTreeClick()` (lines 590-638):
  - Check if clicked node has class `fe-tree-root`, if so, ignore collapse (return early)
  - Or check `if (rel === '.' && kind === 'dir') return;`
- In `explorer.css`:
  - Add `.fe-tree-root` styles to make it visually distinct (perhaps bolder, different background)
  - Ensure `.fe-drawer-body` and root `.fe-tree` properly fill height (already correct at lines 95-111)

**Files / selectors to touch:**
- `app/apps/file_editor_cm6/static/js/explorer.js`:
  - `renderTreeRoot()` function (lines 454-464)
  - `onTreeClick()` function (lines 590-638) - add guard for root node
  - May need to update `syncExpandedDirsFromTree()` (lines 520-528) to exclude root
- `app/apps/file_editor_cm6/static/js/explorer.css`:
  - New: `.fe-tree-root` styling

---

## 2. Explorer Card Menu – Basic File Operations

We introduce a per-entry **explorer card menu** (three dots button) and a per-directory top-level menu for batch operations.

All operations will be implemented as **backend endpoints**; frontend merely:
- Opens a modal / file picker as needed.
- Calls the appropriate endpoint with explicit parameters (project root, relative path(s)).
- On success, refreshes the tree and relevant badges.

### 2.1 Menu structure & event model

**Current state:**
- No per-entry menu system exists currently
- `template.html` lines 1300-1319: Existing dropdown pattern uses `.fe-menu`, `.fe-dropdown`, `.fe-dd-item` for Recent Files menu
- Dropdown styling in `template.html` around lines 331-400 (embedded styles)
- No context menu or card menu infrastructure

**Planned changes:**
- Create a single reusable floating menu element in `explorer.js`:
  ```javascript
  // In initExplorerUI() or module scope:
  const cardMenu = document.createElement('div');
  cardMenu.className = 'fe-card-menu';
  cardMenu.style.display = 'none';
  document.body.appendChild(cardMenu);  // or treeElement parent
  
  function showCardMenu(entry, anchorEl) {
    cardMenu.innerHTML = '';  // Clear previous
    cardMenu.style.display = 'block';
    
    // Position near anchor button
    const rect = anchorEl.getBoundingClientRect();
    cardMenu.style.position = 'absolute';
    cardMenu.style.top = `${rect.bottom}px`;
    cardMenu.style.left = `${rect.left}px`;
    
    // Populate based on entry.kind and entry.gitStatus
    const items = buildMenuItems(entry);
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'fe-dd-item';
      div.textContent = item.label;
      if (item.destructive) div.style.color = 'var(--destructive, #ef4444)';
      div.addEventListener('click', () => {
        cardMenu.style.display = 'none';
        item.handler(entry);
      });
      cardMenu.appendChild(div);
    });
  }
  
  function buildMenuItems(entry) {
    const items = [];
    const isDir = entry.kind === 'dir';
    
    // Order from plan section 2.1:
    // 1. Select mode (for directories)
    if (isDir) {
      items.push({ label: 'Enable select mode', handler: enableSelectMode });
    }
    
    // 2. Add directory / Add file (for directories)
    if (isDir) {
      items.push({ label: 'Add directory', handler: addDirectory });
      items.push({ label: 'Add file', handler: addFile });
    }
    
    // 3. Rename
    items.push({ label: 'Rename', handler: renameEntry });
    
    // Divider (CSS: border-top)
    items.push({ label: '---', handler: () => {}, divider: true });
    
    // 5. Copy / move
    items.push({ label: 'Copy to…', handler: copyTo });
    items.push({ label: 'Move to…', handler: moveTo });
    
    // 6. Git stage / unstage (if applicable)
    if (entry.gitStatus === 'modified' || entry.gitStatus === 'untracked') {
      items.push({ label: 'Stage', handler: stageEntry });
    }
    if (entry.gitStatus === 'staged' || entry.gitStatus === 'staged_modified') {
      items.push({ label: 'Unstage', handler: unstageEntry });
    }
    
    // Divider
    items.push({ label: '---', handler: () => {}, divider: true });
    
    // 8. Git restore (for files with git status)
    if (!isDir && entry.gitStatus && entry.gitStatus !== 'clean') {
      items.push({ label: 'Restore…', handler: restoreEntry });
    }
    
    // 9. Delete
    items.push({ label: 'Delete', handler: deleteEntry, destructive: true });
    
    return items;
  }
  ```
- Add event handler for card menu button clicks (prevent propagation, show menu)
- Add outside-click handler to hide menu
- Reuse existing `.fe-dropdown` and `.fe-dd-item` styles from template.html

**Files to touch:**
- `app/apps/file_editor_cm6/static/js/explorer.js`:
  - Add menu creation logic in `initExplorerUI()` or module scope
  - Add `showCardMenu()`, `buildMenuItems()` functions
  - Add handlers: `addDirectory()`, `addFile()`, `renameEntry()`, `copyTo()`, `moveTo()`, `stageEntry()`, `unstageEntry()`, `restoreEntry()`, `deleteEntry()` (initially stubs calling endpoints)
  - Wire up `.fe-card-menu-btn` click events
- `app/apps/file_editor_cm6/static/js/explorer.css`:
  - Reuse `.fe-dropdown` pattern or create `.fe-card-menu` with similar styling

### 2.2 Select mode (batch operations)

**Behavior:**
- Enabled per-directory from that directory’s `...` menu if it contains **>1 item** or is the project root.
- When active for a directory `D`:
  - All child cards inside `D` show checkboxes.
  - Individual child card menus are hidden.
  - The parent `D` card menu gains **batch operations** (copy/move, stage/unstage, delete) that operate on checked entries.
  - Clicking outside the directory or choosing "Disable select mode" exits select mode.

**Current state:**
- No select mode infrastructure exists
- Tree items are rendered in `addTreeChildren()` (explorer.js lines 466-511)
- Grid layout is 2-column: twisty + text (explorer.css line 114)

**Implementation plan:**
- State management in `explorer.js`:
  ```javascript
  let selectModeDir = null;  // rel path of directory in select mode, or null
  const selectedEntries = new Set();  // Set of rel paths currently checked
  
  function enableSelectMode(entry) {
    if (entry.kind !== 'dir') return;
    selectModeDir = entry.rel;
    selectedEntries.clear();
    refreshTree(treeElement);  // Rerender with checkboxes
  }
  
  function disableSelectMode() {
    selectModeDir = null;
    selectedEntries.clear();
    refreshTree(treeElement);
  }
  
  function isInSelectMode(parentRel) {
    return selectModeDir === parentRel;
  }
  ```
- DOM changes in `addTreeChildren()` (lines 466-511):
  - After determining if we're rendering children of `selectModeDir`:
    ```javascript
    // In addTreeChildren(), after creating li:
    if (isInSelectMode(rel)) {  // rel is parent directory
      // Prepend checkbox to each child entry
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'fe-entry-checkbox';
      checkbox.dataset.rel = e.rel;
      checkbox.checked = selectedEntries.has(e.rel);
      checkbox.addEventListener('change', (ev) => {
        ev.stopPropagation();
        if (ev.target.checked) {
          selectedEntries.add(e.rel);
        } else {
          selectedEntries.delete(e.rel);
        }
      });
      li.insertBefore(checkbox, li.firstChild);
      
      // Hide the card menu button
      const menuBtn = li.querySelector('.fe-card-menu-btn');
      if (menuBtn) menuBtn.style.display = 'none';
    }
    ```
- Update grid layout in CSS for checkbox column:
  - `explorer.css` line 114: Add class `.fe-tree-select-mode` and style:
    ```css
    .fe-tree li.fe-tree-select-mode {
      grid-template-columns: 24px 20px 20px 1fr auto;  /* checkbox + twisty + icon + text + menu */
    }
    ```
- Menu for directory in select mode shows batch operations in `buildMenuItems()`:
  ```javascript
  if (isInSelectMode(entry.rel)) {
    // Directory IS in select mode - show disable + batch ops
    items.push({ label: 'Disable select mode', handler: disableSelectMode });
    items.push({ label: '---', divider: true });
    items.push({ label: `Copy selected (${selectedEntries.size})`, handler: batchCopyTo });
    items.push({ label: `Move selected (${selectedEntries.size})`, handler: batchMoveTo });
    items.push({ label: `Delete selected (${selectedEntries.size})`, handler: batchDelete, destructive: true });
    items.push({ label: `Stage selected (${selectedEntries.size})`, handler: batchStage });
    items.push({ label: `Unstage selected (${selectedEntries.size})`, handler: batchUnstage });
  }
  ```
- Backend endpoints needed (to be added in `main.py` after line 651):
  - `POST /explorer/batch_copy` with `{ project, rels: [...], dest_path }`
  - `POST /explorer/batch_move` with `{ project, rels: [...], dest_path }`
  - `POST /explorer/batch_delete` with `{ project, rels: [...] }`
  - `POST /git/batch_stage` with `{ rels: [...] }`
  - `POST /git/batch_unstage` with `{ rels: [...] }`

**Files to touch:**
- `app/apps/file_editor_cm6/static/js/explorer.js`:
  - Module-level state: `selectModeDir`, `selectedEntries`
  - Functions: `enableSelectMode()`, `disableSelectMode()`, `isInSelectMode()`
  - Modify `addTreeChildren()` (lines 466-511) to add checkboxes conditionally
  - Modify `buildMenuItems()` to show batch operations
  - Add batch handler functions: `batchCopyTo()`, `batchMoveTo()`, `batchDelete()`, `batchStage()`, `batchUnstage()`
- `app/apps/file_editor_cm6/static/js/explorer.css`:
  - Add `.fe-entry-checkbox` styles (around line 335)
  - Add `.fe-tree-select-mode` grid layout (around line 114)
- `app/apps/file_editor_cm6/explorer_helper.py`:
  - Add batch operation helpers (can reuse existing patterns)
- `app/apps/file_editor_cm6/git_helper.py`:
  - Add `stage_paths()` and `unstage_paths()` functions (similar to existing `stage_all`/`unstage_all`)
- `app/apps/file_editor_cm6/main.py`:
  - New endpoints after line 651

### 2.3 Add directory / Add file

**Behavior:**
- Available in each **directory** card menu (including project root).
- Clicking opens a modal to input a name.
- On confirmation, backend creates the entry relative to that directory.

**Current state:**
- No create directory/file functionality exists
- `explorer_helper.py` has `list_dir()` (lines 46-103) which validates paths are within project root
- Pattern for security: lines 55-59 check `str(base).startswith(str(root.resolve()))`

**Implementation plan:**
- Frontend in `explorer.js`:
  ```javascript
  async function addDirectory(entry) {
    const name = prompt('Directory name:');
    if (!name || !name.trim()) return;
    
    try {
      const resp = await fetch('/api/app/file_editor_cm6/explorer/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: currentProjectPath,
          parent_rel: entry.rel,
          name: name.trim()
        })
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Failed to create directory');
      
      toast(`Directory "${name}" created`);
      await refreshTree(treeElement);
      await refreshGitStatus(false);
    } catch (err) {
      toast(err.message || 'Failed to create directory');
    }
  }
  
  async function addFile(entry) {
    // Similar pattern, call /explorer/touch
  }
  ```
- Backend in `explorer_helper.py` (add after line 286):
  ```python
  def create_directory(parent_rel: str, name: str) -> dict:
      """Create a new directory within parent_rel."""
      root = get_project_root()
      parent = (root / parent_rel).resolve()
      
      if not str(parent).startswith(str(root.resolve())):
          raise ValueError("parent outside project root")
      if not parent.is_dir():
          raise ValueError("parent is not a directory")
      
      new_dir = parent / name
      if new_dir.exists():
          raise ValueError(f"'{name}' already exists")
      
      new_dir.mkdir(parents=False, exist_ok=False)
      rel_path = str(new_dir.relative_to(root))
      return {'rel': rel_path, 'name': name}
  
  def create_file(parent_rel: str, name: str) -> dict:
      """Create a new empty file within parent_rel."""
      root = get_project_root()
      parent = (root / parent_rel).resolve()
      
      if not str(parent).startswith(str(root.resolve())):
          raise ValueError("parent outside project root")
      if not parent.is_dir():
          raise ValueError("parent is not a directory")
      
      new_file = parent / name
      if new_file.exists():
          raise ValueError(f"'{name}' already exists")
      
      new_file.touch(exist_ok=False)
      rel_path = str(new_file.relative_to(root))
      return {'rel': rel_path, 'name': name}
  ```
- Backend in `main.py` (add after line 651):
  ```python
  @file_editor_cm6_bp.post('/explorer/mkdir')
  async def explorer_mkdir(data: dict = Body(...)):
      project = data.get('project')
      parent_rel = data.get('parent_rel', '.')
      name = data.get('name', '').strip()
      
      if not name:
          raise HTTPException(status_code=400, detail="Name required")
      if '/' in name or '\\' in name:
          raise HTTPException(status_code=400, detail="Invalid name")
      
      try:
          from .explorer_helper import create_directory
          result = create_directory(parent_rel, name)
          mark_git_cache_dirty(get_project_root())
          return {"ok": True, "data": result}
      except Exception as e:
          raise HTTPException(status_code=400, detail=str(e))
  
  @file_editor_cm6_bp.post('/explorer/touch')
  async def explorer_touch(data: dict = Body(...)):
      # Similar implementation
  ```

**Files to touch:**
- `app/apps/file_editor_cm6/static/js/explorer.js`:
  - Add `addDirectory()` and `addFile()` handler functions
- `app/apps/file_editor_cm6/explorer_helper.py`:
  - Add `create_directory()` and `create_file()` functions (after line 286)
- `app/apps/file_editor_cm6/main.py`:
  - Add `/explorer/mkdir` and `/explorer/touch` endpoints (after line 651)

### 2.4 Rename

**Behavior:**
- Single-item rename from card menu.
- Opens a name input modal (or prompt) showing the current name.
- Backend performs an `os.rename` within project root.

**Current state:**
- No rename functionality exists
- Security pattern from `explorer_helper.py` lines 269-285 shows `_normalize_rel_path()` function

**Implementation plan:**
- Frontend in `explorer.js`:
  ```javascript
  async function renameEntry(entry) {
    const currentName = entry.name;
    const newName = prompt('Rename to:', currentName);
    if (!newName || !newName.trim() || newName === currentName) return;
    
    try {
      const resp = await fetch('/api/app/file_editor_cm6/explorer/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: currentProjectPath,
          rel: entry.rel,
          new_name: newName.trim()
        })
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Failed to rename');
      
      toast(`Renamed to "${newName}"`);
      await refreshTree(treeElement);
      await refreshGitStatus(false);
    } catch (err) {
      toast(err.message || 'Failed to rename');
    }
  }
  ```
- Backend in `explorer_helper.py` (add after `create_file()`):
  ```python
  def rename_entry(rel: str, new_name: str) -> dict:
      """Rename a file or directory to new_name within same parent."""
      root = get_project_root()
      old_path = (root / rel).resolve()
      
      if not str(old_path).startswith(str(root.resolve())):
          raise ValueError("path outside project root")
      if not old_path.exists():
          raise ValueError("path does not exist")
      
      parent = old_path.parent
      new_path = parent / new_name
      
      if new_path.exists():
          raise ValueError(f"'{new_name}' already exists")
      
      old_path.rename(new_path)
      new_rel = str(new_path.relative_to(root))
      return {'old_rel': rel, 'new_rel': new_rel, 'new_name': new_name}
  ```
- Backend in `main.py` (add after `/explorer/touch`):
  ```python
  @file_editor_cm6_bp.post('/explorer/rename')
  async def explorer_rename(data: dict = Body(...)):
      rel = data.get('rel')
      new_name = data.get('new_name', '').strip()
      
      if not rel:
          raise HTTPException(status_code=400, detail="Path required")
      if not new_name:
          raise HTTPException(status_code=400, detail="New name required")
      if '/' in new_name or '\\' in new_name:
          raise HTTPException(status_code=400, detail="Invalid name")
      
      try:
          from .explorer_helper import rename_entry
          result = rename_entry(rel, new_name)
          mark_git_cache_dirty(get_project_root())
          return {"ok": True, "data": result}
      except Exception as e:
          raise HTTPException(status_code=400, detail=str(e))
  ```

**Files to touch:**
- `app/apps/file_editor_cm6/static/js/explorer.js`:
  - Add `renameEntry()` handler function
- `app/apps/file_editor_cm6/explorer_helper.py`:
  - Add `rename_entry()` function (after `create_file()`)
- `app/apps/file_editor_cm6/main.py`:
  - Add `/explorer/rename` endpoint (after `/explorer/touch`)

### 2.5 Copy / move (to/from) with shared file picker

**Behavior:**
- `Copy to`, `Copy from`, `Move to`, `Move from` use the **shared file picker** per `docs/core/shared_file_picker.md`.
- Each operation opens `window.teFilePicker` in the appropriate mode:
  - Destination/target selection uses `openDirectory` or `saveFile` depending on semantics.

**Current state:**
- `explorer.js` lines 288-323: `openProjectPrompt()` shows existing usage of `window.teFilePicker.openDirectory()`
- Picker returns `{ path, label }` on success, throws/rejects on cancel
- No copy/move functionality exists yet

**Implementation plan:**
- Frontend in `explorer.js`:
  ```javascript
  async function copyTo(entry) {
    if (!window.teFilePicker) {
      toast('File picker not available');
      return;
    }
    
    try {
      const dest = await window.teFilePicker.openDirectory({
        title: `Copy "${entry.name}" to…`,
        startPath: currentProjectPath
      });
      
      const resp = await fetch('/api/app/file_editor_cm6/explorer/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: currentProjectPath,
          rel: entry.rel,
          dest_path: dest.path
        })
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Copy failed');
      
      toast(`Copied to ${dest.path}`);
      await refreshTree(treeElement);
      await refreshGitStatus(false);
    } catch (err) {
      if (err.message !== 'cancelled') {
        toast(err.message || 'Copy failed');
      }
    }
  }
  
  async function moveTo(entry) {
    // Similar - call /explorer/move instead
  }
  
  async function copyFrom(entry) {
    // For directories: copy a file/dir INTO this directory
    const source = await window.teFilePicker.openFile({
      title: 'Copy from…',
      startPath: currentProjectPath
    });
    // POST to /explorer/copy_into with { dest_dir_rel: entry.rel, source_path }
  }
  
  async function batchCopyTo() {
    // Use selectedEntries set, call /explorer/batch_copy
  }
  
  async function batchMoveTo() {
    // Similar, call /explorer/batch_move
  }
  ```
- Backend in `explorer_helper.py` (add after `rename_entry()`):
  ```python
  import shutil
  
  def copy_entry(rel: str, dest_dir_path: str) -> dict:
      """Copy file/dir from rel to dest_dir_path."""
      root = get_project_root()
      source = (root / rel).resolve()
      dest_dir = Path(dest_dir_path).resolve()
      
      if not str(source).startswith(str(root.resolve())):
          raise ValueError("source outside project root")
      if not source.exists():
          raise ValueError("source does not exist")
      
      dest = dest_dir / source.name
      if dest.exists():
          raise ValueError(f"'{source.name}' already exists in destination")
      
      if source.is_dir():
          shutil.copytree(source, dest)
      else:
          shutil.copy2(source, dest)
      
      return {'source_rel': rel, 'dest_path': str(dest)}
  
  def move_entry(rel: str, dest_dir_path: str) -> dict:
      """Move file/dir from rel to dest_dir_path."""
      root = get_project_root()
      source = (root / rel).resolve()
      dest_dir = Path(dest_dir_path).resolve()
      
      if not str(source).startswith(str(root.resolve())):
          raise ValueError("source outside project root")
      if not source.exists():
          raise ValueError("source does not exist")
      
      dest = dest_dir / source.name
      if dest.exists():
          raise ValueError(f"'{source.name}' already exists in destination")
      
      shutil.move(str(source), str(dest))
      
      new_rel = str(dest.relative_to(root)) if str(dest).startswith(str(root)) else None
      return {'old_rel': rel, 'new_path': str(dest), 'new_rel': new_rel}
  
  def batch_copy(rels: list[str], dest_dir_path: str) -> dict:
      """Copy multiple entries to dest_dir_path."""
      results = []
      for rel in rels:
          try:
              result = copy_entry(rel, dest_dir_path)
              results.append({'rel': rel, 'ok': True, 'result': result})
          except Exception as e:
              results.append({'rel': rel, 'ok': False, 'error': str(e)})
      return {'results': results}
  
  def batch_move(rels: list[str], dest_dir_path: str) -> dict:
      """Move multiple entries to dest_dir_path."""
      results = []
      for rel in rels:
          try:
              result = move_entry(rel, dest_dir_path)
              results.append({'rel': rel, 'ok': True, 'result': result})
          except Exception as e:
              results.append({'rel': rel, 'ok': False, 'error': str(e)})
      return {'results': results}
  ```
- Backend in `main.py` (add after `/explorer/rename`):
  ```python
  @file_editor_cm6_bp.post('/explorer/copy')
  async def explorer_copy(data: dict = Body(...)):
      rel = data.get('rel')
      dest_path = data.get('dest_path')
      if not rel or not dest_path:
          raise HTTPException(status_code=400, detail="Path required")
      try:
          from .explorer_helper import copy_entry
          result = copy_entry(rel, dest_path)
          mark_git_cache_dirty(get_project_root())
          return {"ok": True, "data": result}
      except Exception as e:
          raise HTTPException(status_code=400, detail=str(e))
  
  @file_editor_cm6_bp.post('/explorer/move')
  async def explorer_move(data: dict = Body(...)):
      # Similar
  
  @file_editor_cm6_bp.post('/explorer/batch_copy')
  async def explorer_batch_copy(data: dict = Body(...)):
      # Similar, calls batch_copy()
  
  @file_editor_cm6_bp.post('/explorer/batch_move')
  async def explorer_batch_move(data: dict = Body(...)):
      # Similar, calls batch_move()
  ```

**Files to touch:**
- `app/apps/file_editor_cm6/static/js/explorer.js`:
  - Add handler functions: `copyTo()`, `moveTo()`, `copyFrom()`, `moveFrom()`, `batchCopyTo()`, `batchMoveTo()`
- `app/apps/file_editor_cm6/explorer_helper.py`:
  - Add: `copy_entry()`, `move_entry()`, `batch_copy()`, `batch_move()` (after `rename_entry()`)
  - Import `shutil` at top
- `app/apps/file_editor_cm6/main.py`:
  - Add endpoints: `/explorer/copy`, `/explorer/move`, `/explorer/batch_copy`, `/explorer/batch_move`

### 2.6 Git staging operations (per card and batch)

**Behavior:**
- **Stage** available when:
  - `gitStatus` is `modified`, `added`, `untracked`, etc.
- **Unstage** available when:
  - Entry is staged (`staged`, `staged_modified`).

**Current state:**
- `git_helper.py` lines 172-190: `stage_all()` and `unstage_all()` exist
- `git_helper.py` uses `_run_git()` helper (lines 37-50) to execute git commands
- `main.py` lines 488-505: `/git/stage_all` and `/git/unstage_all` endpoints exist
- Git status is tracked per-file in `gitStatus` field from `list_dir()` (explorer_helper.py lines 79, 89)

**Implementation plan:**
- Backend in `git_helper.py` (add after `pull_changes()` around line 235):
  ```python
  def stage_paths(project_root: Path, paths: List[str]) -> GitStatus:
      """Stage specific files or directories."""
      _ensure_repo(project_root)
      if not paths:
          return get_status(project_root)
      
      # Stage each path
      for path in paths:
          _run_git(project_root, "add", "--", path)
      
      return get_status(project_root)
  
  def unstage_paths(project_root: Path, paths: List[str]) -> GitStatus:
      """Unstage specific files or directories."""
      _ensure_repo(project_root)
      if not paths:
          return get_status(project_root)
      
      has_commits = _has_commits(project_root)
      
      for path in paths:
          if has_commits:
              _run_git(project_root, "reset", "HEAD", "--", path)
          else:
              # No commits yet: remove from index
              _run_git(project_root, "rm", "--cached", "--", path)
      
      return get_status(project_root)
  ```
- Backend in `main.py` (add after `/git/pull` around line 546):
  ```python
  @file_editor_cm6_bp.post('/git/stage')
  async def git_stage_route(data: dict = Body(...)):
      paths = data.get('paths', [])
      if not paths:
          raise HTTPException(status_code=400, detail="Paths required")
      try:
          project_root = _get_active_project_root()
          from .git_helper import stage_paths
          status = stage_paths(project_root, paths)
          mark_git_cache_dirty(project_root)
          return {"ok": True, "data": _status_to_payload(status)}
      except GitError as exc:
          raise HTTPException(status_code=400, detail=str(exc))
  
  @file_editor_cm6_bp.post('/git/unstage')
  async def git_unstage_route(data: dict = Body(...)):
      paths = data.get('paths', [])
      if not paths:
          raise HTTPException(status_code=400, detail="Paths required")
      try:
          project_root = _get_active_project_root()
          from .git_helper import unstage_paths
          status = unstage_paths(project_root, paths)
          mark_git_cache_dirty(project_root)
          return {"ok": True, "data": _status_to_payload(status)}
      except GitError as exc:
          raise HTTPException(status_code=400, detail=str(exc))
  ```
- Frontend in `explorer.js`:
  ```javascript
  async function stageEntry(entry) {
    try {
      const resp = await fetch('/api/app/file_editor_cm6/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [entry.rel] })
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Stage failed');
      
      gitStatusCache = json.data;
      renderGitSummary(json.data);
      await refreshTree(treeElement);
      toast(`Staged ${entry.name}`);
    } catch (err) {
      toast(err.message || 'Stage failed');
    }
  }
  
  async function unstageEntry(entry) {
    // Similar, call /git/unstage
  }
  
  async function batchStage() {
    const paths = Array.from(selectedEntries);
    // Call /git/stage with paths array
  }
  
  async function batchUnstage() {
    // Similar
  }
  ```

**Files to touch:**
- `app/apps/file_editor_cm6/static/js/explorer.js`:
  - Add: `stageEntry()`, `unstageEntry()`, `batchStage()`, `batchUnstage()` handlers
- `app/apps/file_editor_cm6/git_helper.py`:
  - Add: `stage_paths()` and `unstage_paths()` functions (after line 235)
  - Import `List` from typing at top (line 8)
- `app/apps/file_editor_cm6/main.py`:
  - Add: `/git/stage` and `/git/unstage` endpoints (after line 545)
  - Import `stage_paths` and `unstage_paths` from git_helper (line 22-32 area)

### 2.7 Git restore (per card)

**Behavior:**
- RESTORE is only available for entries with relevant git status (e.g., modified/unstaged, not staged-only).
- Opens a warning modal listing commits that touched the path.
- Default selection is `HEAD`.
- On confirm, backend resets the file to the selected commit.

**Current state:**
- No restore functionality exists
- `git_helper.py` lines 37-50: `_run_git()` can execute any git command
- Existing git operations return `GitStatus` objects (line 27-35)

**Implementation plan:**
- Backend in `git_helper.py` (add after `unstage_paths()`):
  ```python
  @dataclass
  class GitCommit:
      hash: str
      short_hash: str
      summary: str
      author: str
      date: str
  
  def get_commits_for_path(project_root: Path, path: str, limit: int = 20) -> List[GitCommit]:
      """Get commit history for a specific path."""
      _ensure_repo(project_root)
      
      output = _run_git(
          project_root,
          "log",
          f"--max-count={limit}",
          "--format=%H|%h|%s|%an|%ai",
          "--",
          path
      )
      
      commits = []
      for line in output.splitlines():
          if not line:
              continue
          parts = line.split('|', 4)
          if len(parts) == 5:
              commits.append(GitCommit(
                  hash=parts[0],
                  short_hash=parts[1],
                  summary=parts[2],
                  author=parts[3],
                  date=parts[4]
              ))
      return commits
  
  def restore_path(project_root: Path, path: str, commit: str = "HEAD") -> None:
      """Restore a path to a specific commit."""
      _ensure_repo(project_root)
      _run_git(project_root, "restore", f"--source={commit}", "--", path)
  ```
- Backend in `main.py` (add after `/git/unstage`):
  ```python
  @file_editor_cm6_bp.get('/git/commits_for_path')
  async def git_commits_for_path(path: str = Query(...), limit: int = Query(20)):
      try:
          project_root = _get_active_project_root()
          from .git_helper import get_commits_for_path
          commits = get_commits_for_path(project_root, path, limit)
          return {"ok": True, "data": [
              {
                  "hash": c.hash,
                  "short_hash": c.short_hash,
                  "summary": c.summary,
                  "author": c.author,
                  "date": c.date
              }
              for c in commits
          ]}
      except GitError as exc:
          raise HTTPException(status_code=400, detail=str(exc))
  
  @file_editor_cm6_bp.post('/git/restore')
  async def git_restore_route(data: dict = Body(...)):
      path = data.get('path')
      commit = data.get('commit', 'HEAD')
      if not path:
          raise HTTPException(status_code=400, detail="Path required")
      try:
          project_root = _get_active_project_root()
          from .git_helper import restore_path
          restore_path(project_root, path, commit)
          mark_git_cache_dirty(project_root)
          invalidate_diff_cache(project_root, path)
          return {"ok": True, "data": {"path": path, "commit": commit}}
      except GitError as exc:
          raise HTTPException(status_code=400, detail=str(exc))
  ```
- Frontend in `explorer.js`:
  ```javascript
  async function restoreEntry(entry) {
    try {
      // Fetch commits for this path
      const resp = await fetch(`/api/app/file_editor_cm6/git/commits_for_path?path=${encodeURIComponent(entry.rel)}`);
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Failed to fetch commits');
      
      const commits = json.data;
      if (!commits.length) {
        toast('No commits found for this file');
        return;
      }
      
      // Show simple modal (for now use confirm, later build proper modal)
      const commitList = commits.slice(0, 5).map(c => `${c.short_hash}: ${c.summary}`).join('\\n');
      const confirmed = confirm(
        `⚠️ WARNING: This will discard changes to ${entry.name}\\n\\n` +
        `Recent commits:\\n${commitList}\\n\\n` +
        `Restore from HEAD?`
      );
      if (!confirmed) return;
      
      // Restore from HEAD
      const restoreResp = await fetch('/api/app/file_editor_cm6/git/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: entry.rel, commit: 'HEAD' })
      });
      const restoreJson = await restoreResp.json();
      if (!restoreJson.ok) throw new Error(restoreJson.error || 'Restore failed');
      
      toast(`Restored ${entry.name} from HEAD`);
      await refreshTree(treeElement);
      await refreshGitStatus(false);
      
      // Reload current file if it was restored
      if (typeof window.__cm6ReloadCurrentFile === 'function') {
        await window.__cm6ReloadCurrentFile();
      }
    } catch (err) {
      toast(err.message || 'Restore failed');
    }
  }
  ```

**Files to touch:**
- `app/apps/file_editor_cm6/static/js/explorer.js`: Add `restoreEntry()` handler
- `app/apps/file_editor_cm6/git_helper.py`: Add `GitCommit` dataclass, `get_commits_for_path()`, `restore_path()` (after `unstage_paths()`)
- `app/apps/file_editor_cm6/main.py`: Add `/git/commits_for_path` GET and `/git/restore` POST endpoints

### 2.8 Delete (per card / batch)

**Behavior:**
- Always considered destructive.
- Requires a clear warning modal before performing.
- Deletes file or directory tree.

**Current state:**
- No delete functionality exists
- `explorer_helper.py` has security pattern for path validation

**Implementation plan:**
- Backend in `explorer_helper.py` (add after `batch_move()`):
  ```python
  import shutil  # Already imported for copy/move
  
  def delete_entry(rel: str) -> dict:
      """Delete a file or directory."""
      root = get_project_root()
      target = (root / rel).resolve()
      
      if not str(target).startswith(str(root.resolve())):
          raise ValueError("path outside project root")
      if not target.exists():
          raise ValueError("path does not exist")
      
      if target.is_dir():
          shutil.rmtree(target)
      else:
          target.unlink()
      
      return {'rel': rel, 'deleted': True}
  
  def batch_delete(rels: list[str]) -> dict:
      """Delete multiple entries."""
      results = []
      for rel in rels:
          try:
              result = delete_entry(rel)
              results.append({'rel': rel, 'ok': True, 'result': result})
          except Exception as e:
              results.append({'rel': rel, 'ok': False, 'error': str(e)})
      return {'results': results}
  ```
- Backend in `main.py` (add after `/explorer/batch_move`):
  ```python
  @file_editor_cm6_bp.post('/explorer/delete')
  async def explorer_delete(data: dict = Body(...)):
      rel = data.get('rel')
      if not rel:
          raise HTTPException(status_code=400, detail="Path required")
      try:
          from .explorer_helper import delete_entry
          result = delete_entry(rel)
          mark_git_cache_dirty(get_project_root())
          return {"ok": True, "data": result}
      except Exception as e:
          raise HTTPException(status_code=400, detail=str(e))
  
  @file_editor_cm6_bp.post('/explorer/batch_delete')
  async def explorer_batch_delete(data: dict = Body(...)):
      rels = data.get('rels', [])
      if not rels:
          raise HTTPException(status_code=400, detail="Paths required")
      try:
          from .explorer_helper import batch_delete
          result = batch_delete(rels)
          mark_git_cache_dirty(get_project_root())
          return {"ok": True, "data": result}
      except Exception as e:
          raise HTTPException(status_code=400, detail=str(e))
  ```
- Frontend in `explorer.js`:
  ```javascript
  async function deleteEntry(entry) {
    const confirmed = confirm(
      `⚠️ WARNING: Delete "${entry.name}"?\\n\\n` +
      `This action cannot be undone.`
    );
    if (!confirmed) return;
    
    try {
      const resp = await fetch('/api/app/file_editor_cm6/explorer/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rel: entry.rel })
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Delete failed');
      
      toast(`Deleted ${entry.name}`);
      await refreshTree(treeElement);
      await refreshGitStatus(false);
    } catch (err) {
      toast(err.message || 'Delete failed');
    }
  }
  
  async function batchDelete() {
    const paths = Array.from(selectedEntries);
    if (!paths.length) return;
    
    const confirmed = confirm(
      `⚠️ WARNING: Delete ${paths.length} items?\\n\\n` +
      `This action cannot be undone.`
    );
    if (!confirmed) return;
    
    try {
      const resp = await fetch('/api/app/file_editor_cm6/explorer/batch_delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rels: paths })
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Batch delete failed');
      
      toast(`Deleted ${paths.length} items`);
      disableSelectMode();
      await refreshTree(treeElement);
      await refreshGitStatus(false);
    } catch (err) {
      toast(err.message || 'Batch delete failed');
    }
  }
  ```

**Files to touch:**
- `app/apps/file_editor_cm6/static/js/explorer.js`: Add `deleteEntry()` and `batchDelete()` handlers
- `app/apps/file_editor_cm6/explorer_helper.py`: Add `delete_entry()` and `batch_delete()` functions
- `app/apps/file_editor_cm6/main.py`: Add `/explorer/delete` and `/explorer/batch_delete` endpoints

---

## 3. Global Git Operations

These operations affect the entire repository and will be added to the existing git controls area.

### 3.1 Hard reset (global)

**Current state:**
- `git_helper.py` has basic git operations but no reset functionality
- `template.html` lines 1276-1285: Git footer with existing buttons (stage, unstage, commit, push, pull)
- `explorer.js` lines 109-128: Event handlers for existing git buttons

**Behavior:**
- Appears in a global Git menu (add new button to `.fe-git-actions` div in template.html)
- Opens a warning modal containing a commit list (similar to per-file restore).
- Default commit selection is `HEAD`.
- Action button is styled in red.

**Implementation plan:**
- Backend in `git_helper.py` (add after `restore_path()`):
  ```python
  def get_commits(project_root: Path, limit: int = 50) -> List[GitCommit]:
      """Get recent commits for the repository."""
      _ensure_repo(project_root)
      
      output = _run_git(
          project_root,
          "log",
          f"--max-count={limit}",
          "--format=%H|%h|%s|%an|%ai"
      )
      
      commits = []
      for line in output.splitlines():
          if not line:
              continue
          parts = line.split('|', 4)
          if len(parts) == 5:
              commits.append(GitCommit(
                  hash=parts[0],
                  short_hash=parts[1],
                  summary=parts[2],
                  author=parts[3],
                  date=parts[4]
              ))
      return commits
  
  def reset_hard(project_root: Path, commit: str = "HEAD") -> GitStatus:
      """Perform a hard reset to the specified commit."""
      _ensure_repo(project_root)
      _run_git(project_root, "reset", "--hard", commit)
      return get_status(project_root)
  ```
- Backend in `main.py` (add after `/git/restore`):
  ```python
  @file_editor_cm6_bp.get('/git/commits')
  async def git_commits():
      try:
          project_root = _get_active_project_root()
          from .git_helper import get_commits
          commits = get_commits(project_root, limit=50)
          return {"ok": True, "data": [
              {
                  "hash": c.hash,
                  "short_hash": c.short_hash,
                  "summary": c.summary,
                  "author": c.author,
                  "date": c.date
              }
              for c in commits
          ]}
      except GitError as exc:
          raise HTTPException(status_code=400, detail=str(exc))
  
  @file_editor_cm6_bp.post('/git/reset_hard')
  async def git_reset_hard_route(data: dict = Body(...)):
      commit = data.get('commit', 'HEAD')
      try:
          project_root = _get_active_project_root()
          from .git_helper import reset_hard
          status = reset_hard(project_root, commit)
          mark_git_cache_dirty(project_root)
          invalidate_diff_cache(project_root)
          return {"ok": True, "data": _status_to_payload(status)}
      except GitError as exc:
          raise HTTPException(status_code=400, detail=str(exc))
  ```
- Frontend in `explorer.js` (add to `initExplorerUI()` around line 128):
  ```javascript
  // In initExplorerUI(), add new button to gitButtons
  gitButtons.reset = document.getElementById('fe-git-reset');
  
  gitButtons.reset?.addEventListener('click', async () => {
    try {
      const resp = await fetch('/api/app/file_editor_cm6/git/commits');
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Failed to fetch commits');
      
      const commits = json.data;
      if (!commits.length) {
        toast('No commits found');
        return;
      }
      
      const commitList = commits.slice(0, 5).map(c => `${c.short_hash}: ${c.summary}`).join('\\n');
      const confirmed = confirm(
        `⚠️ DANGER: Hard reset will discard ALL uncommitted changes!\\n\\n` +
        `Recent commits:\\n${commitList}\\n\\n` +
        `Reset to HEAD?`
      );
      if (!confirmed) return;
      
      const resetResp = await fetch('/api/app/file_editor_cm6/git/reset_hard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commit: 'HEAD' })
      });
      const resetJson = await resetResp.json();
      if (!resetJson.ok) throw new Error(resetJson.error || 'Reset failed');
      
      gitStatusCache = resetJson.data;
      renderGitSummary(resetJson.data);
      toast('Repository reset to HEAD');
      await refreshTree(treeElement);
      
      if (typeof window.__cm6ReloadCurrentFile === 'function') {
        await window.__cm6ReloadCurrentFile();
      }
    } catch (err) {
      toast(err.message || 'Reset failed');
    }
  });
  ```
- Template in `template.html` (add button to git footer around line 1284):
  ```html
  <button id="fe-git-reset" class="fe-btn" type="button" style="color: #ef4444;">Reset (hard)…</button>
  ```

### 3.2 Git init (global)

**Current state:**
- No git init functionality exists
- `explorer.js` lines 170-174, 203-232: Handles case when git is not available

**Behavior:**
- Appears when current project is **not** yet a git repo.
- Button: "Initialize Git".
- On success, git summary and badges become active.

**Implementation plan:**
- Backend in `git_helper.py` (add after `reset_hard()`):
  ```python
  def init_repository(project_root: Path) -> GitStatus:
      """Initialize a new git repository."""
      try:
          _run_git(project_root, "init")
          # Set initial config
          _run_git(project_root, "config", "user.name", "User")
          _run_git(project_root, "config", "user.email", "user@example.com")
          return get_status(project_root)
      except Exception as exc:
          raise GitError(f"Failed to initialize repository: {str(exc)}")
  
  def is_git_repository(project_root: Path) -> bool:
      """Check if directory is a git repository."""
      out = _run_git_optional(project_root, "rev-parse", "--is-inside-work-tree")
      return out is not None and out.strip() == "true"
  ```
- Backend in `main.py` (add after `/git/reset_hard`):
  ```python
  @file_editor_cm6_bp.get('/git/is_repo')
  async def git_is_repo():
      try:
          project_root = _get_active_project_root()
          from .git_helper import is_git_repository
          is_repo = is_git_repository(project_root)
          return {"ok": True, "data": {"is_repo": is_repo}}
      except Exception as exc:
          return {"ok": True, "data": {"is_repo": False}}
  
  @file_editor_cm6_bp.post('/git/init')
  async def git_init_route():
      try:
          project_root = _get_active_project_root()
          from .git_helper import init_repository
          status = init_repository(project_root)
          mark_git_cache_dirty(project_root)
          return {"ok": True, "data": _status_to_payload(status)}
      except GitError as exc:
          raise HTTPException(status_code=400, detail=str(exc))
  ```
- Frontend in `explorer.js` (modify `refreshGitStatus()` around line 220):
  ```javascript
  async function refreshGitStatus(showToast = true) {
    if (!currentProjectPath) return;
    
    try {
      const data = await gitRequest('/git/status');
      gitStatusCache = data;
      renderGitSummary(data);
      setGitControlsEnabled(true);
      hideGitInit();
    } catch (err) {
      gitStatusCache = null;
      renderGitSummary(null, err.message);
      setGitControlsEnabled(false);
      
      // Check if it's a "not a git repo" error - show init button
      if (err.message && err.message.includes('Not a git repository')) {
        showGitInit();
      }
      
      if (showToast) toast(err.message || 'Git status unavailable');
    }
  }
  
  function showGitInit() {
    const initBtn = document.getElementById('fe-git-init');
    if (initBtn) initBtn.style.display = 'inline-block';
    
    // Hide other git buttons
    setGitControlsEnabled(false);
  }
  
  function hideGitInit() {
    const initBtn = document.getElementById('fe-git-init');
    if (initBtn) initBtn.style.display = 'none';
  }
  
  // In initExplorerUI(), add init button handler:
  const gitInitBtn = document.getElementById('fe-git-init');
  gitInitBtn?.addEventListener('click', async () => {
    const confirmed = confirm('Initialize Git repository in this project?');
    if (!confirmed) return;
    
    try {
      const resp = await fetch('/api/app/file_editor_cm6/git/init', { method: 'POST' });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Init failed');
      
      toast('Git repository initialized');
      await refreshGitStatus(false);
      await refreshTree(treeElement);
    } catch (err) {
      toast(err.message || 'Git init failed');
    }
  });
  ```
- Template in `template.html` (add button to git footer, line 1279):
  ```html
  <button id="fe-git-init" class="fe-btn" type="button" style="display: none;">Initialize Git</button>
  ```

**Files to touch:**
- `app/apps/file_editor_cm6/static/js/explorer.js`: Add reset and init handlers, modify `refreshGitStatus()`
- `app/apps/file_editor_cm6/git_helper.py`: Add `get_commits()`, `reset_hard()`, `init_repository()`, `is_git_repository()`
- `app/apps/file_editor_cm6/main.py`: Add `/git/commits`, `/git/reset_hard`, `/git/is_repo`, `/git/init` endpoints
- `app/apps/file_editor_cm6/template.html`: Add reset and init buttons to git footer (lines 1279, 1284)

---

## 4. Backend / Frontend Contract & Safety

### 4.1 Explicit context parameters

Following `nicegui_iframe_feature_adding_guideline.md`, all endpoints will:
- Take explicit `project` and `rel` / `rel[]` / `abs_path` parameters.
- Avoid relying solely on global state, to prevent desync between explorer and editor.

### 4.2 Error handling and UX

- All endpoints return `{ ok: boolean, error?: string, data?: any }`.
- `explorer.js` wraps calls in `gitRequest`-like helpers to:
  - Throw on `ok === false`.
  - Surface errors via `toast()`.
- On successful operations, explorer and git summary are refreshed; `__cm6ReloadCurrentFile` is used when HEAD changes.

### 4.3 No direct editor iframe mutation

- The explorer will continue to interact with the editor only via host callbacks:
  - `window.appOpenFile(absPath)` / `window.appOpenFileRel(rel, projectRoot)` already used.
  - No attempt to reach into the NiceGUI iframe.

---

## 5. Background Color & Final Polish

- Set explorer drawer background to a **solid dark grayish blue** while preserving the current palette:
  - Prefer reusing `var(--bg)` / `var(--card)` and adjusting them if necessary rather than introducing new arbitrary colors.
- Remove accidental transparency (e.g., `rgba(…, 0.2+)`) from explorer-specific panels and cards.
- Ensure layouts work in both:
  - `.layout-desktop` (drawer as fixed left column; see `template.html` grid layout).
  - `.layout-mobile` (drawer as slide-over with backdrop).
- Maintain touch-friendly targets on mobile (sufficient padding for icons, checkboxes, and `...` buttons).

---

## 6. Implementation Order (High-Level)

1. **Styling foundation**
   - Solid background, hover adjustments, root card layout.
2. **Card menu plumbing**
   - Add `...` per entry + floating menu component; no-op items at first.
3. **Backend endpoints for basic operations**
   - mkdir, touch, rename, delete, simple copy/move.
4. **Select mode & batch operations**
   - Checkboxes, select state, batch endpoints.
5. **Git per-entry operations**
   - Stage / unstage / restore with commit list.
6. **Global Git actions**
   - Init and reset hard.
7. **Polish & error handling**
   - Consistent toasts, edge cases (missing paths, permission issues), and UX tweaks.

This plan is intentionally backend-first and matches the existing architecture of `file_editor_cm6`, keeping explorer JS thin and display-oriented while relying on Python helpers for all filesystem and git operations.

---

## 7. Implementation Instructions for the LLM (Gemini 2.5 Pro)

This section is **instructions for the model** that will implement this plan.
Follow these rules exactly unless the user explicitly overrides them.

### 7.1 Scope & Non‑Negotiable Constraints

This section is **instructions for the model** that will implement this plan.
Follow these rules exactly unless the user explicitly overrides them.

### 7.1 Scope & Non‑Negotiable Constraints

- **Do not touch**:
  - NiceGUI iframe editor internals beyond the vendored CodeMirror modules:
    - `app/static/vendor/nicegui/elements/codemirror/codemirror.py`
    - `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
  - Session cache logic or endpoints:
    - `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
    - `app/apps/file_editor_cm6/history_store.py`
  - WebSocket plumbing already in place for:
    - File watching and save acknowledgements.
    - Cache state bridge / postMessage integration.
- **Explorer drawer only**:
  - You may modify these files (and only these, unless this plan explicitly says otherwise):
    - `app/apps/file_editor_cm6/static/js/explorer.js`
    - `app/apps/file_editor_cm6/template.html`
    - `app/apps/file_editor_cm6/explorer_helper.py`
    - `app/apps/file_editor_cm6/git_helper.py`
    - `app/apps/file_editor_cm6/main.py` (for new HTTP endpoints and routing only)
    - `app/apps/file_editor_cm6/static/js/explorer.css` (if present / used)
- **Backend‑only for mutations**:
  - All filesystem and Git mutations must be implemented in Python.
  - The frontend must only:
    - Call HTTP endpoints (fetch/POST/DELETE).
    - Update its DOM based on responses.
  - Do **not** implement file or git operations purely in JavaScript.

### 7.2 Communication & Architecture Rules

- **No new WebSockets for the drawer**:
  - Do **not** introduce a new WebSocket channel or “drawer controller”.
  - All explorer actions should use explicit HTTP endpoints (`GET`/`POST`/`DELETE`).
  - Real‑time-ish updates (e.g., after git actions) are handled by:
    - Calling `refreshTree(treeElement)` and `refreshGitStatus(false)`.
    - Using existing `window.__cm6ReloadCurrentFile()` when HEAD changes.
- **No direct iframe access**:
  - Explorer JavaScript must not try to reach inside the NiceGUI iframe (no `contentWindow` hacks or DOM queries into the iframe).
  - To open a file in the editor, always use existing host callbacks:
    - `window.appOpenFile(absPath)`
    - `window.appOpenFileRel(rel, projectRoot)`
- **Explicit context parameters**:
  - Every new backend endpoint must accept explicit parameters, such as:
    - `project` (absolute project root path) and
    - `rel` / `rels` (paths relative to that project),
    - or `abs_path` when a fully qualified path is required.
  - Do not rely solely on backend global state like “current project” or “current file”; always trust the parameters sent from the frontend.

### 7.3 Behavioral Invariants to Preserve

- The explorer must remain **in sync** with:
  - The active project state (`/state` endpoint and `getEditorState()`).
  - Git status (via `git_helper.py` and `refreshGitStatus()`).
- Opening a file from the drawer must still:
  - Call `openFileRel(rel, currentProjectPath)` or `openFile(absPath)`.
  - Close the drawer on mobile after a file is opened (existing behavior).
- Git summary at the top of the drawer must continue to:
  - Use existing endpoints for status.
  - Display branch, ahead/behind, and counts.

### 7.4 Implementation Strategy & Checkpoints

Implement this plan **in stages** with explicit pause points so the user can test between phases.

#### Checkpoint A – After Sections 1.x and 2.3

**Scope for this phase:**
- Section **1.1**: solid backgrounds, hover tweaks (desktop‑only hover).
- Section **1.2**: icons + per‑entry `...` button (card menu skeleton).
- Section **1.3**: project root card always expanded and filling vertical height.
- Section **2.1–2.3**:
  - Card menu plumbing.
  - Basic operations:
    - **Add directory**, **Add file**, **Rename**, **Delete** (single item).

**Rules for Checkpoint A:**
- Implement only the endpoints necessary for:
  - mkdir / touch,
  - rename,
  - single‑item delete.
- Keep **select mode**, copy/move, and git‑related menu items as **stubs or hidden**.
- After finishing this phase:
  - Stop.
  - The user (and another model) will manually test:
    - Drawer layout and visuals (desktop + mobile).
    - Icons and `...` buttons.
    - New file/dir, rename, delete from card menu.

#### Checkpoint B – After Sections 2.4–2.6

**Scope for this phase:**
- Section **2.4**: **Select mode** & batch operations:
  - Checkboxes for children of a directory.
  - Batch delete / copy / move (using shared file picker).
  - Hiding per‑item `...` while select mode is active.
- Section **2.5**: **Copy/Move (to/from)** wired to shared file picker:
  - Endpoints for copy/move that operate on:
    - Single item, and
    - Batch of items.
- Section **2.6**: **Git stage/unstage** per card and batch:
  - Endpoints to stage/unstage single or multiple paths.

**Rules for Checkpoint B:**
- Reuse the existing `window.teFilePicker` API as described in `docs/core/shared_file_picker.md`.
- When an operation succeeds:
  - Refresh the tree and git summary.
  - Do **not** add new WebSockets; use existing helpers.
- After finishing this phase:
  - Stop.
  - The user will test:
    - Select mode enable/disable behavior.
    - Batch selection & batch operations.
    - Single + batch stage/unstage and visual git badges.

#### Checkpoint C – After Sections 2.7–3.2

**Scope for this phase:**
- Section **2.7**: **Git restore** per file:
  - Commit list modal (from `git log`).
  - Restore specific file to selected commit.
- Section **2.8**: Confirm‑modal **Delete** (single and batch) with clear warnings.
- Section **3.1**: **Global reset hard**:
  - Commit list.
  - Reset to selected commit.
- Section **3.2**: **Git init**:
  - Initialize repo for current project.

**Rules for Checkpoint C:**
- Commit lists:
  - Build using `git_helper.py` helpers that shell out to `git log`.
  - Responses should include commit hash, short summary, author, date.
- Restores and resets:
  - Use explicit endpoints and clearly mark destructive actions (red button styling in the UI).
- After finishing this phase:
  - Stop.
  - The user will test:
    - Per‑file restore.
    - Global reset behavior.
    - Init on non‑git projects.

### 7.5 Endpoint & Response Patterns

When adding new backend routes:

- Use the existing JSON envelope:
  - Success: `{ "ok": true, "data": { ... } }`
  - Failure: `{ "ok": false, "error": "human readable message" }`
- JavaScript should:
  - `await` the response.
  - Throw or show a toast on `ok === false`.
- On success:
  - Refresh the explorer tree and git summary as appropriate.
  - Call `window.__cm6ReloadCurrentFile()` only when HEAD has changed (e.g., after commit, reset, restore).

### 7.6 Styling Guidelines

- Do **not** change the global color palette.
- Replace transparency with solid colors by:
  - Using `var(--bg)`, `var(--card)`, `var(--border)`, `var(--muted-foreground)` in explorer‑specific areas.
- Maintain mobile responsiveness:
  - Respect `.layout-desktop` and `.layout-mobile` grid systems in `template.html`.
  - Preserve the drawer’s slide‑over behavior and backdrop in mobile layouts.
- Use text or simple CSS‑based icons:
  - No external image assets or icon fonts.

### 7.7 Git & Filesystem Safety

- All filesystem operations must stay inside the project root as defined by `explorer_helper.set_project_root()` / `get_project_root()`.
- For each path:
  - Resolve it and ensure it still lives under the project root.
  - If it does not, return `ok: false` with a clear error.
- For Git:
  - Execute commands with `git -C <project_root> ...`.
  - Mark git cache dirty via `mark_git_cache_dirty(project_root)` after any mutation.

### 7.8 Manual Testing Checklist (Per Checkpoint)

For **Checkpoint A**:
- Drawer opens/closes in desktop and mobile layouts.
- Background is solid dark grayish blue; no unwanted transparency.
- Icons and `...` buttons appear on each card.
- New file/dir, rename, delete work and refresh the tree.

For **Checkpoint B**:
- Select mode can be enabled on directories with >1 item and on the project root.
- Child cards in select mode show checkboxes and hide individual `...` menus.
- Batch delete/copy/move operate on selected items only.
- Stage/unstage (single and batch) update git summary and per‑entry badges.

For **Checkpoint C**:
- Git restore shows commit list per path and correctly restores to the chosen commit.
- Global reset hard:
  - Shows commit list.
  - After reset, tree and git summary reflect the new HEAD.
- Git init:
  - Only appears when repo is absent.
  - After init, git summary and per‑entry git decorations become active.

Record any deviations or edge cases in a new, dated section in `notes/2025-11-14_Session_Cache_Implementation_Plan.md` or a new note file so that follow‑up debugging has clear context.

---

## 8. Code Reference Summary

This section provides quick reference to actual code structure for implementation.

### 8.1 Key File Locations & Current State

**Frontend (JavaScript/CSS):**
- `app/apps/file_editor_cm6/static/js/explorer.js` (687 lines)
  - Lines 4-10: Module state variables (`currentProjectPath`, `cachedState`, `expandedDirs`, etc.)
  - Lines 69-156: `initExplorerUI()` - main initialization
  - Lines 466-511: `addTreeChildren()` - renders tree entries
  - Lines 590-638: `onTreeClick()` - handles tree interactions
  - Lines 640-669: `applyEntryStyling()` - applies CSS classes to entries
  - Lines 220-233: `refreshGitStatus()` - fetches git status
  - Lines 513-518: `refreshTree()` - refreshes entire tree
  
- `app/apps/file_editor_cm6/static/js/explorer.css` (335 lines)
  - Lines 11-24: `.fe-drawer` container styles
  - Lines 48-93: `.fe-drawer-head` header styles  
  - Lines 95-111: `.fe-drawer-body` and `.fe-tree` layout
  - Lines 114-172: Tree item grid layout and styling
  - Lines 208-282: Git status colors and badges

- `app/apps/file_editor_cm6/template.html` (1552 lines)
  - Lines 8-28: CSS custom properties (color palette)
  - Lines 49-220: Responsive layout (desktop/mobile grid)
  - Lines 1268-1287: Explorer drawer HTML structure
  - Lines 1276-1285: Git footer with buttons

**Backend (Python):**
- `app/apps/file_editor_cm6/explorer_helper.py` (286 lines)
  - Lines 11-13: Module state (`_PROJECT_ROOT`, `_GIT_STATUS_CACHE`)
  - Lines 30-43: `set_project_root()` and `get_project_root()`
  - Lines 46-103: `list_dir()` - main directory listing with git status
  - Lines 106-115: `mark_git_cache_dirty()` - cache invalidation
  - Lines 158-196: `_collect_git_status()` - git porcelain parsing
  - Lines 224-253: `_derive_git_status()` - directory status aggregation
  - Lines 269-286: `_normalize_rel_path()` - path validation

- `app/apps/file_editor_cm6/git_helper.py` (235 lines)
  - Lines 13-35: Data classes (`GitError`, `GitBranches`, `GitStatus`)
  - Lines 37-50: `_run_git()` - git command wrapper
  - Lines 69-73: `_ensure_repo()` - validates git repo
  - Lines 86-105: `_collect_status()` - parses git status
  - Lines 137-169: `get_status()` - comprehensive repo status
  - Lines 172-190: `stage_all()` and `unstage_all()`
  - Lines 193-208: `commit_changes()`
  - Lines 211-234: `push_changes()` and `pull_changes()`

- `app/apps/file_editor_cm6/main.py` (753 lines)
  - Lines 39: `file_editor_cm6_bp` - main router
  - Lines 21-32: Imports from helper modules
  - Lines 105-127: Module initialization
  - Lines 140-149: `_status_to_payload()` - git status serialization
  - Lines 421-435: `/project/open` - project selection endpoint
  - Lines 478-545: Git endpoints (`/git/status`, `/git/stage_all`, `/git/commit`, etc.)
  - Lines 645-651: `/explorer/list` - directory listing endpoint

### 8.2 Existing Patterns to Follow

**Frontend Request Pattern:**
```javascript
// Used throughout explorer.js (e.g., lines 220-233)
async function gitRequest(path, body) {
  const resp = await fetch(`/api/app/file_editor_cm6${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await resp.json().catch(() => null);
  if (!json || json.ok === false) {
    throw new Error(json?.error || resp.statusText || 'Request failed');
  }
  return json.data || {};
}
```

**Backend Endpoint Pattern:**
```python
# Used in main.py (e.g., lines 488-495)
@file_editor_cm6_bp.post('/git/stage_all')
def git_stage_all_route():
    try:
        project_root = _get_active_project_root()
        status = git_stage_all(project_root)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
```

**Explorer Helper Pattern:**
```python
# Used in explorer_helper.py (e.g., lines 46-103)
def some_operation(rel: str) -> dict:
    root = get_project_root()
    target = (root / rel).resolve()
    
    # Security check
    if not str(target).startswith(str(root.resolve())):
        raise ValueError("path outside project root")
    
    # Operation logic here
    
    return {'rel': rel, 'result': 'success'}
```

**Git Helper Pattern:**
```python
# Used in git_helper.py (e.g., lines 172-175)
def some_git_operation(project_root: Path) -> GitStatus:
    _ensure_repo(project_root)
    _run_git(project_root, "some", "command", "args")
    return get_status(project_root)
```

### 8.3 Integration Points

**After Tree Modification:**
```javascript
await refreshTree(treeElement);
await refreshGitStatus(false);
mark_git_cache_dirty(get_project_root()); // Python side
```

**After File Content Changes:**
```javascript
if (typeof window.__cm6ReloadCurrentFile === 'function') {
  await window.__cm6ReloadCurrentFile();
}
```

**Shared File Picker Usage:**
```javascript
// From explorer.js lines 288-323
const result = await window.teFilePicker.openDirectory({
  title: 'Dialog Title',
  startPath: currentProjectPath,
  selectLabel: 'Button Label'  // optional
});
// result = { path: '/absolute/path', label: 'Display Name' }
// Throws/rejects with message 'cancelled' on cancel
```

### 8.4 New Endpoints to Add (Summary)

All endpoints should be added to `main.py` after line 651 (`/explorer/list`):

**Explorer Operations:**
- `POST /explorer/mkdir` - Create directory
- `POST /explorer/touch` - Create file
- `POST /explorer/rename` - Rename entry
- `POST /explorer/delete` - Delete entry
- `POST /explorer/copy` - Copy entry to destination
- `POST /explorer/move` - Move entry to destination
- `POST /explorer/batch_copy` - Batch copy
- `POST /explorer/batch_move` - Batch move
- `POST /explorer/batch_delete` - Batch delete

**Git Operations:**
- `POST /git/stage` - Stage specific paths
- `POST /git/unstage` - Unstage specific paths
- `GET /git/commits_for_path` - Get commit history for file
- `POST /git/restore` - Restore file to commit
- `GET /git/commits` - Get repository commit history
- `POST /git/reset_hard` - Hard reset to commit
- `GET /git/is_repo` - Check if directory is git repo
- `POST /git/init` - Initialize git repository

### 8.5 New Helper Functions to Add

**In `explorer_helper.py` (after line 286):**
- `create_directory(parent_rel: str, name: str) -> dict`
- `create_file(parent_rel: str, name: str) -> dict`
- `rename_entry(rel: str, new_name: str) -> dict`
- `copy_entry(rel: str, dest_dir_path: str) -> dict`
- `move_entry(rel: str, dest_dir_path: str) -> dict`
- `batch_copy(rels: list[str], dest_dir_path: str) -> dict`
- `batch_move(rels: list[str], dest_dir_path: str) -> dict`
- `delete_entry(rel: str) -> dict`
- `batch_delete(rels: list[str]) -> dict`

**In `git_helper.py` (after line 235):**
- `stage_paths(project_root: Path, paths: List[str]) -> GitStatus`
- `unstage_paths(project_root: Path, paths: List[str]) -> GitStatus`
- `GitCommit` dataclass (hash, short_hash, summary, author, date)
- `get_commits_for_path(project_root: Path, path: str, limit: int) -> List[GitCommit]`
- `restore_path(project_root: Path, path: str, commit: str) -> None`
- `get_commits(project_root: Path, limit: int) -> List[GitCommit]`
- `reset_hard(project_root: Path, commit: str) -> GitStatus`
- `init_repository(project_root: Path) -> GitStatus`
- `is_git_repository(project_root: Path) -> bool`

### 8.6 CSS Classes to Add

**In `explorer.css`:**
- `.fe-entry-icon` - Icon container
- `.fe-entry-icon-dir` - Directory icon modifier
- `.fe-entry-icon-file` - File icon modifier
- `.fe-card-menu-btn` - Three-dot menu button
- `.fe-card-menu` - Floating context menu (can extend `.fe-dropdown`)
- `.fe-entry-checkbox` - Checkbox for select mode
- `.fe-tree-select-mode` - Grid modifier for select mode
- `.fe-tree-root` - Root project node styling

**Media query to add:**
```css
@media (hover: hover) and (pointer: fine) {
  .fe-tree li:hover { /* existing hover styles */ }
  /* Move all :hover rules here */
}
```

---

## 9. Implementation Logging Requirements

**IMPORTANT:** After completing each checkpoint (A, B, or C), the implementing model MUST append a timestamped log entry to the end of this document with:

1. **Checkpoint identifier** (A, B, or C)
2. **Completion timestamp** (ISO 8601 format)
3. **Summary of changes made:**
   - Files modified (with brief description of changes)
   - New functions/endpoints added
   - CSS changes made
4. **Issues encountered:**
   - Any bugs or unexpected behaviors
   - Workarounds applied
   - Deviations from the plan
5. **Testing notes:**
   - What was tested
   - Any failing tests or issues found

**Log Entry Format:**
```
---
### CHECKPOINT [A/B/C] - COMPLETION LOG
**Timestamp:** YYYY-MM-DDTHH:MM:SS.sssZ
**Implementer:** [Model name/version]

**Changes Made:**
- File: `path/to/file.ext`
  - Description of changes
- File: `path/to/file.ext`
  - Description of changes

**New Additions:**
- Functions: list of new function names
- Endpoints: list of new endpoint paths
- CSS Classes: list of new classes

**Issues Encountered:**
- Issue 1: Description and resolution
- Issue 2: Description and resolution

**Testing Notes:**
- Tested: Feature X - Status
- Tested: Feature Y - Status

**Next Steps:**
- Notes for next checkpoint or follow-up work
```

---

**Plan Last Updated:** 2025-11-16T03:11:32.947Z
**Updated By:** Claude (Anthropic)
