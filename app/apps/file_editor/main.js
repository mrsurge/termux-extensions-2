export default function (container, api, host) {
  console.log('File Editor app init v20241014a');

  const HOME_DIR = '/data/data/com.termux/files/home';
  const HOME_PREFIX = HOME_DIR + '/';

  const requireEl = (selector, scope = container) => {
    const el = scope.querySelector(selector);
    if (!el) throw new Error(`File Editor missing element ${selector}`);
    return el;
  };

  const pathDisplay = requireEl('#fe-path-display');
  const btnBrowse = requireEl('#fe-browse');
  const editor = requireEl('#editor');
  const bg = container.querySelector('#fe-bg');
  const gutter = requireEl('#fe-gutter');
  const statusEl = requireEl('#fe-status');

  // Universal picker is provided globally via window.teFilePicker

  // Menus and confirm modal
  const menuFileBtn = requireEl('#menu-file-btn');
  const menuFileDD = requireEl('#menu-file-dd');
  const menuEditBtn = requireEl('#menu-edit-btn');
  const menuEditDD = requireEl('#menu-edit-dd');
  const miNew = requireEl('#mi-new');
  const miOpen = requireEl('#mi-open');
  const miSave = requireEl('#mi-save');
  const miSaveAs = requireEl('#mi-saveas');
  const miUndo = requireEl('#mi-undo');
  const miRedo = requireEl('#mi-redo');
  const miCut = requireEl('#mi-cut');
  const miCopy = requireEl('#mi-copy');
  const miPaste = requireEl('#mi-paste');
  const miSelectAll = requireEl('#mi-selectall');

  // View menu and find/goto UI
  const menuViewBtn = requireEl('#menu-view-btn');
  const menuViewDD = requireEl('#menu-view-dd');
  const miToggleLines = requireEl('#mi-toggle-lines');
  const miToggleStriping = requireEl('#mi-toggle-striping');
  const miFind = requireEl('#mi-find');
  const miGoto = requireEl('#mi-goto');

  const findbar = requireEl('#fe-findbar');
  const findInput = requireEl('#fe-find');
  const replaceInput = requireEl('#fe-replace');
  const btnFindPrev = requireEl('#fe-find-prev');
  const btnFindNext = requireEl('#fe-find-next');
  const btnReplaceOne = requireEl('#fe-replace-one');
  const btnReplaceAll = requireEl('#fe-replace-all');
  const btnFindClose = requireEl('#fe-find-close');
  const btnFindCase = requireEl('#fe-find-case');
  const btnFindWord = requireEl('#fe-find-word');

  const gotoModal = requireEl('#fe-goto');
  const gotoClose = requireEl('#fe-goto-close');
  const gotoInput = requireEl('#fe-goto-input');
  const gotoGo = requireEl('#fe-goto-go');

  const confirmModal = requireEl('#fe-confirm');
  const confirmClose = requireEl('#fe-confirm-close');
  const btnDiscard = requireEl('#fe-discard');
  const btnSaveConfirm = requireEl('#fe-save-confirm');
  const btnCancel = requireEl('#fe-cancel');

  // State
  let currentPath = '';
  let currentPathExists = false;
  let lastSavedContent = '';
  let unsaved = false;
  let showLineNumbers = true;
  let stripeLines = false;
  let findCase = false;
  let findWord = false;
  let lastFind = { query: '', index: -1 };
  let lastPickerPath = HOME_DIR;

  // State helpers
  function persistState(patch) {
    try {
      const cur = host.loadState({}) || {};
      host.saveState({ ...cur, ...patch });
    } catch (_) {}
  }

  // Utils
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

  function toAbsolute(path, base) {
    if (!path) return simplifyAbsolute(base || HOME_DIR);
    let value = String(path).trim();
    if (!value) return simplifyAbsolute(base || HOME_DIR);
    if (value === '~') return HOME_DIR;
    if (value.startsWith('~/')) return simplifyAbsolute(HOME_DIR + '/' + value.slice(2));
    if (value.startsWith('/')) return simplifyAbsolute(value);
    const origin = toAbsolute(base || HOME_DIR);
    return simplifyAbsolute(origin.replace(/\/+$/, '') + '/' + value);
  }

  function basename(p) {
    const abs = toAbsolute(p || HOME_DIR);
    if (abs === '/') return '/';
    const parts = abs.split('/');
    return parts[parts.length - 1] || '/';
  }

  function parentDir(p) {
    const abs = toAbsolute(p || HOME_DIR);
    if (abs === '/' || abs === '') return '/';
    if (abs === HOME_DIR) return '/';
    const trimmed = abs.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    if (idx <= 0) return '/';
    return trimmed.slice(0, idx) || '/';
  }

  function joinPath(dir, name) {
    const base = toAbsolute(dir || HOME_DIR);
    const cleanName = String(name || '').trim();
    if (!cleanName) return base;
    return simplifyAbsolute((base === '/' ? '' : base) + '/' + cleanName);
  }

  function formatDisplayPath(path) {
    const abs = toAbsolute(path || HOME_DIR);
    if (abs === HOME_DIR) return '~';
    if (abs.startsWith(HOME_PREFIX)) return '~/' + abs.slice(HOME_PREFIX.length);
    return abs;
  }

  function setUnsaved(flag) {
    unsaved = !!flag;
    const titleBase = currentPath ? `Text Editor — ${basename(currentPath)}` : 'Text Editor';
    host.setTitle(unsaved ? `${titleBase} *` : titleBase);
    statusEl.textContent = unsaved ? 'Unsaved changes' : '';
  }
  function setEditorContent(value, markSaved = false) {
    editor.value = value != null ? value : '';
    if (markSaved) {
      lastSavedContent = editor.value;
      setUnsaved(false);
    } else {
      setUnsaved(editor.value !== lastSavedContent);
    }
    updateGutter();
  }
  function updateStateDebounced() {
    if (updateStateDebounced._t) clearTimeout(updateStateDebounced._t);
    updateStateDebounced._t = setTimeout(() => {
      try { host.saveState({ lastPath: currentPath || null, draft: editor.value }); } catch (_) {}
    }, 400);
  }
  function updatePathDisplay() {
    if (!currentPath) {
      pathDisplay.textContent = 'Untitled';
      pathDisplay.title = 'Untitled';
      return;
    }
    const abs = toAbsolute(currentPath, HOME_DIR);
    pathDisplay.textContent = abs;
    pathDisplay.title = abs;
  }
  function updateLineHeightVar() {
    const lineHeight = getComputedStyle(editor).lineHeight;
    // Use an integer pixel value to avoid fractional rounding drift across lines
    const lh = Math.max(1, Math.round(parseFloat(lineHeight) || 20));
    editor.style.setProperty('--fe-lh', lh + 'px');
  }
  function updateStripeOffset() {
    const lhStr = getComputedStyle(editor).getPropertyValue('--fe-lh') || '20px';
    const lh = parseInt(lhStr, 10) || 20;
    const offset = -(editor.scrollTop % lh);
    (bg || editor).style.setProperty('--fe-bg-offset', offset + 'px');
  }
  function setStriping(show) {
    stripeLines = !!show;
    if (bg) bg.style.display = stripeLines ? 'block' : 'none';
    editor.classList.toggle('striped', stripeLines && !bg);
    updateLineHeightVar();
    updateStripeOffset();
  }

  async function openFile(path) {
    if (!path) throw new Error('Path is empty');
    statusEl.textContent = 'Opening...';
    try {
      const data = await api.get('read?path=' + encodeURIComponent(path));
      const { path: resolvedPath, content } = data;
      currentPath = toAbsolute(resolvedPath || path, HOME_DIR);
      lastPickerPath = parentDir(currentPath);
      currentPathExists = true;
      setEditorContent(content, true);
      persistState({ lastPath: currentPath, draft: null, showLineNumbers });
      updatePathDisplay();
      statusEl.textContent = '';
    } catch (e) {
      statusEl.textContent = '';
      host.toast('Failed to open: ' + e.message);
      throw e;
    }
  }

  async function saveFile() {
    if (!currentPath || !currentPathExists) {
      await saveAsDialog();
      return;
    }
    statusEl.textContent = 'Saving...';
    try {
      await api.post('write', { path: currentPath, content: editor.value });
      lastSavedContent = editor.value;
      setUnsaved(false);
      persistState({ lastPath: currentPath, showLineNumbers });
      host.toast('Saved');
      statusEl.textContent = '';
    } catch (e) {
      statusEl.textContent = '';
      host.toast('Save failed: ' + e.message);
    }
  }

  function showConfirm() { confirmModal.classList.add('show'); confirmModal.setAttribute('aria-hidden', 'false'); }
  function hideConfirm() { confirmModal.classList.remove('show'); confirmModal.setAttribute('aria-hidden', 'true'); }

  function pickerAvailable() {
    return window.teFilePicker && typeof window.teFilePicker.open === 'function';
  }

  async function pickFile(startPath) {
    if (!pickerAvailable()) {
      host.toast('File picker unavailable');
      return null;
    }
    const baseStart = startPath || (currentPath ? parentDir(currentPath) : lastPickerPath);
    const initial = toAbsolute(baseStart, lastPickerPath);
    try {
      const choice = await window.teFilePicker.openFile({
        title: 'Open File',
        startPath: initial,
        selectLabel: 'Open',
      });
      if (choice && choice.path) {
        lastPickerPath = parentDir(choice.path);
        return choice.path;
      }
      return null;
    } catch (err) {
      if (err && err.message === 'cancelled') return null;
      host.toast(err?.message || 'Browse failed');
      return null;
    }
  }

  async function pickSaveTarget() {
    if (!pickerAvailable()) {
      host.toast('File picker unavailable');
      return null;
    }
    const baseDir = currentPath ? parentDir(currentPath) : lastPickerPath;
    const initialDir = toAbsolute(baseDir, lastPickerPath);
    try {
      const result = await window.teFilePicker.saveFile({
        title: 'Save As',
        startPath: initialDir,
        filename: currentPath ? basename(currentPath) : '',
        selectLabel: 'Save',
      });
      return result || null;
    } catch (err) {
      if (err && err.message === 'cancelled') return null;
      host.toast(err?.message || 'Save cancelled');
      return null;
    }
  }

  async function saveAsDialog() {
    const target = await pickSaveTarget();
    if (!target || !target.path) return;
    if (target.existed) {
      const confirmOverwrite = window.confirm('File exists. Overwrite?');
      if (!confirmOverwrite) return;
    }
    statusEl.textContent = 'Saving...';
    try {
      await api.post('write', { path: target.path, content: editor.value });
      currentPath = target.path;
      currentPathExists = true;
      lastPickerPath = parentDir(currentPath);
      lastSavedContent = editor.value;
      setUnsaved(false);
      updatePathDisplay();
      persistState({ lastPath: currentPath, showLineNumbers });
      host.toast('Saved');
    } catch (e) {
      host.toast('Save failed: ' + e.message);
    } finally {
      statusEl.textContent = '';
    }
  }

  // Event bindings
  btnBrowse.addEventListener('click', async () => {
    const path = await pickFile();
    if (path) {
      try {
        await openFile(path);
      } catch (e) {
        host.toast('Failed to open file: ' + e.message);
      }
    }
  });
  // Track edits and unsaved changes
  editor.addEventListener('input', () => { setUnsaved(editor.value !== lastSavedContent); updateStateDebounced(); updateGutter(); updateLineHeightVar(); updateStripeOffset(); });
  function syncScroll() {
    // Keep gutter and background in sync without overlapping header
    gutter.scrollTop = editor.scrollTop;
    updateStripeOffset();
  }
  editor.addEventListener('scroll', syncScroll);
  window.addEventListener('resize', () => { updateLineHeightVar(); updateStripeOffset(); updateGutter(); });
  // Persist and restore scroll position
  editor.addEventListener('scroll', () => { try { const cur = host.loadState({}) || {}; host.saveState({ ...cur, scrollTop: editor.scrollTop }); } catch (_) {} });

  // Before exit handler
  host.onBeforeExit(() => {
    if (unsaved) { showConfirm(); host.toast('Unsaved changes — Save or Discard before leaving.'); return { cancel: true }; }
    return { lastPath: currentPath || null, draft: editor.value, showLineNumbers, stripeLines, findCase, findWord };
  });

  // Initialization
  (function init() {
    host.setTitle('Text Editor');
    const state = host.loadState({ lastPath: null, draft: null, showLineNumbers: true, stripeLines: false, findCase: false, findWord: false, scrollTop: 0 }) || { lastPath: null, draft: null, showLineNumbers: true, stripeLines: false, findCase: false, findWord: false, scrollTop: 0 };
    showLineNumbers = !!state.showLineNumbers;
    setShowLineNumbers(showLineNumbers);
    setStriping(!!state.stripeLines);
    findCase = !!state.findCase; btnFindCase.classList.toggle('active', findCase);
    findWord = !!state.findWord; btnFindWord.classList.toggle('active', findWord);
    if (state.draft) {
      setEditorContent(state.draft, false);
      setUnsaved(true);
    }
    if (state.lastPath) {
      const abs = toAbsolute(state.lastPath, HOME_DIR);
      lastPickerPath = parentDir(abs);
      openFile(abs).catch(() => { currentPath = abs; updatePathDisplay(); });
    } else {
      setEditorContent('', false);
      setUnsaved(false);
      lastPickerPath = HOME_DIR;
      updatePathDisplay();
    }
    if (state.scrollTop) { editor.scrollTop = state.scrollTop; updateStripeOffset(); }
    updateGutter();
  })();

  // Menu behavior
  function closeAllMenus() { menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); }
  menuFileBtn.addEventListener('click', (e) => { e.stopPropagation(); const s = menuFileDD.classList.toggle('show'); if (s) menuEditDD.classList.remove('show'); });
  menuEditBtn.addEventListener('click', (e) => { e.stopPropagation(); const s = menuEditDD.classList.toggle('show'); if (s) menuFileDD.classList.remove('show'); });
  document.addEventListener('click', () => closeAllMenus());

  // Menu actions
  function focusEditor() { editor.focus(); }
  function exec(cmd) { try { document.execCommand(cmd); } catch (_) {} }
  miNew.addEventListener('click', () => {
    closeAllMenus();
    if (unsaved) { showConfirm(); return; }
    currentPath = '';
    currentPathExists = false;
    lastPickerPath = HOME_DIR;
    setEditorContent('', true);
    updatePathDisplay();
    persistState({ lastPath: null, draft: '', showLineNumbers });
  });
  miOpen.addEventListener('click', () => { closeAllMenus(); btnBrowse.click(); });
  miSave.addEventListener('click', () => { closeAllMenus(); saveFile(); });
  miSaveAs.addEventListener('click', () => { closeAllMenus(); saveAsDialog(); });
  const miClose = container.querySelector('#mi-close');
  const miQuit = container.querySelector('#mi-quit');
  miClose.addEventListener('click', () => {
    closeAllMenus();
    currentPath = '';
    currentPathExists = false;
    lastPickerPath = HOME_DIR;
    setEditorContent('', true);
    updatePathDisplay();
    try { const cur = host.loadState({}) || {}; host.saveState({ ...cur, lastPath: null, draft: '' }); } catch (_) {}
  });
  miQuit.addEventListener('click', () => {
    closeAllMenus();
    try { host.clearState(); } catch (_) {}
    currentPath = '';
    currentPathExists = false;
    lastPickerPath = HOME_DIR;
    setEditorContent('', true);
    updatePathDisplay();
    editor.scrollTop = 0;
    updateStripeOffset();
  });
  miUndo.addEventListener('click', () => { closeAllMenus(); focusEditor(); exec('undo'); });
  miRedo.addEventListener('click', () => { closeAllMenus(); focusEditor(); exec('redo'); });
  miCut.addEventListener('click', () => { closeAllMenus(); focusEditor(); exec('cut'); });
  miCopy.addEventListener('click', () => { closeAllMenus(); focusEditor(); exec('copy'); });
  miPaste.addEventListener('click', async () => { closeAllMenus(); focusEditor(); try { if (navigator.clipboard && navigator.clipboard.readText) { const text = await navigator.clipboard.readText(); const start = editor.selectionStart, end = editor.selectionEnd; const val = editor.value; editor.value = val.slice(0, start) + text + val.slice(end); const pos = start + text.length; editor.selectionStart = editor.selectionEnd = pos; editor.dispatchEvent(new Event('input', { bubbles: true })); } else { exec('paste'); } } catch (e) { host.toast('Paste failed: ' + e.message); } });
  miSelectAll.addEventListener('click', () => { closeAllMenus(); focusEditor(); editor.select(); });

  // View menu behavior
  menuViewBtn.addEventListener('click', (e) => { e.stopPropagation(); const s = menuViewDD.classList.toggle('show'); if (s) { menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); } });
  const closeMenusDoc = () => { menuViewDD.classList.remove('show'); };
  document.addEventListener('click', closeMenusDoc);
  function setShowLineNumbers(show) {
    showLineNumbers = !!show;
    gutter.classList.toggle('hidden', !showLineNumbers);
    updateGutter();
  }
  miToggleLines.addEventListener('click', () => { setShowLineNumbers(!showLineNumbers); persistState({ showLineNumbers }); });
  miToggleStriping.addEventListener('click', () => { setStriping(!stripeLines); persistState({ stripeLines }); });
  function showFindBar() { findbar.classList.add('show'); setTimeout(() => findInput.focus(), 0); }
  function hideFindBar() { findbar.classList.remove('show'); }
  miFind.addEventListener('click', () => { closeAllMenus(); showFindBar(); });
  btnFindClose.addEventListener('click', hideFindBar);
  miGoto.addEventListener('click', () => { closeAllMenus(); showGoto(); });

  // Find/Replace logic
  function getSelection() { return { start: editor.selectionStart, end: editor.selectionEnd }; }
  function setSelection(start, end) { editor.selectionStart = start; editor.selectionEnd = end; editor.focus(); }
  function isWordChar(ch) { return /[A-Za-z0-9_]/.test(ch || ''); }
  function matchesWholeWord(text, idx, qLen) {
    const left = text[idx - 1];
    const right = text[idx + qLen];
    return !isWordChar(left) && !isWordChar(right);
  }
  function findIndex(text, query, from, dir) {
    if (!findCase) { text = text.toLowerCase(); query = query.toLowerCase(); }
    const step = dir === 'prev' ? -1 : 1;
    let idx = dir === 'prev' ? Math.min(from, text.length - 1) : Math.max(from, 0);
    if (dir === 'prev') {
      const before = text.slice(0, idx);
      idx = before.lastIndexOf(query);
      if (idx === -1) idx = text.lastIndexOf(query);
    } else {
      idx = text.indexOf(query, idx);
      if (idx === -1) idx = text.indexOf(query, 0);
    }
    if (idx === -1) return -1;
    if (findWord && !matchesWholeWord(text, idx, query.length)) {
      // Continue searching past this index
      const nextFrom = dir === 'prev' ? Math.max(idx - 1, 0) : idx + 1;
      return findIndex(text, query, nextFrom, dir);
    }
    return idx;
  }
  function findNext() {
    const q = findInput.value || '';
    if (!q) return;
    const text = editor.value;
    const sel = getSelection();
    const idx = findIndex(text, q, sel.end, 'next');
    if (idx !== -1) { setSelection(idx, idx + q.length); lastFind = { query: q, index: idx }; ensureSelectionVisible(); }
  }
  function findPrev() {
    const q = findInput.value || '';
    if (!q) return;
    const text = editor.value;
    const sel = getSelection();
    const idx = findIndex(text, q, Math.max(sel.start - 1, 0), 'prev');
    if (idx !== -1) { setSelection(idx, idx + q.length); lastFind = { query: q, index: idx }; ensureSelectionVisible(); }
  }
  function ensureSelectionVisible() {
    // Scroll the textarea to selectionStart by estimating line index
    try {
      const selStart = editor.selectionStart;
      const before = editor.value.slice(0, selStart);
      const lineIndex = (before.match(/\n/g) || []).length;
      const lineHeight = getComputedStyle(editor).lineHeight;
      const lh = parseFloat(lineHeight) || 18;
      const target = Math.max(0, lineIndex * lh - editor.clientHeight / 2);
      editor.scrollTop = target;
      gutter.scrollTop = editor.scrollTop;
    } catch (_) {}
  }
  function selectedMatches(q) {
    const sel = getSelection();
    let text = editor.value;
    let frag = text.slice(sel.start, sel.end);
    if (!findCase) { frag = frag.toLowerCase(); q = q.toLowerCase(); }
    if (frag !== q) return false;
    if (!findWord) return true;
    const full = findCase ? editor.value : editor.value.toLowerCase();
    return matchesWholeWord(full, sel.start, q.length);
  }
  function replaceOne() {
    const q = findInput.value || '';
    if (!q) return;
    const rep = replaceInput.value || '';
    if (selectedMatches(q)) {
      const sel = getSelection();
      editor.setRangeText(rep, sel.start, sel.end, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      setSelection(sel.start, sel.start + rep.length);
      ensureSelectionVisible();
    } else {
      findNext();
    }
  }
  function replaceAll() {
    const qRaw = findInput.value || '';
    if (!qRaw) return;
    const rep = replaceInput.value || '';
    let text = editor.value;
    let q = qRaw;
    let hay = text;
    if (!findCase) { q = qRaw.toLowerCase(); hay = text.toLowerCase(); }
    let idx = findIndex(hay, q, 0, 'next');
    if (idx === -1) return;
    // Build new string by iterating matches
    let out = '';
    let last = 0;
    while (idx !== -1) {
      out += text.slice(last, idx) + rep;
      last = idx + q.length;
      idx = findIndex(hay, q, last, 'next');
    }
    out += text.slice(last);
    editor.value = out;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
  btnFindNext.addEventListener('click', findNext);
  btnFindPrev.addEventListener('click', findPrev);
  btnReplaceOne.addEventListener('click', replaceOne);
  btnReplaceAll.addEventListener('click', replaceAll);
  findInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) findPrev(); else findNext(); } });
  replaceInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } });
  btnFindCase.addEventListener('click', () => { findCase = !findCase; btnFindCase.classList.toggle('active', findCase); persistState({ findCase }); });
  btnFindWord.addEventListener('click', () => { findWord = !findWord; btnFindWord.classList.toggle('active', findWord); persistState({ findWord }); });

  // Goto modal logic
  function showGoto() { gotoModal.classList.add('show'); gotoModal.setAttribute('aria-hidden', 'false'); setTimeout(() => gotoInput.focus(), 0); }
  function hideGoto() { gotoModal.classList.remove('show'); gotoModal.setAttribute('aria-hidden', 'true'); }
  function getOffsetForLine(n) {
    n = Math.max(1, n);
    const lines = editor.value.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(n - 1, lines.length); i++) offset += lines[i].length + 1;
    return offset;
  }
  function goToLine() {
    const n = parseInt(gotoInput.value, 10);
    if (!n || n < 1) return;
    const offset = getOffsetForLine(n);
    setSelection(offset, offset);
    ensureSelectionVisible();
    hideGoto();
  }
  gotoClose.addEventListener('click', hideGoto);
  gotoGo.addEventListener('click', goToLine);
  gotoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); goToLine(); } });

  // Gutter updates
  function updateGutter() {
    if (!showLineNumbers) return;
    // Total lines in buffer
    const lines = editor.value.split('\n').length || 1;
    // Ensure the gutter fills at least the visible viewport height
    const lhStr = getComputedStyle(editor).getPropertyValue('--fe-lh') || getComputedStyle(editor).lineHeight || '18px';
    const lh = Math.max(1, Math.round(parseFloat(lhStr) || 18));
    const visible = Math.ceil(editor.clientHeight / lh);
    const displayLines = Math.max(lines, visible);
    const digits = String(displayLines).length;
    gutter.style.width = Math.max(3, digits + 1) + 'ch';
    let content = '';
    for (let i = 1; i <= displayLines; i++) content += i + (i === displayLines ? '' : '\n');
    if (gutter.textContent !== content) gutter.textContent = content;
    gutter.style.transform = `translateY(${-editor.scrollTop}px)`;
  }

  // Confirm modal actions
  confirmClose.addEventListener('click', hideConfirm);
  btnCancel.addEventListener('click', hideConfirm);
  btnDiscard.addEventListener('click', () => { hideConfirm(); setUnsaved(false); });
  btnSaveConfirm.addEventListener('click', async () => { await saveFile(); hideConfirm(); });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); if (e.shiftKey) { saveAsDialog(); } else { saveFile(); } }
    else if (k === 'o') { e.preventDefault(); btnBrowse.click(); }
    else if (k === 'n') { e.preventDefault(); miNew.click(); }
    else if (k === 'y') { e.preventDefault(); try { document.execCommand('redo'); } catch (_) {} }
    else if (k === 'f') { e.preventDefault(); showFindBar(); }
    else if (k === 'l') { e.preventDefault(); showGoto(); }
  });

  // Global escape closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideConfirm();
      hideGoto();
      hideFindBar();
      closeAllMenus();
    }
  });
}
