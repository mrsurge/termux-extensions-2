if (!window.teUI) {
  window.teUI = {};
}
if (typeof window.teUI.toast !== 'function') {
  window.teUI.toast = (msg) => console.log('[toast]', msg);
}

const STYLE_ID = 'te-file-picker-style';
const ROOT_ID = 'te-file-picker-root';
const HOME_DIR = '/data/data/com.termux/files/home';
const DEFAULT_START = HOME_DIR;

const START_STORAGE_KEY = 'te.filepicker.startPaths';

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
  width: min(540px, 92vw);
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
.te-fp-home {
  background: none;
  border: none;
  color: inherit;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0 4px;
}
.te-fp-home:focus-visible,
.te-fp-close:focus-visible,
.te-fp-btn-up:focus-visible,
.te-fp-btn-current:focus-visible,
.te-fp-btn-cancel:focus-visible,
.te-fp-btn-select:focus-visible {
  outline: 2px solid var(--primary, #5b8dff);
  outline-offset: 2px;
}
.te-fp-body {
  padding: 8px 18px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.te-fp-path {
  font-family: 'JetBrains Mono', Consolas, 'Roboto Mono', monospace;
  font-size: 0.82rem;
  color: var(--muted-foreground, #94a3b8);
  word-break: break-all;
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
.te-fp-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.85rem;
  color: var(--muted-foreground, #aaa);
}
.te-fp-toggle-hidden {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.te-fp-toggle-hidden input {
  accent-color: var(--primary, #5b8dff);
}
.te-fp-save-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.te-fp-save-row label {
  font-size: 0.8rem;
  color: var(--muted-foreground, #aaa);
}
.te-fp-input {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border, #333);
  background: var(--secondary, #111);
  color: inherit;
  font-size: 0.95rem;
}
.te-fp-scroll {
  overflow: auto;
  max-height: 40vh;
}
.te-fp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  overflow: hidden;
  min-height: 220px;
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
        <button class="te-fp-home" aria-label="Go to home directory" title="Home">🏠</button>
        <div class="te-fp-title">Select Item</div>
        <button class="te-fp-close" aria-label="Close picker">&times;</button>
      </div>
      <div class="te-fp-body">
        <div class="te-fp-path"></div>
        <div class="te-fp-breadcrumbs"></div>
        <div class="te-fp-options">
          <label class="te-fp-toggle-hidden">
            <input type="checkbox" class="te-fp-hidden-checkbox" />
            <span>Show hidden files</span>
          </label>
        </div>
        <div class="te-fp-save-row te-fp-hidden">
          <label for="te-fp-input-name">File name</label>
          <input id="te-fp-input-name" type="text" class="te-fp-input te-fp-input-name" placeholder="example.txt" />
        </div>
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

let startStorage = null;

function ensureStartStorage() {
  if (startStorage) return startStorage;
  try {
    const raw = localStorage.getItem(START_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        startStorage = parsed;
        return startStorage;
      }
    }
  } catch (_) {
    /* ignore */
  }
  startStorage = {};
  return startStorage;
}

function persistStartStorage() {
  try {
    localStorage.setItem(START_STORAGE_KEY, JSON.stringify(startStorage));
  } catch (_) {
    /* ignore */
  }
}

function storageKeyForMode(mode) {
  switch (mode) {
    case 'save':
      return 'save';
    case 'directory':
      return 'directory';
    default:
      return 'open';
  }
}

function getStoredStart(modeKey) {
  if (!modeKey) return null;
  const cache = ensureStartStorage();
  const value = cache[modeKey];
  return typeof value === 'string' && value.trim() ? simplifyAbsolute(value) : null;
}

function setStoredStart(modeKey, path) {
  if (!modeKey) return;
  const normalized = simplifyAbsolute(path || '');
  if (!normalized || normalized === '/') {
    ensureStartStorage();
    startStorage[modeKey] = '/';
  } else {
    ensureStartStorage();
    startStorage[modeKey] = normalized;
  }
  persistStartStorage();
}

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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function simplifyAbsolute(path) {
  if (!path) return '/';
  const segments = [];
  const parts = String(path).split('/');
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (segments.length) segments.pop();
      continue;
    }
    segments.push(part);
  }
  return '/' + segments.join('/');
}

function toAbsolute(path, base = DEFAULT_START) {
  if (!path) return simplifyAbsolute(base);
  let value = String(path).trim();
  if (!value) return simplifyAbsolute(base);
  if (value === '~') return HOME_DIR;
  if (value.startsWith('~/')) return simplifyAbsolute(HOME_DIR + '/' + value.slice(2));
  if (value.startsWith('/')) return simplifyAbsolute(value);
  const origin = base || DEFAULT_START;
  return simplifyAbsolute(origin.replace(/\/+$/, '') + '/' + value);
}

function toDisplayPath(absPath) {
  const normalized = simplifyAbsolute(absPath || DEFAULT_START);
  if (normalized === HOME_DIR) return '~';
  if (normalized.startsWith(HOME_DIR + '/')) {
    return '~/' + normalized.slice(HOME_DIR.length + 1);
  }
  return normalized;
}

function parentPath(path) {
  const abs = simplifyAbsolute(path || DEFAULT_START);
  if (abs === '/' || abs === '') return '/';
  if (abs === HOME_DIR) return '/';
  const trimmed = abs.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '/';
  const parent = trimmed.slice(0, idx);
  return parent || '/';
}

function joinPath(dir, name) {
  const base = simplifyAbsolute(dir || DEFAULT_START);
  const cleanName = String(name || '').trim();
  if (!cleanName) return base;
  return simplifyAbsolute((base === '/' ? '' : base) + '/' + cleanName);
}

function basenameFromPath(path) {
  const abs = simplifyAbsolute(path || DEFAULT_START);
  if (abs === '/') return '/';
  const parts = abs.split('/');
  return parts[parts.length - 1] || '/';
}

function formatBreadcrumbs(path) {
  const abs = simplifyAbsolute(path || DEFAULT_START);
  const crumbs = [];
  if (abs === HOME_DIR) {
    crumbs.push({ label: 'Home', value: HOME_DIR, current: true });
    return crumbs;
  }
  if (abs.startsWith(HOME_DIR + '/')) {
    crumbs.push({ label: 'Home', value: HOME_DIR, current: false });
    const remainder = abs.slice(HOME_DIR.length + 1);
    const segments = remainder.split('/').filter(Boolean);
    let acc = HOME_DIR;
    segments.forEach((seg, idx) => {
      acc = simplifyAbsolute(acc + '/' + seg);
      crumbs.push({ label: seg || '/', value: acc, current: idx === segments.length - 1 });
    });
    if (segments.length === 0) crumbs[0].current = true;
    return crumbs;
  }
  if (abs === '/' || abs === '') {
    crumbs.push({ label: '/', value: '/', current: true });
    return crumbs;
  }
  crumbs.push({ label: '/', value: '/', current: false });
  const remainder = abs.slice(1);
  const segments = remainder.split('/').filter(Boolean);
  let acc = '';
  segments.forEach((seg, idx) => {
    acc += '/' + seg;
    crumbs.push({ label: seg || '/', value: acc || '/', current: idx === segments.length - 1 });
  });
  if (segments.length === 0) crumbs[0].current = true;
  return crumbs;
}

function sortEntries(entries) {
  return entries.slice().sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    const aName = (a.name || basenameFromPath(a.path || '')).toLowerCase();
    const bName = (b.name || basenameFromPath(b.path || '')).toLowerCase();
    return aName.localeCompare(bName);
  });
}

const state = {
  mode: 'any',
  allowSelectCurrent: true,
  selected: null,
  entries: [],
  currentPath: DEFAULT_START,
  resolve: null,
  reject: null,
  title: 'Select Item',
  selectLabel: 'Select',
  filename: '',
  persistKey: null,
};

const prefs = {
  showHidden: false,
  lastPath: DEFAULT_START,
};

let initialized = false;
let elements = null;

function resetState() {
  state.mode = 'any';
  state.allowSelectCurrent = true;
  state.selected = null;
  state.entries = [];
  state.currentPath = DEFAULT_START;
  state.resolve = null;
  state.reject = null;
  state.title = 'Select Item';
  state.selectLabel = 'Select';
  state.filename = '';
  state.persistKey = null;
}

function updateButtons() {
  const isSave = state.mode === 'save';
  const allowCurrent = !isSave && state.allowSelectCurrent;
  elements.btnCurrent.classList.toggle('te-fp-hidden', !allowCurrent);
  elements.btnCurrent.disabled = !allowCurrent;
  if (isSave) {
    const hasName = !!(state.filename && state.filename.trim());
    elements.btnSelect.disabled = !hasName;
  } else {
    const selectable = !!state.selected && validateSelection(state.selected);
    elements.btnSelect.disabled = !selectable;
  }
  elements.btnSelect.textContent = state.selectLabel;
  elements.title.textContent = state.title;
  if (elements.hiddenToggle) {
    elements.hiddenToggle.checked = !!prefs.showHidden;
  }
  if (elements.btnUp) {
    elements.btnUp.disabled = state.currentPath === '/' || state.currentPath === '';
  }
}

function clearSelection() {
  state.selected = null;
  const selected = elements.list.querySelector('.te-fp-item.selected');
  if (selected) selected.classList.remove('selected');
  updateButtons();
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

function setFilename(name) {
  state.filename = name || '';
  if (elements.filenameInput) elements.filenameInput.value = state.filename;
  updateButtons();
}

function updatePathIndicator(path) {
  if (!elements || !elements.path) return;
  const abs = simplifyAbsolute(path || DEFAULT_START);
  elements.path.textContent = abs;
  elements.path.title = abs;
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
      span.addEventListener('click', () => {
        navigate(crumb.value);
      });
    }
    elements.breadcrumbs.appendChild(span);
  });
  updatePathIndicator(path);
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
  entries.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'te-fp-item';
    li.dataset.path = entry.path;
    li.dataset.type = entry.type;
    const name = entry.name || basenameFromPath(entry.path || '');
    li.innerHTML = `
      <span class="te-fp-icon">${TYPE_ICON[entry.type] || '📄'}</span>
      <span class="te-fp-name">${escapeHtml(name)}</span>
    `;
    li.addEventListener('click', () => {
      if (entry.type === 'directory') {
        navigate(entry.path);
        return;
      }
      setSelected(entry, li);
      if (state.mode === 'save') {
        setFilename(name);
      }
    });
    elements.list.appendChild(li);
  });
}

async function requestBrowse(absPath, includeHidden) {
  const params = new URLSearchParams({
    path: absPath,
    hidden: includeHidden ? '1' : '0',
    root: 'system',
  });
  const response = await fetch(`/api/browse?${params.toString()}`, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Failed to browse ${absPath}`);
  }
  const items = Array.isArray(data.data) ? data.data : [];
  return items.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    return {
      ...entry,
      path: simplifyAbsolute(entry.path || ''),
    };
  });
}

async function navigate(targetPath) {
  const normalized = toAbsolute(targetPath, state.currentPath || prefs.lastPath || DEFAULT_START);
  updatePathIndicator(normalized);
  const previousPath = state.currentPath;
  try {
    state.currentPath = normalized;
    clearSelection();
    elements.list.innerHTML = '<div class="te-fp-loading">Loading...</div>';
    const entries = await requestBrowse(normalized, prefs.showHidden);
    const sorted = sortEntries(entries);
    state.entries = sorted;
    prefs.lastPath = normalized;
    if (state.persistKey) setStoredStart(state.persistKey, normalized);
    renderBreadcrumbs(normalized);
    renderEntries(sorted);
    updateButtons();
  } catch (err) {
    const message = err?.message || 'Failed to browse';
    elements.list.innerHTML = `<div class="te-fp-loading" style="color:#f87171;">${escapeHtml(message)}</div>`;
    window.teUI.toast(message);
    state.currentPath = previousPath || DEFAULT_START;
    updatePathIndicator(state.currentPath);
    renderBreadcrumbs(state.currentPath);
    updateButtons();
  }
}

function finish(payload) {
  const result = payload && typeof payload === 'object'
    ? { ...payload, path: simplifyAbsolute(payload.path), showHidden: prefs.showHidden }
    : payload;
  if (state.resolve) state.resolve(result);
  close();
}

function attemptSave() {
  if (state.mode !== 'save') return;
  const name = (state.filename || '').trim();
  if (!name) {
    window.teUI.toast('Enter a file name');
    if (elements.filenameInput) elements.filenameInput.focus();
    return;
  }
  const path = joinPath(state.currentPath, name);
  const existed = (state.entries || []).some((entry) => entry.type !== 'directory' && simplifyAbsolute(entry.path) === path);
  finish({ path, type: 'file', name, directory: state.currentPath, existed });
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
  state.currentPath = DEFAULT_START;
  state.filename = '';
  if (elements) {
    elements.list.innerHTML = '';
    if (elements.saveRow) elements.saveRow.classList.add('te-fp-hidden');
    if (elements.filenameInput) elements.filenameInput.value = '';
  }
  const rootEl = document.getElementById(ROOT_ID);
  if (rootEl) rootEl.classList.add('te-fp-hidden');
  resetState();
}

function init() {
  if (initialized) return;
  ensureStyle();
  createRoot();
  const rootEl = document.getElementById(ROOT_ID);
  elements = {
    root: rootEl,
    overlay: rootEl.querySelector('.te-fp-overlay'),
    title: rootEl.querySelector('.te-fp-title'),
    close: rootEl.querySelector('.te-fp-close'),
    home: rootEl.querySelector('.te-fp-home'),
    path: rootEl.querySelector('.te-fp-path'),
    breadcrumbs: rootEl.querySelector('.te-fp-breadcrumbs'),
    hiddenToggle: rootEl.querySelector('.te-fp-hidden-checkbox'),
    saveRow: rootEl.querySelector('.te-fp-save-row'),
    filenameInput: rootEl.querySelector('.te-fp-input-name'),
    list: rootEl.querySelector('.te-fp-list'),
    btnUp: rootEl.querySelector('.te-fp-btn-up'),
    btnCurrent: rootEl.querySelector('.te-fp-btn-current'),
    btnCancel: rootEl.querySelector('.te-fp-btn-cancel'),
    btnSelect: rootEl.querySelector('.te-fp-btn-select'),
  };
  elements.close.addEventListener('click', cancel);
  if (elements.home) {
    elements.home.addEventListener('click', () => navigate(HOME_DIR));
  }
  elements.btnCancel.addEventListener('click', cancel);
  elements.btnUp.addEventListener('click', () => navigate(parentPath(state.currentPath)));
  elements.btnCurrent.addEventListener('click', () => {
    const name = basenameFromPath(state.currentPath);
    finish({ path: state.currentPath, type: 'directory', name: name || state.currentPath });
  });
  elements.btnSelect.addEventListener('click', () => {
    if (state.mode === 'save') {
      attemptSave();
    } else if (state.selected && validateSelection(state.selected)) {
      finish(state.selected);
    }
  });
  elements.overlay.addEventListener('click', (ev) => {
    if (ev.target === elements.overlay) cancel();
  });
  if (elements.hiddenToggle) {
    elements.hiddenToggle.addEventListener('change', () => {
      prefs.showHidden = !!elements.hiddenToggle.checked;
      navigate(state.currentPath);
    });
  }
  if (elements.filenameInput) {
    elements.filenameInput.addEventListener('input', (ev) => {
      setFilename(ev.target.value || '');
    });
    elements.filenameInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        attemptSave();
      }
    });
  }
  initialized = true;
}

function open(options = {}) {
  init();
  close();
  resetState();

  const mode = (options.mode || 'any').toLowerCase();
  state.mode = mode === 'save' ? 'save' : mode;
  state.persistKey = storageKeyForMode(state.mode);
  if (state.mode === 'save') {
    state.allowSelectCurrent = false;
  } else if (typeof options.allowSelectCurrent === 'boolean') {
    state.allowSelectCurrent = options.allowSelectCurrent;
  } else {
    state.allowSelectCurrent = state.mode !== 'file';
  }

  state.title = options.title || (state.mode === 'save' ? 'Save File' : 'Select Item');
  if (options.selectLabel) {
    state.selectLabel = options.selectLabel;
  } else if (state.mode === 'directory') {
    state.selectLabel = 'Select Folder';
  } else if (state.mode === 'save') {
    state.selectLabel = 'Save';
  } else {
    state.selectLabel = 'Select';
  }

  state.filename = options.filename || '';
  if (typeof options.showHidden === 'boolean') {
    prefs.showHidden = !!options.showHidden;
  }
  if (elements.saveRow) {
    elements.saveRow.classList.toggle('te-fp-hidden', state.mode !== 'save');
  }
  if (elements.filenameInput && state.mode === 'save') {
    elements.filenameInput.value = state.filename;
  }

  updateButtons();

  const rootEl = document.getElementById(ROOT_ID);
  rootEl.classList.remove('te-fp-hidden');

  return new Promise((resolve, reject) => {
    state.resolve = resolve;
    state.reject = reject;
    const stored = getStoredStart(state.persistKey);
    const fallbackBase = prefs.lastPath || stored || DEFAULT_START;
    const start = toAbsolute(options.startPath, fallbackBase);
    prefs.lastPath = start;
    state.currentPath = start;
    if (state.persistKey) setStoredStart(state.persistKey, start);
    updatePathIndicator(start);
    updateButtons();
    navigate(start);
    if (state.mode === 'save' && elements.filenameInput) {
      setTimeout(() => elements.filenameInput.focus(), 0);
    }
  });
}

window.teFilePicker = {
  open,
  openFile: (opts = {}) => open({ ...opts, mode: 'file' }),
  openDirectory: (opts = {}) => open({ ...opts, mode: 'directory', selectLabel: opts.selectLabel || 'Select Folder' }),
  saveFile: (opts = {}) => open({ ...opts, mode: 'save', selectLabel: opts.selectLabel || 'Save' }),
};

export {};
