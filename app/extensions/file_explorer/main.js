// Extension Script: File Explorer

export default function initialize(extensionContainer, api) {
  const listEl = extensionContainer.querySelector('#fe-list');
  const pathEl = extensionContainer.querySelector('#fe-path');
  const absPathEl = extensionContainer.querySelector('#fe-abs-path');
  const containerEl = extensionContainer.querySelector('#file-explorer-container');
  const upBtn = extensionContainer.querySelector('#fe-up-btn');
  const homeBtn = extensionContainer.querySelector('#fe-home-btn');
  const refreshBtn = extensionContainer.querySelector('#fe-refresh-btn');
  const newFolderBtn = extensionContainer.querySelector('#fe-new-folder-btn');
  const toggleHiddenEl = extensionContainer.querySelector('#fe-toggle-hidden');
  const sortKeyEl = extensionContainer.querySelector('#fe-sort-key');
  const sortDirBtn = extensionContainer.querySelector('#fe-sort-dir-btn');
  const selectToggleBtn = extensionContainer.querySelector('#fe-select-toggle-btn');
  const selectionBar = extensionContainer.querySelector('#fe-selection-bar');
  const selCountEl = extensionContainer.querySelector('#fe-selected-count');
  const batchDeleteBtn = extensionContainer.querySelector('#fe-batch-delete-btn');
  const batchChmodBtn = extensionContainer.querySelector('#fe-batch-chmod-btn');
  const batchCopyBtn = extensionContainer.querySelector('#fe-batch-copy-btn');
  const contextMenu = extensionContainer.querySelector('#fe-context-menu');
  if (contextMenu && containerEl && contextMenu.parentElement !== containerEl) {
    containerEl.appendChild(contextMenu);
  }

  let homePath = null;
  let currentPath = null;
  let loading = false;
  let showHidden = false;
  let detailedView = false;
  let sortKey = 'name';
  let sortAsc = true;
  let selectMode = false;
  const selection = new Set();

  const iconFor = (type) => (type === 'directory' ? '📁' : '📄');

  const shQuote = (s) => "'" + String(s).replace(/'/g, "'\"'\"'") + "'"; // robust single-quote escaping

  const normalizePath = (p) => {
    if (!p) return p;
    // remove trailing slashes except for root
    return p.length > 1 ? p.replace(/\/+$/g, '') : p;
  };

  const isUnderHome = (p) => {
    if (!homePath || !p) return false;
    const hp = normalizePath(homePath);
    const pp = normalizePath(p);
    return pp === hp || pp.startsWith(hp + '/');
  };

  const parentPath = (p) => {
    if (!p) return null;
    const pp = normalizePath(p);
    if (pp === normalizePath(homePath)) return homePath;
    const idx = pp.lastIndexOf('/');
    const parent = idx > 0 ? pp.slice(0, idx) : '/';
    return isUnderHome(parent) ? parent : homePath;
  };

  const setLoading = (v) => {
    loading = v;
    if (v) {
      listEl.innerHTML = '<div class="file-item" style="cursor: default;"><span class="icon">⏳</span> Loading...</div>';
    }
  };

  const renderBreadcrumbs = (path) => {
    const hp = normalizePath(homePath);
    const pp = normalizePath(path);
    // Build crumbs relative to home
    let crumbsHtml = '';
    const makeCrumb = (label, targetPath, inactive = false) => {
      const cls = inactive ? 'fe-crumb inactive' : 'fe-crumb';
      return `<span class="${cls}" data-target="${inactive ? '' : targetPath}">${label}</span>`;
    };

    crumbsHtml += makeCrumb('Home', hp, pp === hp);
    if (pp && pp !== hp && pp.startsWith(hp + '/')) {
      const rel = pp.slice(hp.length + 1); // drop trailing '/'
      const parts = rel.split('/').filter(Boolean);
      let acc = hp;
      parts.forEach((seg, i) => {
        crumbsHtml += '<span class="fe-crumb sep">/</span>';
        acc = acc + '/' + seg;
        const inactive = i === parts.length - 1;
        crumbsHtml += makeCrumb(seg, acc, inactive);
      });
    }
    pathEl.innerHTML = `<div class="fe-breadcrumbs">${crumbsHtml || (pp || '~')}</div>`;

    // Attach handlers
    pathEl.querySelectorAll('.fe-crumb').forEach(el => {
      const target = el.getAttribute('data-target');
      if (!target) return;
      el.addEventListener('click', () => browse(target));
    });

    if (absPathEl) {
      absPathEl.textContent = pp || '';
    }
  };

  async function ensureHome() {
    if (homePath) return homePath;
    try {
      const data = await window.teFetch('/api/run_command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo -n ~' })
      });
      homePath = normalizePath((data.stdout || '').trim());
      return homePath;
    } catch (e) {
      // Fallback: if unable to detect, treat null as meaning no Up from root
      homePath = null;
      return null;
    }
  }

  async function browse(path) {
    await ensureHome();
    setLoading(true);
    try {
      const target = normalizePath(path || homePath);
      const url = target ? `/api/browse?path=${encodeURIComponent(target)}` : '/api/browse';
      let items = await window.teFetch(url);
      if (showHidden) {
        const hidden = await listHidden(target || homePath);
        items = items.concat(hidden);
      }
      if (sortKey === 'size' || detailedView) {
        const metaMap = await fetchMetaForDir(target || homePath);
        items = items.map(it => ({ ...it, ...lookupMeta(metaMap, it.path) }));
      }
      items = sortItems(items);
      currentPath = target || homePath;
      renderBreadcrumbs(currentPath || '~');
      renderList(items || []);
    } catch (e) {
      window.teUI.toast(`Browse failed: ${e.message || e}`);
      // Keep previous list if exists
    } finally {
      setLoading(false);
    }
  }

  function sortItems(items) {
    const dirFirst = (a, b) => (a.type === b.type ? 0 : a.type === 'directory' ? -1 : 1);
    const keyCmp = (a, b) => {
      const va = (a[sortKey] || '').toLowerCase();
      const vb = (b[sortKey] || '').toLowerCase();
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    };
    const cmp = (a, b) => {
      const d = dirFirst(a, b);
      if (d !== 0) return d;
      if (sortKey === 'size') {
        if (a.type === 'file' && b.type === 'file') {
          const sa = typeof a.size === 'number' ? a.size : 0;
          const sb = typeof b.size === 'number' ? b.size : 0;
          return (sa - sb) * (sortAsc ? 1 : -1);
        }
        // Keep directories grouped; order them by name
        return (a.name || '').localeCompare(b.name || '') * (sortAsc ? 1 : -1);
      }
      return keyCmp(a, b) * (sortAsc ? 1 : -1);
    };
    return [...items].sort(cmp);
  }

  async function fetchMetaForDir(dirPath) {
    const result = {};
    if (!dirPath) return result;
    try {
      const cmd = `find ${shQuote(dirPath)} -mindepth 1 -maxdepth 1 -printf '%p|%s|%M|%T@\\n'`;
      const data = await window.teFetch('/api/run_command', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd })
      });
      const lines = (data.stdout || '').split('\n').filter(Boolean);
      lines.forEach(line => {
        const last1 = line.lastIndexOf('|');
        const last2 = line.lastIndexOf('|', last1 - 1);
        const last3 = line.lastIndexOf('|', last2 - 1);
        if (last3 < 0 || last2 < 0 || last1 < 0) return;
        const p = line.slice(0, last3);
        const sStr = line.slice(last3 + 1, last2);
        const perm = line.slice(last2 + 1, last1);
        const mtStr = line.slice(last1 + 1);
        const s = parseInt(sStr, 10);
        const mt = Math.round(parseFloat(mtStr));
        const meta = { size: isNaN(s) ? undefined : s, perm, mtime: isNaN(mt) ? undefined : mt };
        result[p] = meta;
        // also index with trailing slash for directories (best-effort)
        if (!p.endsWith('/')) result[p + '/'] = meta;
      });
    } catch (e) {
      // ignore; metadata remains undefined
    }
    return result;
  }

  function lookupMeta(metaMap, path) {
    return metaMap[path] || metaMap[(path || '').replace(/\/+$/,'')] || metaMap[(path || '') + '/'] || {};
  }

  function humanSize(bytes) {
    if (typeof bytes !== 'number' || isNaN(bytes)) return '-';
    const thresh = 1024;
    if (Math.abs(bytes) < thresh) return bytes + ' B';
    const units = ['KB','MB','GB','TB','PB','EB','ZB','YB'];
    let u = -1;
    do { bytes /= thresh; ++u; } while (Math.abs(bytes) >= thresh && u < units.length - 1);
    return bytes.toFixed(bytes < 10 ? 1 : 0) + ' ' + units[u];
  }

  function formatDate(epochSec) {
    if (typeof epochSec !== 'number' || isNaN(epochSec)) return '';
    const d = new Date(epochSec * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function listHidden(path) {
    if (!path) return [];
    try {
      const cmd = `dir=${shQuote(path)}; for i in "$dir"/.*; do [ "$i" = "$dir/." ] && continue; [ "$i" = "$dir/.." ] && continue; [ -e "$i" ] || continue; if [ -d "$i" ]; then echo d:"$i"; elif [ -f "$i" ]; then echo f:"$i"; else echo o:"$i"; fi; done`;
      const data = await window.teFetch('/api/run_command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
      });
      const lines = (data.stdout || '').split('\n').filter(Boolean);
      return lines.map(l => {
        const idx = l.indexOf(':');
        if (idx === -1) return null;
        const t = l.slice(0, idx);
        const p = l.slice(idx + 1);
        const name = p.split('/').pop();
        return { name, type: t === 'd' ? 'directory' : 'file', path: p };
      }).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function renderList(items) {
    listEl.innerHTML = '';

    // Optional Up link in list
    if (currentPath && homePath && normalizePath(currentPath) !== normalizePath(homePath)) {
      const upRow = document.createElement('div');
      upRow.className = 'file-item';
      upRow.innerHTML = '<span class="icon">↩️</span> ..';
      upRow.addEventListener('click', () => browse(parentPath(currentPath)));
      listEl.appendChild(upRow);
    }

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'file-item';

      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = iconFor(item.type);
      const name = document.createElement('span');
      name.className = 'fe-name';
      name.textContent = item.name;

      const textWrap = document.createElement('span');
      textWrap.style.display = 'flex';
      textWrap.style.flexDirection = 'column';
      textWrap.style.gap = '2px';
      textWrap.style.flex = '1 1 auto';
      textWrap.style.minWidth = '0';
      textWrap.appendChild(name);

      if (detailedView) {
        const detailsLine = document.createElement('span');
        detailsLine.className = 'fe-details-line';
        const perms = item.perm || '';
        const sizeStr = item.type === 'file' ? humanSize(item.size) : '-';
        const mstr = formatDate(item.mtime);
        detailsLine.textContent = `${perms} • ${sizeStr} • ${mstr}`;
        textWrap.appendChild(detailsLine);
      }

      row.appendChild(icon);
      row.appendChild(textWrap);
      const right = document.createElement('span');
      right.className = 'fe-row-right';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'fe-row-check';
      checkbox.style.display = selectMode ? 'inline-block' : 'none';
      checkbox.checked = selection.has(item.path);
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSelection(item.path);
        checkbox.checked = selection.has(item.path);
      });
      right.appendChild(checkbox);

      // no inline chmod button; use the row menu instead

      const menuBtn = document.createElement('button');
      menuBtn.className = 'fe-row-menu-btn';
      menuBtn.textContent = '⋮';
      menuBtn.title = 'Actions';
      menuBtn.addEventListener('click', (e) => { e.stopPropagation(); openContextMenu(e, item); });
      right.appendChild(menuBtn);

      row.appendChild(right);

      if (item.type === 'directory') {
        row.addEventListener('click', () => {
          if (selectMode) {
            toggleSelection(item.path);
            checkbox.checked = selection.has(item.path);
          } else {
            browse(item.path);
          }
        });
      } else {
        row.addEventListener('click', () => {
          if (selectMode) {
            toggleSelection(item.path);
            checkbox.checked = selection.has(item.path);
          }
        });
      }

      let pressTimer = null;
      const startPress = (e) => { if (pressTimer) return; pressTimer = setTimeout(() => openContextMenu(e, item), 500); };
      const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
      row.addEventListener('touchstart', startPress);
      row.addEventListener('touchend', clearPress);
      row.addEventListener('mousedown', startPress);
      row.addEventListener('mouseup', clearPress);
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); openContextMenu(e, item); });

      listEl.appendChild(row);
    });
  }

  function openContextMenu(e, item) {
    const pointX = e.clientX || (e.touches && e.touches[0]?.clientX) || 0;
    const pointY = e.clientY || (e.touches && e.touches[0]?.clientY) || 0;
    const contRect = (containerEl || extensionContainer).getBoundingClientRect();
    // initial position relative to container
    let left = Math.max(0, pointX - contRect.left);
    let top = Math.max(0, pointY - contRect.top);
    contextMenu.innerHTML = '';
    contextMenu.style.left = '0px';
    contextMenu.style.top = '0px';

    const add = (label, handler) => {
      const btn = document.createElement('button');
      btn.className = 'item';
      btn.textContent = label;
      btn.addEventListener('click', async (ev) => { ev.stopPropagation(); hideContextMenu(); await handler(); });
      contextMenu.appendChild(btn);
    };
    if (item.type === 'directory') add('Open', () => browse(item.path));
    add('Rename', () => doRename(item));
    add('Copy path', () => copyPaths([item.path]));
    add('Make executable (chmod +x)', () => doChmod([item.path]));
    add('Delete', () => doDelete([item.path]));

    contextMenu.style.display = 'block';
    // After visible, measure and clamp within container
    const menuRect = contextMenu.getBoundingClientRect();
    const maxLeft = Math.max(0, contRect.width - menuRect.width - 8);
    const maxTop = Math.max(0, contRect.height - menuRect.height - 8);
    if (left > maxLeft) left = maxLeft;
    if (top > maxTop) top = maxTop;
    contextMenu.style.left = left + 'px';
    contextMenu.style.top = top + 'px';
    setTimeout(() => { document.addEventListener('click', hideContextMenu, { once: true }); }, 0);
  }

  function hideContextMenu() { contextMenu.style.display = 'none'; }

  function updateSelectionBar() {
    const count = selection.size;
    selCountEl.textContent = `${count} selected`;
    selectionBar.style.display = count > 0 ? 'flex' : 'none';
  }

  function toggleSelection(path) { if (selection.has(path)) selection.delete(path); else selection.add(path); updateSelectionBar(); }

  async function doDelete(paths) {
    const safe = paths.filter(p => isUnderHome(p));
    if (!safe.length) return;
    const msg = safe.length === 1 ? `Delete \n${safe[0]}?` : `Delete ${safe.length} items?`;
    if (!confirm(msg)) return;
    const list = safe.map(shQuote).join(' ');
    const cmd = `for p in ${list}; do if [ -d "$p" ]; then rm -rf "$p"; else rm -f "$p"; fi; done`;
    try {
      await window.teFetch('/api/run_command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) });
      safe.forEach(p => selection.delete(p));
      updateSelectionBar();
      window.teUI.toast('Deleted');
      await browse(currentPath);
    } catch (e) { window.teUI.toast(`Delete failed: ${e.message || e}`); }
  }

  async function doChmod(paths) {
    const safe = paths.filter(p => isUnderHome(p));
    if (!safe.length) return;
    const list = safe.map(shQuote).join(' ');
    const cmd = `chmod +x ${list}`;
    try { await window.teFetch('/api/run_command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) }); window.teUI.toast('chmod +x done'); }
    catch (e) { window.teUI.toast(`chmod failed: ${e.message || e}`); }
  }

  async function doRename(item) {
    const oldPath = item.path;
    const base = oldPath.split('/').pop();
    const dir = oldPath.slice(0, oldPath.length - base.length).replace(/\/$/, '');
    const name = prompt('New name', base);
    if (!name) return;
    if (/\//.test(name)) { window.teUI.toast('Name cannot contain /'); return; }
    const newPath = (dir ? dir : '/') + '/' + name;
    if (!isUnderHome(newPath) || !isUnderHome(oldPath)) { window.teUI.toast('Access denied'); return; }
    const cmd = `mv ${shQuote(oldPath)} ${shQuote(newPath)}`;
    try { await window.teFetch('/api/run_command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) }); window.teUI.toast('Renamed'); await browse(currentPath); }
    catch (e) { window.teUI.toast(`Rename failed: ${e.message || e}`); }
  }

  async function doMkdir() {
    const name = prompt('New folder name');
    if (!name) return;
    if (/\//.test(name)) { window.teUI.toast('Name cannot contain /'); return; }
    const target = (currentPath || homePath) + '/' + name;
    if (!isUnderHome(target)) { window.teUI.toast('Access denied'); return; }
    const cmd = `mkdir -p ${shQuote(target)}`;
    try { await window.teFetch('/api/run_command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) }); window.teUI.toast('Folder created'); await browse(currentPath); }
    catch (e) { window.teUI.toast(`Create folder failed: ${e.message || e}`); }
  }

  async function copyPaths(paths) {
    try {
      const text = paths.join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); window.teUI.toast('Copied to clipboard'); }
      else { window.teUI.toast(text); }
    } catch (e) { window.teUI.toast('Copy failed'); }
  }

  // Toolbar handlers
  upBtn?.addEventListener('click', () => {
    if (!currentPath) return;
    const parent = parentPath(currentPath);
    if (parent) browse(parent);
  });
  homeBtn?.addEventListener('click', async () => browse(homePath || (await ensureHome())));
  refreshBtn?.addEventListener('click', () => browse(currentPath || homePath));
  newFolderBtn?.addEventListener('click', () => doMkdir());
  toggleHiddenEl?.addEventListener('change', (e) => { showHidden = !!e.target.checked; browse(currentPath || homePath); });
  sortKeyEl?.addEventListener('change', (e) => { sortKey = e.target.value; browse(currentPath || homePath); });
  extensionContainer.querySelector('#fe-toggle-details')?.addEventListener('change', (e) => { detailedView = !!e.target.checked; browse(currentPath || homePath); });
  sortDirBtn?.addEventListener('click', () => { sortAsc = !sortAsc; sortDirBtn.textContent = sortAsc ? 'A→Z' : 'Z→A'; browse(currentPath || homePath); });
  selectToggleBtn?.addEventListener('click', () => { selectMode = !selectMode; selectToggleBtn.textContent = selectMode ? 'Cancel' : 'Select'; if (!selectMode) { selection.clear(); updateSelectionBar(); } browse(currentPath || homePath); });
  batchDeleteBtn?.addEventListener('click', () => doDelete(Array.from(selection)));
  batchChmodBtn?.addEventListener('click', () => doChmod(Array.from(selection)));
  batchCopyBtn?.addEventListener('click', () => copyPaths(Array.from(selection)));

  // Initial load
  browse(null);
}
