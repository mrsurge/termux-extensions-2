// explorer.js - File Explorer Drawer for CM6 Editor
let currentProjectPath = '';

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

  await refreshCurrentProject();
  await renderRecentMenu();
  if (treeEl) {
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

async function refreshCurrentProject() {
  try {
    const r = await fetch('project/current');
    const j = await r.json();
    currentProjectPath = j?.data?.path || '';
    const label = document.getElementById('fe-project-label');
    if (label) {
      label.textContent = currentProjectPath || '(none)';
    }
  } catch (e) {
    console.error('Failed to refresh current project:', e);
  }
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
    const r = await fetch('project/open', {
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

async function renderRecentMenu() {
  const dd = document.getElementById('recent-files-dd');
  const ddBtn = document.getElementById('recent-files-btn');

  if (!dd) return;

  dd.innerHTML = '';

  try {
    const r = await fetch('history/files');
    const j = await r.json();
    const files = j?.data || [];

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
      span.textContent = entry.label || entry.path;
      span.title = entry.path;
      span.style.flex = '1';
      span.style.cursor = 'pointer';

      const x = document.createElement('button');
      x.textContent = '×';
      x.className = 'fe-btn';
      x.style.marginLeft = '8px';
      x.style.padding = '2px 6px';

      span.addEventListener('click', () => {
        dd.classList.remove('show');
        openFile(entry.path);
      });

      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeRecent(entry.path);
        div.remove();
        // If no more files, show empty state
        if (dd.children.length === 0) {
          await renderRecentMenu();
        }
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
    const u = new URL('history/file', location.href);
    u.searchParams.set('path', path);
    await fetch(u, { method: 'DELETE' });
  } catch (e) {
    console.error('Failed to remove recent file:', e);
  }
}

function renderTreeRoot(treeEl) {
  treeEl.replaceChildren();
  addTreeChildren(treeEl, '.');
}

async function addTreeChildren(parentEl, rel) {
  try {
    const u = new URL('explorer/list', location.href);
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
    openFileRel(rel);
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

function openFileRel(rel) {
  if (window.appOpenFileRel) {
    window.appOpenFileRel(rel);
  } else {
    console.error('appOpenFileRel not available');
  }
}
