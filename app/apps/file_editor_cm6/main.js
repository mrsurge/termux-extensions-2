
// Code Viewer (CM6) — dual-surface editor with native Android selection mode.
// Imports resolve to files produced by scripts/vendor_cm6.sh
import * as CM from '/static/vendor/codemirror.1/codemirror.bundle.js';

// Core
const EditorState = CM.EditorState;
const { EditorView, keymap, highlightActiveLine, highlightActiveLineGutter, lineNumbers } = CM;
const defaultKeymap   = CM.defaultKeymap   || [];
const history         = CM.history         || (() => []);
const historyKeymap   = CM.historyKeymap   || [];
const searchKeymap    = CM.searchKeymap    || [];
const indentWithTab   = CM.indentWithTab   || (() => {});
const syntaxHighlighting = CM.syntaxHighlighting || (() => []);
const StreamLanguage  = CM.StreamLanguage;
const defaultHighlightStyle = CM.defaultHighlightStyle || null;
const { undo, redo } = CM;

// Languages (fallbacks are no-ops if missing in your bundle)
const javascript = CM.javascript || (() => []);
const jsonLang   = CM.json       || (() => []);
const python     = CM.python     || (() => []);
const htmlLang   = CM.html       || (() => []);
const cssLang    = CM.css        || (() => []);
const markdown   = CM.markdown   || (() => []);
const xmlLang    = CM.xml        || (() => []);

// Shell (legacy) — wrap if present in the bundle
const shellLang = () => {
  const mode = CM.shell || CM.shellMode || CM.modeShell;
  return (mode && StreamLanguage) ? StreamLanguage.define(mode) : null;
};

// ---- host/api contract (injected by framework) ----
/* global host, api */
export default async function initFileEditor(rootEl, api, host) {

window.host = host;
window.api  = api;
const HOME_DIR = '/data/data/com.termux/files/home';
const HOME_PREFIX = `${HOME_DIR}/`;

// DOM helpers
function requireEl(selector, scope=document) {
  const el = scope.querySelector(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

const container = requireEl('#editor-container');
const cmHost = requireEl('#cm6-host');
const selectSurface = requireEl('#select-surface');
const selectExit = requireEl('#select-exit');
const selectTip = requireEl('#select-tip');

// Title/status & chrome
const fileNameEl = requireEl('#fe-file-name');
const filePathEl = requireEl('#fe-file-path');
const statusEl = requireEl('#fe-status');

// Menus (ids must match template.html)
const menuFileBtn = requireEl('#menu-file-btn');
const menuFileDD  = requireEl('#menu-file-dd');
const menuEditBtn = requireEl('#menu-edit-btn');
const menuEditDD  = requireEl('#menu-edit-dd');
const menuViewBtn = requireEl('#menu-view-btn');
const menuViewDD  = requireEl('#menu-view-dd');
const menuThemeBtn= requireEl('#menu-theme-btn');
const menuThemeDD = requireEl('#menu-theme-dd');
const themeMenuItems = Array.from(menuThemeDD.querySelectorAll('[data-theme]'));

const btnBrowse   = requireEl('#fe-browse');
const miNew       = requireEl('#mi-new');
const miOpen      = requireEl('#mi-open');
const miSave      = requireEl('#mi-save');
const miSaveAs    = requireEl('#mi-saveas');
const miClose     = requireEl('#mi-close');
const miQuit      = requireEl('#mi-quit');

const miUndo      = requireEl('#mi-undo');
const miRedo      = requireEl('#mi-redo');
const miCut       = requireEl('#mi-cut');
const miCopy      = requireEl('#mi-copy');
const miPaste     = requireEl('#mi-paste');
const miSelectAll = requireEl('#mi-selectall');

const miToggleLines   = requireEl('#mi-toggle-lines');
const miToggleShading = requireEl('#mi-toggle-shading');
const miToggleSyntax  = requireEl('#mi-toggle-syntax');
const miToggleWrap    = requireEl('#mi-toggle-wrap');
const miFind          = requireEl('#mi-find');
const miGoto          = requireEl('#mi-goto');

const confirmModal = requireEl('#fe-confirm');
const confirmClose = requireEl('#fe-confirm-close');
const btnDiscard   = requireEl('#fe-discard');
const btnSaveConfirm = requireEl('#fe-save-confirm');
const btnCancel    = requireEl('#fe-cancel');

// ---------- small utils ----------
function simplifyAbsolute(path) {
  if (!path) return '/';
  const segments = [];
  const parts = String(path).split('/');
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') { if (segments.length) segments.pop(); continue; }
    segments.push(part);
  }
  return '/' + segments.join('/');
}

function toAbsolute(path, base, homeDir=HOME_DIR) {
  if (!path) return simplifyAbsolute(base || homeDir);
  let value = String(path).trim();
  if (!value) return simplifyAbsolute(base || homeDir);
  if (value === '~') return homeDir;
  if (value.startsWith('~/')) return simplifyAbsolute(`${homeDir}/${value.slice(2)}`);
  if (value.startsWith('/')) return simplifyAbsolute(value);
  const origin = toAbsolute(base || homeDir, null, homeDir);
  return simplifyAbsolute(`${origin.replace(/\/+$/, '')}/${value}`);
}

function parentDir(path) {
  const abs = toAbsolute(path || HOME_DIR);
  if (abs === '/' || abs === '') return '/';
  if (abs === HOME_DIR) return '/';
  const trimmed = abs.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '/';
  return trimmed.slice(0, idx) || '/';
}

function basename(path) {
  const abs = toAbsolute(path || HOME_DIR);
  if (abs === '/') return '/';
  const parts = abs.split('/');
  return parts[parts.length - 1] || '/';
}

function detectLanguageFromFilename(filename) {
  if (!filename) return null;
  const parts = String(filename).toLowerCase().split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop();
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    json: 'json', css: 'css', scss: 'css', less: 'css',
    html: 'html', htm: 'html',
    md: 'markdown', markdown: 'markdown',
    py: 'python', pyw: 'python',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    ksh: 'shell', csh: 'shell', tcsh: 'shell',
    xml: 'xml', svg: 'xml',
  };
  return map[ext] || null;
}

function setMenuChecked(element, checked) {
  if (!element) return;
  element.classList.toggle('fe-menu-item-checked', !!checked);
  element.setAttribute('aria-checked', checked ? 'true' : 'false');
}

function formatDisplayPath(path) {
  const abs = toAbsolute(path || HOME_DIR);
  if (abs === HOME_DIR) return '~';
  if (abs.startsWith(HOME_PREFIX)) return `~/${abs.slice(HOME_PREFIX.length)}`;
  return abs;
}

// ---------- Editor state ----------
let view = null;
let currentPath = '';
let currentPathExists = false;
let lastSavedContent = '';
let unsaved = false;
let showLineNumbers = true;
let showLineShading = false; // cosmetic; not implemented for CM6 here
let showSyntaxHighlight = true;
let wordWrap = false;
let currentTheme = 'cm6-dark';
let lastPickerPath = HOME_DIR;
let currentModeLanguage = null;

function makeExtensions() {
  const exts = [
    history(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    highlightActiveLine(),
  ];
  if (showLineNumbers) exts.push(lineNumbers(), highlightActiveLineGutter());
  if (showSyntaxHighlight && defaultHighlightStyle) {
    exts.push(syntaxHighlighting(defaultHighlightStyle, { fallback: true }));
  }
  if (wordWrap) {
    exts.push(EditorView.lineWrapping);
  }
  // Theme
  const dark = EditorView.theme({}, {dark:true});
  const light = EditorView.theme({}, {dark:false});
  exts.push(currentTheme === 'cm6-dark' ? dark : light);
  // Language
  const lang = (currentModeLanguage || 'text');
  switch (lang) {
    case 'javascript': exts.push(javascript()); break;
    case 'json': exts.push(jsonLang()); break;
    case 'python': exts.push(python()); break;
    case 'html': exts.push(htmlLang()); break;
    case 'css': exts.push(cssLang()); break;
    case 'markdown': exts.push(markdown()); break;
    case 'xml': exts.push(xmlLang()); break;
    case 'shell': { const s = shellLang(); if (s) exts.push(s); } break;
    default: break;
  }
  return exts;
}

function createView(docText='') {
  if (view) view.destroy();
  const state = EditorState.create({
    doc: docText,
    extensions: makeExtensions(),
  });
  view = new EditorView({ state, parent: cmHost });
  view.dom.style.flex = '1';
  view.dom.style.height = '100%';
  view.focus();
}

function getText() { return view ? view.state.doc.toString() : ''; }
function setText(t) { createView(t); }

function markUnsaved(flag) {
  unsaved = !!flag;
  fileNameEl.classList.toggle('fe-unsaved', unsaved);
  statusEl.textContent = unsaved ? 'Unsaved changes' : '';
}

// ---------- API helpers ----------
async function apiGet(path) {
  const data = await api.get(path);
  // framework returns either raw or {ok,data}; normalize:
  return data.content ? data : (data.data || data);
}
async function apiPost(path, body) {
  const res = await api.post(path, body);
  return res.data || res;
}

// ---------- File ops ----------
function updatePathDisplay() {
  if (!currentPath) {
    fileNameEl.textContent = 'Untitled';
    fileNameEl.title = 'Untitled';
    filePathEl.textContent = 'No file open';
    filePathEl.title = '';
    return;
  }
  const abs = toAbsolute(currentPath, null, HOME_DIR);
  fileNameEl.textContent = basename(abs);
  fileNameEl.title = basename(abs);
  filePathEl.textContent = formatDisplayPath(abs);
  filePathEl.title = abs;
}

async function openFile(path) {
  if (!path) throw new Error('Path is empty');
  statusEl.textContent = 'Opening...';
  try {
    const payload = await apiGet(`read?path=${encodeURIComponent(path)}`);
    const resolved = toAbsolute(payload.path || path, null, HOME_DIR);
    currentPath = resolved;
    currentPathExists = true;
    lastPickerPath = parentDir(resolved);
    currentModeLanguage = detectLanguageFromFilename(resolved);
    setText(payload.content || '');
    lastSavedContent = getText();
    markUnsaved(false);
    updatePathDisplay();
    statusEl.textContent = '';
  } catch (e) {
    statusEl.textContent = '';
    host.toast(`Failed to open: ${e.message}`);
    throw e;
  }
}

async function saveFile() {
  if (!currentPath || !currentPathExists) return saveAsDialog();
  statusEl.textContent = 'Saving...';
  try {
    const content = getText();
    await apiPost('write', { path: currentPath, content });
    lastSavedContent = content;
    markUnsaved(false);
    host.toast('Saved');
  } catch (e) {
    host.toast(`Save failed: ${e.message}`);
  } finally {
    statusEl.textContent = '';
  }
}

async function saveAsDialog() {
  const target = await pickSaveTarget();
  if (!target || !target.path) return;
  if (target.existed && !window.confirm('File exists. Overwrite?')) return;
  statusEl.textContent = 'Saving...';
  try {
    const content = getText();
    await apiPost('write', { path: target.path, content });
    currentPath = toAbsolute(target.path, null, HOME_DIR);
    currentPathExists = true;
    lastPickerPath = parentDir(currentPath);
    currentModeLanguage = detectLanguageFromFilename(currentPath);
    lastSavedContent = content;
    markUnsaved(false);
    updatePathDisplay();
    host.toast('Saved');
  } catch (e) {
    host.toast(`Save failed: ${e.message}`);
  } finally {
    statusEl.textContent = '';
  }
}

// ---------- Picker helpers (shared modal provided by framework) ----------
function pickerAvailable() {
  return window.teFilePicker && typeof window.teFilePicker.openFile === 'function';
}
async function pickFile(startPath) {
  if (!pickerAvailable()) { host.toast('File picker unavailable'); return null; }
  const baseStart = startPath || (currentPath ? parentDir(currentPath) : lastPickerPath);
  const initial = toAbsolute(baseStart, null, HOME_DIR);
  try {
    const choice = await window.teFilePicker.openFile({ title:'Open File', startPath:initial, selectLabel:'Open' });
    if (choice && choice.path) { lastPickerPath = parentDir(choice.path); return choice.path; }
    return null;
  } catch (e) {
    if (e && e.message === 'cancelled') return null;
    host.toast(e?.message || 'Browse failed');
    return null;
  }
}
async function pickSaveTarget() {
  if (!pickerAvailable()) { host.toast('File picker unavailable'); return null; }
  const baseDir = currentPath ? parentDir(currentPath) : lastPickerPath;
  const initialDir = toAbsolute(baseDir, null, HOME_DIR);
  try {
    const result = await window.teFilePicker.saveFile({
      title:'Save As', startPath: initialDir, filename: currentPath ? basename(currentPath) : '', selectLabel:'Save'
    });
    return result || null;
  } catch (e) {
    if (e && e.message === 'cancelled') return null;
    host.toast(e?.message || 'Save cancelled');
    return null;
  }
}

// ---------- Menu & keyboard wiring ----------
function closeAllMenus() { menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); menuViewDD.classList.remove('show'); menuThemeDD.classList.remove('show'); }
function bindMenuToggle(el, action) {
  if (!el) return;
  const run = () => { closeAllMenus(); action(); };
  el.addEventListener('click', run);
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); run(); } });
}

menuFileBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuFileDD.classList.toggle('show'); if (open){menuEditDD.classList.remove('show'); menuViewDD.classList.remove('show'); menuThemeDD.classList.remove('show');}});
menuEditBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuEditDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuViewDD.classList.remove('show'); menuThemeDD.classList.remove('show');}});
menuViewBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuViewDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); menuThemeDD.classList.remove('show');}});
menuThemeBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuThemeDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); menuViewDD.classList.remove('show');}});
document.addEventListener('click', () => closeAllMenus());

bindMenuToggle(miNew, () => {
  if (unsaved) { showConfirm(); return; }
  currentPath = ''; currentPathExists = false; lastPickerPath = HOME_DIR; currentModeLanguage = null;
  setText(''); lastSavedContent = ''; markUnsaved(false); updatePathDisplay();
});
bindMenuToggle(miOpen, async () => { const p = await pickFile(); if (p) await openFile(p); });
bindMenuToggle(miSave, () => saveFile());
bindMenuToggle(miSaveAs, () => saveAsDialog());
bindMenuToggle(miClose, () => { currentPath=''; currentPathExists=false; lastPickerPath=HOME_DIR; currentModeLanguage=null; setText(''); lastSavedContent=''; markUnsaved(false); updatePathDisplay(); });
bindMenuToggle(miQuit, () => { try{ host.clearState(); }catch{} currentPath=''; currentPathExists=false; setText(''); lastSavedContent=''; markUnsaved(false); updatePathDisplay(); });

bindMenuToggle(miUndo, () => { if (view && undo) undo(view); });
bindMenuToggle(miRedo, () => { if (view && redo) redo(view); });
bindMenuToggle(miCut,  () => document.execCommand('cut'));
bindMenuToggle(miCopy, () => document.execCommand('copy'));
bindMenuToggle(miPaste, async () => {
  try {
    const text = await navigator.clipboard?.readText?.();
    if (text != null) {
      view.dispatch({ changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: text } });
      return;
    }
  } catch {}
  document.execCommand('paste');
});
bindMenuToggle(miSelectAll, () => { if (selectSurface.style.display === 'block') { const r = document.createRange(); r.selectNodeContents(selectSurface); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } else { view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }); view.focus(); } });

bindMenuToggle(miToggleLines, () => { showLineNumbers = !showLineNumbers; setMenuChecked(miToggleLines, showLineNumbers); createView(getText()); });
bindMenuToggle(miToggleShading, () => { showLineShading = !showLineShading; setMenuChecked(miToggleShading, showLineShading); /* cosmetic no-op */ });
bindMenuToggle(miToggleSyntax, () => { showSyntaxHighlight = !showSyntaxHighlight; setMenuChecked(miToggleSyntax, showSyntaxHighlight); createView(getText()); });
bindMenuToggle(miToggleWrap, () => {
  wordWrap = !wordWrap; setMenuChecked(miToggleWrap, wordWrap);
  selectSurface.classList.toggle('wrap', wordWrap);
  createView(getText());
});
bindMenuToggle(miFind, () => { /* framework may provide a modal; CM6 search UI omitted in raw ESM */ host.toast('Use browser Find (⋮ > Find in page) or external search until search UI is wired.'); });
bindMenuToggle(miGoto, () => { const input = window.prompt('Go to line'); const line = Number.parseInt(input || '', 10); if (!Number.isNaN(line)) { const ln = Math.max(1, line); const pos = view.state.doc.line(ln).from; view.dispatch({ selection:{anchor:pos}, scrollIntoView:true }); view.focus(); } });

btnBrowse.addEventListener('click', async () => { const path = await pickFile(); if (path) await openFile(path); });

// Unsaved tracking
function onAnyChange() {
  const now = getText();
  markUnsaved(now !== lastSavedContent);
}
const changeObserver = new MutationObserver(onAnyChange);
const observeEditor = () => {
  changeObserver.disconnect();
  if (view?.dom) changeObserver.observe(view.dom, { childList:true, subtree:true, characterData:true });
};
const reobserve = () => setTimeout(observeEditor, 0);

// Initialize editor
createView('');
reobserve();

// ---------- Dual-surface selection mode ----------
let selectMode = false;
let longPressTimer = null;
let pointerDownAt = null;

function enterSelectMode(fromPoint=null) {
  if (selectMode) return;
  selectMode = true;
  // Populate and show the selection surface
  selectSurface.textContent = getText();
  selectSurface.style.display = 'block';
  selectExit.style.display = 'inline-flex';
  selectTip.style.display = 'block';
  cmHost.style.display = 'none';
  cmHost.setAttribute('inert', 'true');
  cmHost.setAttribute('aria-hidden', 'true');
  // Focus and place caret near press
  selectSurface.focus();
  try {
    if (fromPoint && document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(fromPoint.x, fromPoint.y);
      if (r) {
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
  } catch {}
}

function exitSelectMode(commitChanges=true) {
  if (!selectMode) return;
  selectMode = false;
  if (commitChanges) {
    const newText = selectSurface.textContent || '';
    if (newText !== getText()) {
      setText(newText);
      markUnsaved(newText !== lastSavedContent);
    }
  }
  selectSurface.style.display = 'none';
  selectExit.style.display = 'none';
  selectTip.style.display = 'none';
  cmHost.style.display = 'flex';
  cmHost.removeAttribute('inert');
  cmHost.removeAttribute('aria-hidden');
  view.focus();
}

function scheduleLongPress(ev) {
  clearTimeout(longPressTimer);
  const pt = { x: ev.clientX, y: ev.clientY };
  pointerDownAt = { x: pt.x, y: pt.y, t: Date.now() };
  longPressTimer = setTimeout(() => enterSelectMode(pt), 500);
}
function cancelLongPress() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
  pointerDownAt = null;
}

cmHost.addEventListener('pointerdown', (ev) => {
  if (ev.pointerType === 'touch' || ev.pointerType === 'pen') scheduleLongPress(ev);
});
['pointerup','pointercancel','pointermove','wheel','scroll'].forEach(evt => {
  cmHost.addEventListener(evt, cancelLongPress, { passive:true });
});

selectExit.addEventListener('click', () => exitSelectMode(true));
selectSurface.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { ev.preventDefault(); exitSelectMode(true); }
});
selectSurface.addEventListener('blur', () => {
  // If user navigates away, keep selection mode but sync text to CM to avoid divergence
  const newText = selectSurface.textContent || '';
  if (newText !== getText()) { setText(newText); markUnsaved(newText !== lastSavedContent); }
});

// ---------- Confirm modal ----------
function showConfirm() {
  confirmModal.classList.add('show');
  confirmModal.setAttribute('aria-hidden', 'false');
}
function hideConfirm() {
  confirmModal.classList.remove('show');
  confirmModal.setAttribute('aria-hidden', 'true');
}
confirmClose.addEventListener('click', hideConfirm);
btnCancel.addEventListener('click', hideConfirm);
btnDiscard.addEventListener('click', () => { hideConfirm(); markUnsaved(false); host.requestExit(); });
btnSaveConfirm.addEventListener('click', async () => { await saveFile(); hideConfirm(); host.requestExit(); });

// ---------- State load/init ----------
host.setTitle('Code Viewer (CM6)');
const state = host.loadState({
  lastPath: null, draft: null,
  showLineNumbers: true, showLineShading: false,
  showSyntaxHighlight: true, wordWrap: false, theme: 'cm6-dark',
}) || {};

showLineNumbers = state.showLineNumbers !== false;
showLineShading = !!state.showLineShading;
showSyntaxHighlight = state.showSyntaxHighlight !== false;
wordWrap = !!state.wordWrap;
currentTheme = (state.theme && typeof state.theme === 'string') ? state.theme : 'cm6-dark';
setMenuChecked(miToggleLines, showLineNumbers);
setMenuChecked(miToggleShading, showLineShading);
setMenuChecked(miToggleSyntax, showSyntaxHighlight);
setMenuChecked(miToggleWrap, wordWrap);
selectSurface.classList.toggle('wrap', wordWrap);
createView(state.draft || '');
lastSavedContent = state.draft ? '' : getText();
markUnsaved(!!state.draft);
updatePathDisplay();

// Theme menu
themeMenuItems.forEach((item) => {
  const handle = () => {
    const themeId = item.getAttribute('data-theme');
    currentTheme = themeId === 'cm6-light' ? 'cm6-light' : 'cm6-dark';
    themeMenuItems.forEach((it) => setMenuChecked(it, it === item));
    createView(getText());
  };
  item.addEventListener('click', () => { closeAllMenus(); handle(); });
  item.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); closeAllMenus(); handle(); } });
});

// Open file via URL param
const params = new URLSearchParams(window.location.search);
const fileFromUrl = params.get('file');
if (fileFromUrl) {
  const abs = toAbsolute(fileFromUrl, null, HOME_DIR);
  lastPickerPath = parentDir(abs);
  openFile(abs).catch((e) => {
    host.toast(`Failed to open file: ${e.message}`);
    currentPath = ''; currentPathExists = false; setText(''); markUnsaved(false); updatePathDisplay();
  });
} else if (state.draft) {
  currentPath = state.lastPath ? toAbsolute(state.lastPath, null, HOME_DIR) : '';
  currentPathExists = false;
  currentModeLanguage = currentPath ? detectLanguageFromFilename(currentPath) : null;
} else if (state.lastPath) {
  const abs = toAbsolute(state.lastPath, null, HOME_DIR);
  lastPickerPath = parentDir(abs);
  openFile(abs).catch(() => {
    currentPath = abs; currentPathExists = false; setText(''); updatePathDisplay();
  });
}

// Save state on exit
host.onBeforeExit(() => {
  if (unsaved) { showConfirm(); host.toast('Unsaved changes — Save or Discard before leaving.'); return { cancel:true }; }
  return {
    lastPath: currentPath || null,
    draft: unsaved ? getText() : null,
    showLineNumbers, showLineShading,
    showSyntaxHighlight, wordWrap, theme: currentTheme,
  };
});

// Track changes: refresh unsaved flag
// (We don't wire CM6 transactions directly since we're using bare ESM; use a lightweight observer)
const observer = new MutationObserver(() => onAnyChange());
observer.observe(cmHost, { childList:true, subtree:true, characterData:true });
}
