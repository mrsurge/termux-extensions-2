if (!window.teUI) {
  window.teUI = {};
}
if (typeof window.teUI.toast !== 'function') {
  window.teUI.toast = (msg) => console.log('[toast]', msg);
}

const STYLE_ID = 'te-file-picker-style';
const ROOT_ID = 'te-file-picker-root';

const CSS = `
.te-fp-hidden { display: none !important; }
.te-fp-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 4000;
}
.te-fp-dialog {
  width: min(520px, 92vw);
  max-height: 80vh;
  background: var(--card, #111);
  color: var(--foreground, #f5f5f5);
  border: 1px solid var(--border, #333);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
}
.te-fp-header {
  padding: 14px 18px;
  border-bottom: 1px solid var(--border, #333);
  display: flex;
  align-items: center;
  gap: 12px;
}
.te-fp-title {
  font-weight: 600;
  font-size: 1rem;
  flex: 1;
}
.te-fp-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 1.4rem;
  cursor: pointer;
}
.te-fp-body {
  padding: 8px 18px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.te-fp-breadcrumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--muted-foreground, #aaa);
}
.te-fp-crumb {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.te-fp-crumb:hover { color: var(--foreground, #fff); }
.te-fp-crumb.current {
  color: var(--foreground, #fff);
  pointer-events: none;
  font-weight: 500;
}
.te-fp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  overflow: hidden;
  flex: 1;
  min-height: 220px;
}
.te-fp-scroll {
  overflow: auto;
  max-height: 40vh;
}
.te-fp-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  background: transparent;
  font-size: 0.95rem;
}
.te-fp-item:last-child { border-bottom: none; }
.te-fp-item:hover {
  background: rgba(255,255,255,0.05);
}
.te-fp-item.selected {
  background: rgba(80, 120, 255, 0.18);
  border-left: 3px solid var(--primary, #5b8dff);
}
.te-fp-icon {
  width: 1.6rem;
  text-align: center;
  font-size: 1.2rem;
  font-family: 'Apple Color Emoji', 'Noto Color Emoji', 'Segoe UI Emoji', 'EmojiOne Color', sans-serif;
}
.te-fp-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding-top: 6px;
}
.te-fp-footer button {
  border-radius: 8px;
  border: 1px solid var(--border, #333);
  background: var(--secondary, #111);
  color: inherit;
  padding: 8px 14px;
  cursor: pointer;
}
.te-fp-footer button.primary {
  background: var(--primary, #5b8dff);
  color: var(--primary-foreground, #030712);
  border: none;
}
.te-fp-footer button:disabled {
  opacity: 0.5;
  cursor: default;
}
.te-fp-loading {
  padding: 18px;
  font-size: 0.9rem;
  color: var(--muted-foreground, #aaa);
}
`;

const TEMPLATE = `
<div id="${ROOT_ID}" class="te-fp-hidden">
  <div class="te-fp-overlay">
    <div class="te-fp-dialog">
      <div class="te-fp-header">
        <div class="te-fp-title">Select Item</div>
        <button class="te-fp-close" aria-label="Close picker">&times;</button>
      </div>
      <div class="te-fp-body">
        <div class="te-fp-breadcrumbs"></div>
        <div class="te-fp-scroll">
          <ul class="te-fp-list"></ul>
        </div>
        <div class="te-fp-footer">
          <div class="te-fp-footer-left">
            <button class="te-fp-btn-up">Up one level</button>
            <button class="te-fp-btn-current">Select current directory</button>
          </div>
          <div class="te-fp-footer-right">
            <button class="te-fp-btn-cancel">Cancel</button>
            <button class="te-fp-btn-select primary" disabled>Select</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`;

const TYPE_ICON = {
  directory: '📁',
  file: '📄',
  symlink: '🔗',
};

function ensureStyle() {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }
}

function createRoot() {
  if (document.getElementById(ROOT_ID)) return;
  const tpl = document.createElement('div');
  tpl.innerHTML = TEMPLATE;
  document.body.appendChild(tpl.firstElementChild);
}

function sanitizePath(path) {
  if (!path) return '~';
  return path;
}

function parentPath(path) {
  if (!path || path === '~') return '~';
  const normalized = path.replace(/\/+$/, '');
  const home = normalized.startsWith('~');
  const parts = normalized.split('/');
  if (home && parts.length <= 1) return '~';
  if (!home && parts.length <= 1) return '/';
  parts.pop();
  const joined = parts.join('/');
  return joined || (home ? '~' : '/');
}

function formatBreadcrumbs(path) {
  if (!path) return [{ label: '~', value: '~', current: true }];
  if (path === '~') return [{ label: 'Home', value: '~', current: true }];
  const crumbs = [];
  let working = path;
  const home = path.startsWith('~');
  if (home) {
    crumbs.push({ label: 'Home', value: '~' });
    working = path.slice(1);
  } else if (path.startsWith('/')) {
    crumbs.push({ label: '/', value: '/' });
    working = path.slice(1);
  }
  const segments = working.split('/').filter(Boolean);
  let acc = home ? '~' : path.startsWith('/') ? '' : '';
  segments.forEach((seg) => {
    if (acc && acc !== '~') acc += '/';
    acc += seg;
    crumbs.push({ label: seg || '/', value: acc });
  });
  if (crumbs.length) crumbs[crumbs.length - 1].current = true;
  else crumbs.push({ label: path, value: path, current: true });
  return crumbs;
}

async function requestBrowse(targetPath) {
  const url = `/api/browse?path=${encodeURIComponent(targetPath)}`;
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Failed to browse ${targetPath}`);
  }
  return data.data || [];
}

function createState() {
  return {
    mode: 'any',
    allowSelectCurrent: true,
    selected: null,
    entries: [],
    currentPath: '~',
    resolve: null,
    reject: null,
    title: 'Select Item',
    selectLabel: 'Select',
  };
}

const state = createState();
let initialized = false;
let elements = null;

function init() {
  if (initialized) return;
  ensureStyle();
  createRoot();
  const root = document.getElementById(ROOT_ID);
  elements = {
    root,
    overlay: root.querySelector('.te-fp-overlay'),
    title: root.querySelector('.te-fp-title'),
    close: root.querySelector('.te-fp-close'),
    breadcrumbs: root.querySelector('.te-fp-breadcrumbs'),
    list: root.querySelector('.te-fp-list'),
    btnUp: root.querySelector('.te-fp-btn-up'),
    btnCurrent: root.querySelector('.te-fp-btn-current'),
    btnCancel: root.querySelector('.te-fp-btn-cancel'),
    btnSelect: root.querySelector('.te-fp-btn-select'),
  };
  elements.close.addEventListener('click', () => cancel());
  elements.btnCancel.addEventListener('click', () => cancel());
  elements.btnUp.addEventListener('click', () => navigate(parentPath(state.currentPath)));
  elements.btnCurrent.addEventListener('click', () => {
    if (!state.allowSelectCurrent) return;
    resolveSelection({ path: state.currentPath, type: 'directory', name: state.currentPath.split('/').pop() || state.currentPath });
  });
  elements.btnSelect.addEventListener('click', () => {
    if (!state.selected) return;
    resolveSelection(state.selected);
  });
  elements.overlay.addEventListener('click', (ev) => {
    if (ev.target === elements.overlay) cancel();
  });
  initialized = true;
}

function clearSelection() {
  state.selected = null;
  const selected = elements.list.querySelector('.te-fp-item.selected');
  if (selected) selected.classList.remove('selected');
  updateButtons();
}

function updateButtons() {
  const allowCurrent = state.mode !== 'file' && state.allowSelectCurrent;
  elements.btnCurrent.disabled = !allowCurrent;
  const selectable = !!state.selected && validateSelection(state.selected);
  elements.btnSelect.disabled = !selectable;
  elements.btnSelect.textContent = state.selectLabel;
  elements.title.textContent = state.title;
}

function validateSelection(entry) {
  if (!entry) return false;
  if (state.mode === 'file') return entry.type !== 'directory';
  if (state.mode === 'directory') return entry.type === 'directory';
  return true;
}

function setSelected(entry, element) {
  state.selected = entry;
  Array.from(elements.list.children).forEach((child) => child.classList.remove('selected'));
  if (element) element.classList.add('selected');
  updateButtons();
}

function renderBreadcrumbs(path) {
  const crumbs = formatBreadcrumbs(path);
  elements.breadcrumbs.innerHTML = '';
  crumbs.forEach((crumb, idx) => {
    if (idx > 0) {
      const sep = document.createElement('span');
      sep.textContent = '/';
      sep.style.opacity = '0.6';
      elements.breadcrumbs.appendChild(sep);
    }
    const span = document.createElement('span');
    span.className = 'te-fp-crumb' + (crumb.current ? ' current' : '');
    span.textContent = crumb.label || '/';
    if (!crumb.current) {
      span.addEventListener('click', () => navigate(crumb.value));
    }
    elements.breadcrumbs.appendChild(span);
  });
}

function renderEntries(entries) {
  elements.list.innerHTML = '';
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'te-fp-loading';
    empty.textContent = 'This directory is empty.';
    elements.list.appendChild(empty);
    return;
  }
  entries.forଚ
  entries.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'te-fp-item';
    li.dataset.path = entry.path;
    li.dataset.type = entry.type;
    li.innerHTML = `
      <span class="te-fp-icon">${TYPE_ICON[entry.type] || '📄'}</span>
      <span class="te-fp-name">${entry.name || entry.path}</span>
    `;
    li.addEventListener('click', () => setSelected(entry, li));
    li.addEventListener('dblclick', () => {
      if (entry.type === 'directory') {
        navigate(entry.path);
      } else if (validateSelection(entry)) {
        resolveSelection(entry);
      }
    });
    elements.list.appendChild(li);
  });
}

async function navigate(targetPath) {
  try {
    state.currentPath = sanitizePath(targetPath);
    clearSelection();
    elements.list.innerHTML = '<div class="te-fp-loading">Loading...</div>';
    const entries = await requestBrowse(state.currentPath);
    state.entries = entries;
    renderBreadcrumbs(state.currentPath);
    renderEntries(entries);
    updateButtons();
  } catch (err) {
    window.teUI.toast(err.message || 'Failed to browse');
    updateButtons();
  }
}

function resolveSelection(payload) {
  if (state.resolve) state.resolve(payload);
  close();
}

function cancel() {
  if (state.reject) state.reject(new Error('cancelled'));
  close();
}

function close() {
  state.resolve = null;
  state.reject = null;
  state.entries = [];
  state.selected = null;
  state.currentPath = '~';
  const root = document.getElementById(ROOT_ID);
  if (root) root.classList.add('te-fp-hidden');
}

function open(options = {}) {
  init();
  close();
  state.mode = options.mode || 'any';
  state.allowSelectCurrent = options.allowSelectCurrent !== false;
  state.title = options.title || 'Select Item';
  state.selectLabel = options.selectLabel || (state.mode === 'directory' ? 'Select Folder' : 'Select');

  const root = document.getElementById(ROOT_ID);
  root.classList.remove('te-fp-hidden');

  return new Promise((resolve, reject) => {
    state.resolve = resolve;
    state.reject = reject;
    const start = sanitizePath(options.startPath || state.currentPath || '~');
    navigate(start);
  });
}

window.teFilePicker = {
  open,
  openFile: (opts = {}) => open({ ...opts, mode: 'file' }),
  openDirectory: (opts = {}) => open({ ...opts, mode: 'directory', selectLabel: opts.selectLabel || 'Select Folder' }),
};

export {};
