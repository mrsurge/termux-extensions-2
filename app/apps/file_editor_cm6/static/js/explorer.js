// app/apps/file_editor_cm6/static/js/explorer.js

// explorer.js - File Explorer Drawer for CM6 Editor
let currentProjectPath = '';
let cachedState = null;

async function getEditorState(forceRefresh = false) {
  if (!forceRefresh && cachedState) return cachedState;
  if (typeof window.__cm6SyncState === 'function') {
    cachedState = await window.__cm6SyncState(forceRefresh);
    return cachedState;
  }
  try {
    const resp = await fetch('/api/app/file_editor_cm6/state', { cache: 'no-store' });
    const json = await resp.json();
    cachedState = json?.data || null;
    return cachedState;
  } catch (err) {
    console.error('Failed to fetch editor state:', err);
    cachedState = null;
    return null;
  }
}

function toast(message) {
  if (window.host && typeof window.host.toast === 'function') {
    window.host.toast(message);
  } else {
    alert(message);
  }
}

window.__cm6RefreshRecents = (state) => {
  if (state) {
    cachedState = state;
  }
  renderRecentMenu(state);
};

export async function initExplorerUI() {
  const backdrop = document.getElementById('fe-backdrop');
  backdrop?.addEventListener('click', () => root?.classList.remove('drawer-open'));
  const btnOpenProject = document.getElementById('fe-open-project');
  const ddBtn = document.getElementById('recent-files-btn');
  const dd = document.getElementById('recent-files-dd');
  const root = document.querySelector('.fe-root');
  const drawerClose = document.getElementById('fe-drawer-close');
  const drawerOpenBtn = document.getElementById('fe-drawer-open');
  const drawerBackdrop = document.getElementById('fe-drawer-backdrop');
  const treeEl = document.getElementById('fe-file-tree');

  const state = await refreshCurrentProject(true);
  await renderRecentMenu(state);
  if (treeEl && state?.activeProjectExists) {
    renderTreeRoot(treeEl);
  }

  btnOpenProject?.addEventListener('click', openProjectPrompt);
  ddBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    dd.classList.toggle('show');
  });

  // Toggle drawer function matching old IDE
  function toggleDrawer(open) {
    if (open === undefined) {
      root?.classList.toggle('drawer-open');
    } else if (open) {
      root?.classList.add('drawer-open');
    } else {
      root?.classList.remove('drawer-open');
    }
  }

  // Close drawer
  drawerClose?.addEventListener('click', () => toggleDrawer(false));
  drawerBackdrop?.addEventListener('click', () => toggleDrawer(false));

  // Open drawer
  drawerOpenBtn?.addEventListener('click', () => toggleDrawer(true));

  treeEl?.addEventListener('click', onTreeClick);
}

function basename(path) {
  if (!path || path === '/') return '/';
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || '/';
}

async function refreshCurrentProject(forceRefresh = false) {
  const state = await getEditorState(forceRefresh);
  const label = document.getElementById('fe-project-label');

  currentProjectPath = state?.activeProjectExists ? state.activeProject : '';

  if (label) {
    if (state?.activeProject) {
      const display = state.activeProjectExists
        ? (state.activeProjectLabel || basename(state.activeProject))
        : `${state.activeProjectLabel || basename(state.activeProject)} (missing)`;
      label.textContent = display;
      label.title = state.activeProject;
      label.classList.toggle('fe-label-missing', !state.activeProjectExists);
    } else {
      label.textContent = '(none)';
      label.title = '';
      label.classList.remove('fe-label-missing');
    }
  }

  return state;
}

async function openProjectPrompt() {
  // 1. Verify the shared picker is available
  if (!window.teFilePicker) {
    alert('File picker is not available.');
    return;
  }

  try {
    // 2. Launch the directory picker modal
    const choice = await window.teFilePicker.openDirectory({
      title: 'Open Project Directory',
      selectLabel: 'Set as Project'
    });

    // 3. Send the valid, absolute path to the backend
    const r = await fetch('/api/app/file_editor_cm6/project/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: choice.path })
    });
    const j = await r.json();

    // 4. Reload the page on success
    if (j?.ok) {
      location.reload();
    } else {
      alert(`Failed to open project: ${j?.error || 'Unknown error'}`);
    }
  } catch (e) {
    // 5. Gracefully handle cancellation (picker promise rejects on cancel)
    if (e && e.message !== 'cancelled') {
      alert(`An error occurred: ${e.message}`);
    }
    // If the error is 'cancelled', we do nothing.
  }
}

async function renderRecentMenu(state) {
  const dd = document.getElementById('recent-files-dd');
  const ddBtn = document.getElementById('recent-files-btn');

  if (!dd || !ddBtn) return;

  dd.innerHTML = '';

  try {
    const s = state || await getEditorState(false);
    cachedState = s;
    const files = s?.recents || [];

    if (files.length === 0) {
      ddBtn.disabled = true;
      const emptyItem = document.createElement('div');
      emptyItem.className = 'fe-dd-item';
      emptyItem.textContent = 'No recent files';
      emptyItem.style.opacity = '0.5';
      dd.appendChild(emptyItem);
      return;
    }

    ddBtn.disabled = false;

    files.forEach(entry => {
      const div = document.createElement('div');
      div.className = 'fe-dd-item';
      div.style.display = 'flex';
      div.style.justifyContent = 'space-between';
      div.style.alignItems = 'center';

      const span = document.createElement('span');
      span.textContent = entry.exists ? (entry.label || entry.path) : `${entry.label || entry.path} (missing)`;
      span.title = entry.path;
      span.style.flex = '1';
      span.style.cursor = 'pointer';
      if (!entry.exists) {
        span.classList.add('fe-dd-item-missing');
      }

      const x = document.createElement('button');
      x.textContent = '×';
      x.className = 'fe-btn';
      x.style.marginLeft = '8px';
      x.style.padding = '2px 6px';

      span.addEventListener('click', () => {
        dd.classList.remove('show');
        if (!entry.exists) {
          toast(`File "${entry.label}" not found.`);
          return;
        }
        openFile(entry.path);
      });

      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeRecent(entry.path);
        div.remove();
      });

      div.appendChild(span);
      div.appendChild(x);
      dd.appendChild(div);
    });
  } catch (e) {
    console.error('Failed to render recent menu:', e);
  }
}

async function removeRecent(path) {
  try {
    const u = new URL('/api/app/file_editor_cm6/history/file', location.href);
    u.searchParams.set('path', path);
    await fetch(u, { method: 'DELETE' });
    await getEditorState(true);
    await renderRecentMenu();
  } catch (e) {
    console.error('Failed to remove recent file:', e);
  }
}

function renderTreeRoot(treeEl) {
  treeEl.replaceChildren();
  if (!currentProjectPath) {
    const empty = document.createElement('li');
    empty.className = 'fe-tree-empty';
    empty.textContent = 'Select a project to load the explorer.';
    treeEl.appendChild(empty);
    return;
  }
  addTreeChildren(treeEl, '.');
}

async function addTreeChildren(parentEl, rel) {
  try {
    const u = new URL('/api/app/file_editor_cm6/explorer/list', location.href);
    u.searchParams.set('dir', rel);
    const r = await fetch(u);
    const j = await r.json();

    if (!j?.ok) {
      console.error('Failed to list directory:', j?.error);
      return;
    }

    const entries = j?.data?.entries || [];

    entries.forEach(e => {
      const li = document.createElement('li');
      li.className = 'fe-tree-node';
      li.dataset.kind = e.kind;
      li.dataset.rel = e.rel;
      li.dataset.open = 'false';

      const twisty = document.createElement('button');
      twisty.className = 'fe-tree-twisty';
      twisty.textContent = e.kind === 'dir' ? '▸' : '';
      twisty.style.visibility = e.kind === 'dir' ? 'visible' : 'hidden';

      const text = document.createElement('span');
      text.className = 'fe-tree-text';
      text.textContent = e.name;

      li.appendChild(twisty);
      li.appendChild(text);
      parentEl.appendChild(li);
    });
  } catch (e) {
    console.error('Failed to add tree children:', e);
  }
}

async function onTreeClick(ev) {
  if (!currentProjectPath) {
    toast('Select a project before browsing files.');
    return;
  }
  const li = ev.target.closest('li.fe-tree-node');
  if (!li) return;

  const rel = li.dataset.rel;
  const kind = li.dataset.kind;

  if (kind === 'dir') {
    const isOpen = li.dataset.open === 'true';
    const twisty = li.querySelector('.fe-tree-twisty');

    if (isOpen) {
      // Collapse
      li.dataset.open = 'false';
      if (twisty) twisty.textContent = '▸';
      const ul = li.querySelector(':scope > ul');
      if (ul) ul.remove();
    } else {
      // Expand
      li.dataset.open = 'true';
      if (twisty) twisty.textContent = '▾';
      const ul = document.createElement('ul');
      ul.className = 'fe-tree';
      li.appendChild(ul);
      await addTreeChildren(ul, rel);
    }
  } else {
    // File clicked - open it
    openFileRel(rel, currentProjectPath);
  }
}

// These functions will be provided by main.js
function openFile(absPath) {
  if (window.appOpenFile) {
    window.appOpenFile(absPath);
  } else {
    console.error('appOpenFile not available');
  }
}

function openFileRel(rel, projectRoot) {
  if (window.appOpenFileRel) {
    window.appOpenFileRel(rel, projectRoot);
  } else {
    console.error('appOpenFileRel not available');
  }
}
