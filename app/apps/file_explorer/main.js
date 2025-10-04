const HOME_DIR = '/data/data/com.termux/files/home';
const TERMUX_BASE = HOME_DIR.replace(/\/files\/home$/, '');
const TYPE_ICON = {
  directory: '📁',
  file: '📄',
  symlink: '🔗',
  unknown: '❔',
};

// Editable file extensions - can be opened in file editor
const EDITABLE_EXTENSIONS = new Set([
  '.txt', '.text', '.md', '.markdown',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.pyw', '.pyi',
  '.sh', '.bash', '.zsh', '.fish', '.ksh',
  '.json', '.jsonc', '.json5',
  '.xml', '.html', '.htm', '.xhtml', '.svg',
  '.css', '.scss', '.sass', '.less',
  '.yaml', '.yml',
  '.toml', '.ini', '.cfg', '.conf', '.config',
  '.env', '.env.local', '.env.production',
  '.gitignore', '.dockerignore', '.npmignore',
  '.editorconfig', '.prettierrc', '.eslintrc',
  '.bashrc', '.zshrc', '.vimrc', '.tmux.conf',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx',
  '.java', '.kt', '.kts',
  '.go', '.rs', '.rb', '.php', '.pl',
  '.r', '.R', '.sql', '.lua', '.vim',
  '.dockerfile', 'Dockerfile',
  '.makefile', 'Makefile',
  '.log', '.csv', '.tsv'
]);

function isEditableFile(filename) {
  if (!filename) return false;
  const name = filename.toLowerCase();
  // Check exact matches first (like Dockerfile, Makefile)
  if (EDITABLE_EXTENSIONS.has(name)) return true;
  // Check extensions
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1) return false;
  const ext = name.slice(lastDot);
  return EDITABLE_EXTENSIONS.has(ext);
}

const ARCHIVE_EXTENSIONS = new Set([
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar'
]);

function isArchive(filename) {
  if (!filename) return false;
  const name = filename.toLowerCase();
  // Check for compound extensions
  if (name.endsWith('.tar.gz') || name.endsWith('.tar.bz2') || name.endsWith('.tar.xz')) {
    return true;
  }
  // Check single extensions
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1) return false;
  const ext = name.slice(lastDot);
  return ARCHIVE_EXTENSIONS.has(ext);
}

function parentPath(path) {
  if (!path || path === '/') return '/';
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '/';
  const parent = trimmed.slice(0, idx);
  return parent || '/';
}

function isWithinTermux(path) {
  if (!path) return false;
  const abs = path.endsWith('/') ? path.slice(0, -1) : path;
  if (!TERMUX_BASE) return abs === HOME_DIR || abs.startsWith(`${HOME_DIR}/`);
  return abs === TERMUX_BASE || abs === HOME_DIR || abs.startsWith(`${TERMUX_BASE}/`);
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function formatDate(mtime) {
  if (!Number.isFinite(mtime)) return '';
  try {
    return new Date(mtime * 1000).toLocaleString();
  } catch (_) {
    return '';
  }
}

function toast(host, message) {
  if (!message) return;
  if (host && typeof host.toast === 'function') {
    host.toast(message);
  } else if (window.teUI && typeof window.teUI.toast === 'function') {
    window.teUI.toast(message);
  } else {
    console.log('[toast]', message);
  }
}

export default function initFileExplorer(root, api, host) {
  const container = root.querySelector('[data-app-root]') || root;
  if (host && typeof host.setTitle === 'function') {
    host.setTitle('File Explorer');
  }

  const savedState = host && typeof host.loadState === 'function'
    ? host.loadState(null)
    : null;

  const prefs = {
    path: savedState?.path && typeof savedState.path === 'string' ? savedState.path : HOME_DIR,
    showHidden: !!(savedState && savedState.showHidden),
    view: savedState?.view === 'grid' ? 'grid' : 'list',
    sortBy: savedState?.sortBy || 'name',
    sortAsc: savedState?.sortAsc !== false,  // Default to ascending
  };

  const ui = {
    breadcrumbs: container.querySelector('[data-role="breadcrumbs"]'),
    listWrapper: container.querySelector('.fx-list-view'),
    listContainer: container.querySelector('[data-role="list"]'),
    gridWrapper: container.querySelector('.fx-grid-view'),
    gridContainer: container.querySelector('[data-role="grid"]'),
    btnUp: container.querySelector('[data-action="up"]'),
    btnNewFolder: container.querySelector('[data-action="new-folder"]'),
    btnNewFile: container.querySelector('[data-action="new-file"]'),
    btnOpen: container.querySelector('[data-action="open"]'),
    btnRename: container.querySelector('[data-action="rename"]'),
    btnDelete: container.querySelector('[data-action="delete"]'),
    btnCopy: container.querySelector('[data-action="copy"]'),
    btnMove: container.querySelector('[data-action="move"]'),
    btnToggleView: container.querySelector('[data-action="toggle-view"]'),
    toggleHidden: container.querySelector('[data-action="toggle-hidden"]'),
    sortSelect: container.querySelector('[data-action="sort-by"]'),
    btnSortDir: container.querySelector('[data-action="sort-dir"]'),
  };

  const state = {
    currentPath: prefs.path,
    entries: [],
    selected: null,
    view: prefs.view,
    sortBy: prefs.sortBy,
    sortAsc: prefs.sortAsc,
  };

  if (ui.toggleHidden) {
    ui.toggleHidden.checked = prefs.showHidden;
  }
  
  // Initialize sort controls
  if (ui.sortSelect) {
    ui.sortSelect.value = state.sortBy;
  }
  if (ui.btnSortDir) {
    ui.btnSortDir.textContent = state.sortAsc ? '↓' : '↑';
    ui.btnSortDir.title = state.sortAsc ? 'Sort ascending (click for descending)' : 'Sort descending (click for ascending)';
  }

  function persistState() {
    if (host && typeof host.saveState === 'function') {
      host.saveState({
        path: state.currentPath,
        showHidden: !!(ui.toggleHidden && ui.toggleHidden.checked),
        view: state.view,
        sortBy: state.sortBy,
        sortAsc: state.sortAsc,
      });
    }
  }

  function setLoading() {
    if (ui.listContainer) {
      ui.listContainer.innerHTML = '<div class="fx-loading">Loading...</div>';
    }
    if (ui.gridContainer) {
      ui.gridContainer.innerHTML = '';
      const loading = document.createElement('div');
      loading.className = 'fx-loading';
      loading.textContent = 'Loading...';
      ui.gridContainer.appendChild(loading);
    }
  }

  function clearSelection() {
    state.selected = null;
    container.querySelectorAll('.fx-item.selected, .fx-tile.selected').forEach((el) => {
      el.classList.remove('selected');
    });
    updateActionButtons();
  }

  function updateActionButtons() {
    const hasSelection = !!state.selected;
    // Enable open button for files and symlinks (symlinks will be followed)
    if (ui.btnOpen) ui.btnOpen.disabled = !hasSelection;
    if (ui.btnRename) ui.btnRename.disabled = !hasSelection;
    if (ui.btnDelete) ui.btnDelete.disabled = !hasSelection;
    if (ui.btnCopy) ui.btnCopy.disabled = !hasSelection;
    if (ui.btnMove) ui.btnMove.disabled = !hasSelection;
    if (ui.btnToggleView) {
      ui.btnToggleView.textContent = state.view === 'list' ? 'Grid View' : 'List View';
    }
  }

  function applyView() {
    if (ui.listWrapper) ui.listWrapper.style.display = state.view === 'list' ? 'block' : 'none';
    if (ui.gridWrapper) ui.gridWrapper.style.display = state.view === 'grid' ? 'block' : 'none';
    updateActionButtons();
    persistState();
  }

  function renderBreadcrumbs() {
    if (!ui.breadcrumbs) return;
    const path = state.currentPath;
    const crumbs = [];
    if (isWithinTermux(path)) {
      if (path === HOME_DIR || path.startsWith(`${HOME_DIR}/`)) {
        crumbs.push({ label: 'Home', value: HOME_DIR });
        const remainder = path.slice(HOME_DIR.length).split('/').filter(Boolean);
        let accumulator = HOME_DIR;
        remainder.forEach((segment) => {
          accumulator = `${accumulator.replace(/\/+$/, '')}/${segment}`;
          crumbs.push({ label: segment, value: accumulator });
        });
      } else {
        crumbs.push({ label: 'Termux', value: TERMUX_BASE || '/data/data/com.termux' });
        const relative = path.slice((TERMUX_BASE || '/data/data/com.termux').length).split('/').filter(Boolean);
        let accumulator = TERMUX_BASE || '/data/data/com.termux';
        relative.forEach((segment) => {
          accumulator = `${accumulator.replace(/\/+$/, '')}/${segment}`;
          crumbs.push({ label: segment, value: accumulator });
        });
      }
    } else {
      crumbs.push({ label: '⚡ /', value: '/' });
      const segments = path.replace(/\/+$/, '').split('/').filter(Boolean);
      let accumulator = '';
      segments.forEach((segment) => {
        accumulator += `/${segment}`;
        crumbs.push({ label: segment, value: accumulator || '/' });
      });
    }

    ui.breadcrumbs.innerHTML = '';
    crumbs.forEach((crumb, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'fx-crumb-sep';
        sep.textContent = '/';
        ui.breadcrumbs.appendChild(sep);
      }
      const span = document.createElement('span');
      span.className = 'fx-crumb' + (index === crumbs.length - 1 ? ' current' : '');
      span.textContent = crumb.label || '/';
      if (index !== crumbs.length - 1) {
        span.addEventListener('click', () => {
          loadDirectory(crumb.value);
        });
      }
      ui.breadcrumbs.appendChild(span);
    });
  }

  function selectEntry(entry, nodes) {
    state.selected = entry;
    container.querySelectorAll('.fx-item.selected, .fx-tile.selected').forEach((el) => el.classList.remove('selected'));
    if (nodes.row) nodes.row.classList.add('selected');
    if (nodes.tile) nodes.tile.classList.add('selected');
    updateActionButtons();
  }

  function renderEntries() {
    if (!ui.listContainer || !ui.gridContainer) return;
    ui.listContainer.innerHTML = '';
    ui.gridContainer.innerHTML = '';

    const entries = state.entries.slice().sort((a, b) => {
      // Directories always come first
      const dirOrder = Number(a.type !== 'directory') - Number(b.type !== 'directory');
      if (dirOrder !== 0) return dirOrder;
      
      // Then sort by selected field
      let cmp = 0;
      switch (state.sortBy) {
        case 'size':
          cmp = (a.size || 0) - (b.size || 0);
          break;
        case 'date':
          cmp = (a.mtime || 0) - (b.mtime || 0);
          break;
        case 'type':
          // Sort by extension then name
          const extA = a.name.includes('.') ? a.name.split('.').pop().toLowerCase() : '';
          const extB = b.name.includes('.') ? b.name.split('.').pop().toLowerCase() : '';
          cmp = extA.localeCompare(extB);
          if (cmp === 0) {
            cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          }
          break;
        case 'name':
        default:
          cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
      }
      
      // Apply sort direction
      return state.sortAsc ? cmp : -cmp;
    });

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'fx-empty';
      empty.textContent = 'This directory is empty.';
      ui.listContainer.appendChild(empty);
      const emptyGrid = empty.cloneNode(true);
      ui.gridContainer.appendChild(emptyGrid);
      return;
    }

    entries.forEach((entry) => {
      const isDir = entry.type === 'directory';
      const isSymlink = entry.type === 'symlink';
      const isFile = entry.type === 'file';
      const isEditable = isFile && isEditableFile(entry.name);
      const isArchiveFile = isFile && isArchive(entry.name);
      
      // For symlinks, add arrow indicator to show it's a link
      let nameDisplay = isSymlink ? `${entry.name} →` : entry.name;
      
      // Create row for list view
      const row = document.createElement('div');
      row.className = 'fx-item';
      if (isSymlink) row.classList.add('fx-symlink');
      
      // Add archive badge if applicable
      const archiveBadge = isArchiveFile ? '<span class="fx-archive-badge">📦 Archive</span>' : '';
      
      row.innerHTML = `
        <span class="fx-icon">${TYPE_ICON[entry.type] || TYPE_ICON.unknown}</span>
        <span class="fx-name">${nameDisplay}${archiveBadge}</span>
        <span class="fx-size">${isDir ? '' : formatSize(entry.size)}</span>
        <span class="fx-date">${formatDate(entry.mtime)}</span>
        <button class="fx-menu-toggle">⋯</button>
        <div class="fx-dropdown-menu"></div>
      `;

      // Create tile for grid view
      const tile = document.createElement('div');
      tile.className = 'fx-tile';
      if (isSymlink) tile.classList.add('fx-symlink');
      tile.innerHTML = `
        <div class="fx-icon-lg">${TYPE_ICON[entry.type] || TYPE_ICON.unknown}</div>
        <div class="fx-name-tile">${nameDisplay}</div>
        <button class="fx-menu-toggle">⋯</button>
        <div class="fx-dropdown-menu"></div>
      `;

      // Create menu items based on file type
      const createMenuItems = (menuEl) => {
        menuEl.innerHTML = '';
        
        // Open/Follow actions
        if (isDir) {
          const openItem = document.createElement('button');
          openItem.className = 'fx-menu-item';
          openItem.innerHTML = '<span class="fx-menu-icon">📁</span> Open';
          openItem.addEventListener('click', (e) => {
            e.stopPropagation();
            menuEl.classList.remove('active');
            loadDirectory(entry.path);
          });
          menuEl.appendChild(openItem);
        } else if (isSymlink) {
          const followItem = document.createElement('button');
          followItem.className = 'fx-menu-item';
          followItem.innerHTML = '<span class="fx-menu-icon">🔗</span> Follow Link';
          followItem.addEventListener('click', async (e) => {
            e.stopPropagation();
            menuEl.classList.remove('active');
            await followSymlink(entry);
          });
          menuEl.appendChild(followItem);
        } else if (isFile) {
          if (isEditable) {
            const editItem = document.createElement('button');
            editItem.className = 'fx-menu-item';
            editItem.innerHTML = '<span class="fx-menu-icon">✏️</span> Open with Text Editor';
            editItem.addEventListener('click', (e) => {
              e.stopPropagation();
              menuEl.classList.remove('active');
              openInEditor(entry.path);
            });
            menuEl.appendChild(editItem);
          }
          
          if (isArchiveFile) {
            const extractItem = document.createElement('button');
            extractItem.className = 'fx-menu-item';
            extractItem.innerHTML = '<span class="fx-menu-icon">📤</span> Extract Archive';
            extractItem.addEventListener('click', async (e) => {
              e.stopPropagation();
              menuEl.classList.remove('active');
              await extractArchive(entry);
            });
            menuEl.appendChild(extractItem);
          }
        }
        
        // Divider
        const divider = document.createElement('div');
        divider.className = 'fx-menu-divider';
        menuEl.appendChild(divider);
        
        // File operations
        const copyItem = document.createElement('button');
        copyItem.className = 'fx-menu-item';
        copyItem.innerHTML = '<span class="fx-menu-icon">📋</span> Copy';
        copyItem.addEventListener('click', async (e) => {
          e.stopPropagation();
          menuEl.classList.remove('active');
          state.selected = entry;
          await copySelected();
        });
        menuEl.appendChild(copyItem);
        
        const moveItem = document.createElement('button');
        moveItem.className = 'fx-menu-item';
        moveItem.innerHTML = '<span class="fx-menu-icon">✂️</span> Move';
        moveItem.addEventListener('click', async (e) => {
          e.stopPropagation();
          menuEl.classList.remove('active');
          state.selected = entry;
          await moveSelected();
        });
        menuEl.appendChild(moveItem);
        
        const renameItem = document.createElement('button');
        renameItem.className = 'fx-menu-item';
        renameItem.innerHTML = '<span class="fx-menu-icon">🏷️</span> Rename';
        renameItem.addEventListener('click', async (e) => {
          e.stopPropagation();
          menuEl.classList.remove('active');
          state.selected = entry;
          await renameSelected();
        });
        menuEl.appendChild(renameItem);
        
        // Divider before delete
        const divider2 = document.createElement('div');
        divider2.className = 'fx-menu-divider';
        menuEl.appendChild(divider2);
        
        const deleteItem = document.createElement('button');
        deleteItem.className = 'fx-menu-item danger';
        deleteItem.innerHTML = '<span class="fx-menu-icon">🗑️</span> Delete';
        deleteItem.addEventListener('click', async (e) => {
          e.stopPropagation();
          menuEl.classList.remove('active');
          state.selected = entry;
          await deleteSelected();
        });
        menuEl.appendChild(deleteItem);
      };
      
      // Setup menu toggles
      const rowMenuBtn = row.querySelector('.fx-menu-toggle');
      const rowMenu = row.querySelector('.fx-dropdown-menu');
      const tileMenuBtn = tile.querySelector('.fx-menu-toggle');
      const tileMenu = tile.querySelector('.fx-dropdown-menu');
      
      createMenuItems(rowMenu);
      createMenuItems(tileMenu);
      
      // Menu toggle handlers
      rowMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasActive = rowMenu.classList.contains('active');
        // Close all other menus
        container.querySelectorAll('.fx-dropdown-menu.active').forEach(m => m.classList.remove('active'));
        container.querySelectorAll('.fx-menu-toggle.active').forEach(b => b.classList.remove('active'));
        if (!wasActive) {
          rowMenu.classList.add('active');
          rowMenuBtn.classList.add('active');
        }
      });
      
      tileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasActive = tileMenu.classList.contains('active');
        // Close all other menus
        container.querySelectorAll('.fx-dropdown-menu.active').forEach(m => m.classList.remove('active'));
        container.querySelectorAll('.fx-menu-toggle.active').forEach(b => b.classList.remove('active'));
        if (!wasActive) {
          tileMenu.classList.add('active');
          tileMenuBtn.classList.add('active');
        }
      });
      
      const handleSelect = () => {
        // Close any open menus when selecting
        container.querySelectorAll('.fx-dropdown-menu.active').forEach(m => m.classList.remove('active'));
        container.querySelectorAll('.fx-menu-toggle.active').forEach(b => b.classList.remove('active'));
        selectEntry(entry, { row, tile });
      };

      row.addEventListener('click', handleSelect);
      tile.addEventListener('click', handleSelect);

      if (isSymlink) {
        // For symlinks, resolve and follow on double-click
        const handleSymlink = async (ev) => {
          ev?.preventDefault();
          await followSymlink(entry);
        };
        row.addEventListener('dblclick', handleSymlink);
        tile.addEventListener('dblclick', handleSymlink);
      } else if (isDir) {
        const openDir = (ev) => {
          ev?.preventDefault();
          loadDirectory(entry.path);
        };
        row.addEventListener('dblclick', openDir);
        tile.addEventListener('dblclick', openDir);
      } else {
        const openFile = (ev) => {
          ev?.preventDefault();
          openSelected();
        };
        row.addEventListener('dblclick', openFile);
        tile.addEventListener('dblclick', openFile);
      }

      ui.listContainer.appendChild(row);
      ui.gridContainer.appendChild(tile);
    });
  }

  async function loadDirectory(targetPath) {
    const normalized = targetPath || state.currentPath || HOME_DIR;
    clearSelection();
    setLoading();
    try {
      const hiddenParam = ui.toggleHidden && ui.toggleHidden.checked ? '1' : '0';
      const payload = await api.get(`list?path=${encodeURIComponent(normalized)}&hidden=${hiddenParam}`);
      const entries = Array.isArray(payload) ? payload : [];
      state.currentPath = normalized;
      state.entries = entries;
      state.selected = null;
      renderBreadcrumbs();
      renderEntries();
      updateActionButtons();
      state.view = state.view === 'grid' ? 'grid' : 'list';
      applyView();
      persistState();
    } catch (error) {
      const message = error?.message || 'Failed to load directory';
      if (ui.listContainer) {
        ui.listContainer.innerHTML = '';
        const node = document.createElement('div');
        node.className = 'fx-empty';
        node.style.color = '#fca5a5';
        node.textContent = message;
        ui.listContainer.appendChild(node);
      }
      if (ui.gridContainer) {
        ui.gridContainer.innerHTML = '';
        const node = document.createElement('div');
        node.className = 'fx-empty';
        node.style.color = '#fca5a5';
        node.textContent = message;
        ui.gridContainer.appendChild(node);
      }
      toast(host, message);
    }
  }

  async function createFolder() {
    const base = state.currentPath;
    const name = (prompt('New folder name:') || '').trim();
    if (!name) return;
    if (/[\\/]/.test(name) || name === '.' || name === '..') {
      toast(host, 'Invalid folder name');
      return;
    }
    try {
      await api.post('mkdir', { path: base, name });
      toast(host, `Created folder "${name}"`);
      await loadDirectory(base);
    } catch (error) {
      toast(host, error?.message || 'Failed to create folder');
    }
  }

  async function createNewFile() {
    if (!window.teFilePicker || typeof window.teFilePicker.saveFile !== 'function') {
      // Fallback to prompt if file picker unavailable
      const name = (prompt('New file name:') || '').trim();
      if (!name) return;
      if (/[\\/]/.test(name)) {
        toast(host, 'Invalid file name');
        return;
      }
      const fullPath = `${state.currentPath.replace(/\/$/, '')}/${name}`;
      // Create empty file and open in editor
      window.location.href = `/app/file_editor?file=${encodeURIComponent(fullPath)}`;
      return;
    }

    try {
      const result = await window.teFilePicker.saveFile({
        title: 'Create New File',
        startPath: state.currentPath,
        filename: 'untitled.txt',
        selectLabel: 'Create',
      });
      
      if (!result || !result.path) return;
      
      // Create empty file and open in editor
      window.location.href = `/app/file_editor?file=${encodeURIComponent(result.path)}`;
    } catch (error) {
      if (error && error.message === 'cancelled') return;
      toast(host, error?.message || 'Failed to create file');
    }
  }

  async function renameSelected() {
    if (!state.selected) return;
    const next = (prompt('Rename to:', state.selected.name) || '').trim();
    if (!next || next === state.selected.name) return;
    try {
      await api.post('rename', { path: state.selected.path, name: next });
      toast(host, `Renamed to "${next}"`);
      await loadDirectory(state.currentPath);
    } catch (error) {
      toast(host, error?.message || 'Failed to rename');
    }
  }

  async function deleteSelected() {
    if (!state.selected) return;
    const confirmed = confirm(`Delete "${state.selected.name}"? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await api.post('delete', { path: state.selected.path });
      toast(host, `Deleted "${state.selected.name}"`);
      await loadDirectory(state.currentPath);
    } catch (error) {
      toast(host, error?.message || 'Failed to delete');
    }
  }

  async function copySelected() {
    if (!state.selected) return;
    if (!window.teFilePicker || typeof window.teFilePicker.saveFile !== 'function') {
      toast(host, 'File picker unavailable');
      return;
    }
    try {
      const startDir = state.currentPath;
      const pickerResult = await window.teFilePicker.saveFile({
        title: 'Copy As...',
        startPath: startDir,
        filename: state.selected.name,
        selectLabel: 'Copy',
      });
      if (!pickerResult || !pickerResult.path) return;
      await api.post('copy', { source: state.selected.path, dest: pickerResult.path });
      toast(host, `Copied "${state.selected.name}" to ${pickerResult.path}`);
      if (parentPath(pickerResult.path) === state.currentPath) {
        await loadDirectory(state.currentPath);
      }
    } catch (error) {
      if (error && error.message === 'cancelled') return;
      toast(host, error?.message || 'Copy failed');
    }
  }

  async function moveSelected() {
    if (!state.selected) return;
    if (!window.teFilePicker || typeof window.teFilePicker.openDirectory !== 'function') {
      toast(host, 'File picker unavailable');
      return;
    }
    try {
      const choice = await window.teFilePicker.openDirectory({ title: 'Move to...', startPath: state.currentPath });
      if (!choice || !choice.path) return;
      await api.post('move', { source: state.selected.path, dest: choice.path });
      toast(host, `Moved "${state.selected.name}" to ${choice.path}`);
      await loadDirectory(state.currentPath);
    } catch (error) {
      if (error && error.message === 'cancelled') return;
      toast(host, error?.message || 'Move failed');
    }
  }

  async function followSymlink(entry) {
    try {
      const response = await api.get(`resolve_symlink?path=${encodeURIComponent(entry.path)}`);
      if (response.is_symlink && response.target_exists) {
        if (response.target_type === 'directory') {
          loadDirectory(response.target);
        } else if (response.target_type === 'file') {
          // Open target file in editor
          window.location.href = `/app/file_editor?file=${encodeURIComponent(response.target)}`;
        } else if (response.target_type === 'symlink') {
          toast(host, 'Target is another symlink. Following...');
          // Follow chain of symlinks
          await followSymlink({ path: response.target });
        }
      } else if (!response.target_exists) {
        toast(host, 'Symlink target does not exist');
      } else {
        // Not a symlink, handle normally
        if (entry.type === 'directory') {
          loadDirectory(entry.path);
        } else {
          window.location.href = `/app/file_editor?file=${encodeURIComponent(entry.path)}`;
        }
      }
    } catch (error) {
      toast(host, error?.message || 'Failed to resolve symlink');
    }
  }

  async function openSelected() {
    if (!state.selected) return;
    
    if (state.selected.type === 'symlink') {
      // Follow symlink to its target
      await followSymlink(state.selected);
    } else if (state.selected.type === 'directory') {
      loadDirectory(state.selected.path);
    } else {
      // Check if file can be edited
      if (!isEditableFile(state.selected.name)) {
        toast(host, 'This file type cannot be opened in the text editor');
        return;
      }
      // Open file in editor
      const target = state.selected.path;
      window.location.href = `/app/file_editor?file=${encodeURIComponent(target)}`;
    }
  }
  
  function openInEditor(filePath) {
    // Open file directly in the file_editor app
    window.location.href = `/app/file_editor?file=${encodeURIComponent(filePath)}`;
  }
  
  async function extractArchive(entry) {
    // Placeholder for archive extraction
    // TODO: Implement actual extraction logic
    toast(host, `Archive extraction for "${entry.name}" - Feature coming soon!`);
    
    // Future implementation would:
    // 1. Call backend extraction endpoint
    // 2. Let user choose extraction location
    // 3. Show progress
    // 4. Refresh directory when done
  }

  if (ui.btnUp) {
    ui.btnUp.addEventListener('click', () => {
      const parent = parentPath(state.currentPath);
      loadDirectory(parent);
    });
  }
  if (ui.btnNewFolder) ui.btnNewFolder.addEventListener('click', createFolder);
  if (ui.btnNewFile) ui.btnNewFile.addEventListener('click', createNewFile);
  if (ui.btnOpen) ui.btnOpen.addEventListener('click', openSelected);
  if (ui.btnRename) ui.btnRename.addEventListener('click', renameSelected);
  if (ui.btnDelete) ui.btnDelete.addEventListener('click', deleteSelected);
  if (ui.btnCopy) ui.btnCopy.addEventListener('click', copySelected);
  if (ui.btnMove) ui.btnMove.addEventListener('click', moveSelected);
  if (ui.btnToggleView) {
    ui.btnToggleView.addEventListener('click', () => {
      state.view = state.view === 'list' ? 'grid' : 'list';
      applyView();
    });
  }
  if (ui.toggleHidden) {
    ui.toggleHidden.addEventListener('change', () => {
      loadDirectory(state.currentPath);
    });
  }
  if (ui.sortSelect) {
    ui.sortSelect.addEventListener('change', () => {
      state.sortBy = ui.sortSelect.value;
      renderEntries();
      persistState();
    });
  }
  if (ui.btnSortDir) {
    ui.btnSortDir.addEventListener('click', () => {
      state.sortAsc = !state.sortAsc;
      ui.btnSortDir.textContent = state.sortAsc ? '↓' : '↑';
      ui.btnSortDir.title = state.sortAsc ? 'Sort ascending (click for descending)' : 'Sort descending (click for ascending)';
      renderEntries();
      persistState();
    });
  }

  // Add click-outside handler to close menus
  document.addEventListener('click', (e) => {
    // Close menus if clicking outside of any menu or toggle button
    if (!e.target.closest('.fx-dropdown-menu') && !e.target.closest('.fx-menu-toggle')) {
      container.querySelectorAll('.fx-dropdown-menu.active').forEach(m => m.classList.remove('active'));
      container.querySelectorAll('.fx-menu-toggle.active').forEach(b => b.classList.remove('active'));
    }
  });
  
  applyView();
  loadDirectory(state.currentPath);

  return null;
}
