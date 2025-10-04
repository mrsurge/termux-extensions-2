
// app/apps/file_explorer/main.js
const API_BASE = '/api/app/file_explorer';
const HOME_DIR = '/data/data/com.termux/files/home';
let state = {
  currentPath: HOME_DIR,
  entries: [],
  view: 'list',
  selected: null
};

document.body.innerHTML = `
  <div id="fx-toolbar" class="fx-toolbar">
    <button id="fx-up">Up</button>
    <button id="fx-new">New Folder</button>
    <button id="fx-open" disabled>Open</button>
    <button id="fx-rename" disabled>Rename</button>
    <button id="fx-delete" disabled>Delete</button>
    <button id="fx-copy" disabled>Copy</button>
    <button id="fx-move" disabled>Move</button>
    <label class="fx-right">
      <input type="checkbox" id="fx-show-hidden"> Show hidden
    </label>
    <button id="fx-toggle-view" title="Toggle view">Grid View</button>
  </div>
  <div id="fx-breadcrumbs" class="fx-breadcrumbs"></div>
  <div id="fx-content" class="fx-content">
    <div id="fx-list-view" class="fx-list"></div>
    <div id="fx-grid-view" class="fx-grid" style="display:none;"></div>
  </div>
`;

// Basic styles (inline for portability)
const style = document.createElement('style');
style.textContent = `
  .fx-toolbar { display:flex; gap:.5rem; align-items:center; padding:.5rem; border-bottom:1px solid #333; }
  .fx-right { margin-left:auto; }
  .fx-breadcrumbs { padding:.5rem .75rem; font-size:.95rem; white-space:nowrap; overflow:auto; }
  .fx-crumb { cursor:pointer; }
  .fx-crumb.current { font-weight:600; cursor:default; }
  .fx-content { padding:.25rem .5rem; }
  .fx-list .fx-item { display:grid; grid-template-columns: 2rem minmax(8rem, 1fr) 10rem 16rem; gap:.5rem; padding:.35rem .25rem; border-bottom:1px solid #222; align-items:center; }
  .fx-item .fx-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fx-item.selected, .fx-tile.selected { background:#1f2937; border-radius:.35rem; }
  .fx-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap:.75rem; padding:.5rem .25rem; }
  .fx-tile { display:flex; flex-direction:column; align-items:center; gap:.25rem; padding:.5rem; border:1px solid #222; border-radius:.5rem; }
  .fx-icon { text-align:center; }
  .fx-icon-lg { font-size:2rem; }
  button:disabled { opacity:.4; cursor:not-allowed; }
`;
document.head.appendChild(style);

async function loadDirectory(path) {
  const hidden = document.getElementById('fx-show-hidden').checked ? '1' : '0';
  const res = await fetch(`${API_BASE}/list?path=${encodeURIComponent(path)}&hidden=${hidden}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load directory');
  state.currentPath = path;
  state.entries = data.data || [];
  state.selected = null;
  render();
}

function renderBreadcrumbs() {
  const termuxBase = '/data/data/com.termux';
  const bcDiv = document.getElementById('fx-breadcrumbs');
  const parts = [];
  if (state.currentPath.startsWith(termuxBase)) {
    const relative = state.currentPath.slice(termuxBase.length);
    const segs = relative.split('/').filter(Boolean);
    let accum = termuxBase;
    parts.push({ label: 'Termux', path: termuxBase });
    for (let i = 0; i < segs.length; i++) {
      accum += '/' + segs[i];
      parts.push({ label: segs[i], path: accum });
    }
  } else {
    const segs = state.currentPath.split('/').filter(Boolean);
    parts.push({ label: '⚡ /', path: '/' });
    let accum = '';
    for (let i = 0; i < segs.length; i++) {
      accum += '/' + segs[i];
      parts.push({ label: segs[i], path: accum });
    }
  }
  bcDiv.innerHTML = '';
  parts.forEach((c, idx) => {
    const el = document.createElement('span');
    el.textContent = c.label || '/';
    el.className = 'fx-crumb' + (idx === parts.length - 1 ? ' current' : '');
    if (idx !== parts.length - 1) el.onclick = () => loadDirectory(c.path);
    bcDiv.appendChild(el);
    if (idx !== parts.length - 1) bcDiv.appendChild(document.createTextNode(' / '));
  });
}

function renderEntries() {
  const list = document.getElementById('fx-list-view');
  const grid = document.getElementById('fx-grid-view');
  list.innerHTML = grid.innerHTML = '';
  const entries = [...state.entries].sort((a,b) => {
    const ad = a.type !== 'directory', bd = b.type !== 'directory';
    if (ad !== bd) return ad - bd;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  for (const entry of entries) {
    const isDir = entry.type === 'directory';
    const row = document.createElement('div');
    row.className = 'fx-item';
    row.innerHTML = `
      <span class="fx-icon">${isDir ? '📁' : '📄'}</span>
      <span class="fx-name">${entry.name}</span>
      <span class="fx-size">${formatSize(entry.size)}</span>
      <span class="fx-date">${entry.mtime ? new Date(entry.mtime*1000).toLocaleString() : ''}</span>
    `;
    const tile = document.createElement('div');
    tile.className = 'fx-tile';
    tile.innerHTML = `
      <div class="fx-icon-lg">${isDir ? '📁' : '📄'}</div>
      <div class="fx-name-tile">${entry.name}</div>
    `;
    const select = () => {
      document.querySelectorAll('.fx-item.selected, .fx-tile.selected').forEach(el => el.classList.remove('selected'));
      state.selected = entry;
      row.classList.add('selected');
      tile.classList.add('selected');
      updateActionButtons();
    };
    if (isDir) {
      row.onclick = () => loadDirectory(entry.path);
      tile.onclick = () => loadDirectory(entry.path);
    } else {
      row.onclick = select;
      tile.onclick = select;
      row.ondblclick = openSelected;
      tile.ondblclick = openSelected;
    }
    list.appendChild(row);
    grid.appendChild(tile);
  }
}

function updateActionButtons() {
  const hasSel = !!state.selected;
  document.getElementById('fx-open').disabled = !hasSel || state.selected.type !== 'file';
  document.getElementById('fx-rename').disabled = !hasSel;
  document.getElementById('fx-delete').disabled = !hasSel;
  document.getElementById('fx-copy').disabled = !hasSel;
  document.getElementById('fx-move').disabled = !hasSel;
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  const kb = bytes / 1024;
  if (kb < 1024) return kb.toFixed(1) + ' KB';
  const mb = kb / 1024;
  if (mb < 1024) return mb.toFixed(1) + ' MB';
  const gb = mb / 1024;
  return gb.toFixed(1) + ' GB';
}

async function openSelected() {
  if (!state.selected || state.selected.type !== 'file') return;
  const filePath = state.selected.path;
  window.location.href = `/app/file_editor?file=${encodeURIComponent(filePath)}`;
}
async function createNewFolder() {
  const base = state.currentPath;
  const name = (prompt('New folder name:') || '').trim();
  if (!name) return;
  const res = await fetch(`${API_BASE}/mkdir`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ path: base, name })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) return window.teUI?.toast?.(data.error || 'Failed to create folder');
  window.teUI?.toast?.(`Created folder "${name}"`);
  loadDirectory(base);
}
async function renameSelected() {
  if (!state.selected) return;
  const src = state.selected.path;
  const newName = (prompt('Rename to:', state.selected.name) || '').trim();
  if (!newName || newName === state.selected.name) return;
  const res = await fetch(`${API_BASE}/rename`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ path: src, name: newName })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) return window.teUI?.toast?.(data.error || 'Failed to rename');
  window.teUI?.toast?.(`Renamed to "${newName}"`);
  loadDirectory(state.currentPath);
}
async function deleteSelected() {
  if (!state.selected) return;
  if (!confirm(`Delete "${state.selected.name}"? This cannot be undone.`)) return;
  const res = await fetch(`${API_BASE}/delete`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ path: state.selected.path })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) return window.teUI?.toast?.(data.error || 'Failed to delete');
  window.teUI?.toast?.(`Deleted "${state.selected.name}"`);
  loadDirectory(state.currentPath);
}
async function copySelected() {
  if (!state.selected) return;
  try {
    const choice = await window.teFilePicker.openDirectory({ title: 'Copy to...', startPath: state.currentPath });
    if (!choice || !choice.path) return;
    const res = await fetch(`${API_BASE}/copy`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ source: state.selected.path, dest: choice.path })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return window.teUI?.toast?.(data.error || 'Copy failed');
    window.teUI?.toast?.(`Copied "${state.selected.name}" to ${choice.path}`);
    if (choice.path === state.currentPath) loadDirectory(state.currentPath);
  } catch (err) {
    if (err?.message) window.teUI?.toast?.(err.message);
  }
}
async function moveSelected() {
  if (!state.selected) return;
  try {
    const choice = await window.teFilePicker.openDirectory({ title: 'Move to...', startPath: state.currentPath });
    if (!choice || !choice.path) return;
    const res = await fetch(`${API_BASE}/move`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ source: state.selected.path, dest: choice.path })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return window.teUI?.toast?.(data.error || 'Move failed');
    window.teUI?.toast?.(`Moved "${state.selected.name}" to ${choice.path}`);
    loadDirectory(state.currentPath);
  } catch (err) {
    if (err?.message) window.teUI?.toast?.(err.message);
  }
}

document.getElementById('fx-up').onclick = () => {
  const p = state.currentPath;
  const parent = p === '/' ? '/' : p.replace(/\/+$/, '').replace(/\/[^\/]+$/, '') or '/';
  loadDirectory(parent or '/');
};
document.getElementById('fx-new').onclick = createNewFolder;
document.getElementById('fx-open').onclick = openSelected;
document.getElementById('fx-rename').onclick = renameSelected;
document.getElementById('fx-delete').onclick = deleteSelected;
document.getElementById('fx-copy').onclick = copySelected;
document.getElementById('fx-move').onclick = moveSelected;
document.getElementById('fx-show-hidden').onchange = () => loadDirectory(state.currentPath);
document.getElementById('fx-toggle-view').onclick = () => {
  state.view = (state.view === 'list' ? 'grid' : 'list');
  document.getElementById('fx-list-view').style.display = (state.view === 'list' ? '' : 'none');
  document.getElementById('fx-grid-view').style.display = (state.view === 'grid' ? '' : 'none');
  document.getElementById('fx-toggle-view').textContent = state.view === 'list' ? 'Grid View' : 'List View';
};

function render() {
  renderBreadcrumbs();
  renderEntries();
  updateActionButtons();
}

// kick off
loadDirectory(state.currentPath).catch(err => {
  (window.teUI && window.teUI.toast) ? window.teUI.toast(err.message || 'Error loading') : console.error(err);
});
