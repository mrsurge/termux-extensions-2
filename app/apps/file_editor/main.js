export default function (container, api, host) {
  // Elements
  const pathDisplay = container.querySelector('#fe-path-display');
  const btnBrowse = container.querySelector('#fe-browse');
  const editor = container.querySelector('#editor');
  const bg = container.querySelector('#fe-bg');
  const gutter = container.querySelector('#fe-gutter');
  const statusEl = container.querySelector('#fe-status');

  // Open modal elements
  const modal = container.querySelector('#fe-modal');
  const modalClose = container.querySelector('#fe-modal-close');
  const listEl = container.querySelector('#fe-list');
  const btnUp = container.querySelector('#fe-up');
  const openCrumbBtn = container.querySelector('#fe-open-crumb-btn');
  const openCrumbMenu = container.querySelector('#fe-open-crumb-menu');

  // Save As modal elements
  const saveAsModal = container.querySelector('#fe-saveas');
  const saveAsClose = container.querySelector('#fe-saveas-close');
  const saveAsList = container.querySelector('#fe-saveas-list');
  const saveAsUp = container.querySelector('#fe-saveas-up');
  const filenameInput = container.querySelector('#fe-filename');
  const saveAsSaveBtn = container.querySelector('#fe-saveas-save');
  const saveCrumbBtn = container.querySelector('#fe-save-crumb-btn');
  const saveCrumbMenu = container.querySelector('#fe-save-crumb-menu');

  // Menus and confirm modal
  const menuFileBtn = container.querySelector('#menu-file-btn');
  const menuFileDD = container.querySelector('#menu-file-dd');
  const menuEditBtn = container.querySelector('#menu-edit-btn');
  const menuEditDD = container.querySelector('#menu-edit-dd');
  const miNew = container.querySelector('#mi-new');
  const miOpen = container.querySelector('#mi-open');
  const miSave = container.querySelector('#mi-save');
  const miSaveAs = container.querySelector('#mi-saveas');
  const miUndo = container.querySelector('#mi-undo');
  const miRedo = container.querySelector('#mi-redo');
  const miCut = container.querySelector('#mi-cut');
  const miCopy = container.querySelector('#mi-copy');
  const miPaste = container.querySelector('#mi-paste');
  const miSelectAll = container.querySelector('#mi-selectall');

  // View menu and find/goto UI
  const menuViewBtn = container.querySelector('#menu-view-btn');
  const menuViewDD = container.querySelector('#menu-view-dd');
  const miToggleLines = container.querySelector('#mi-toggle-lines');
  const miToggleStriping = container.querySelector('#mi-toggle-striping');
  const miFind = container.querySelector('#mi-find');
  const miGoto = container.querySelector('#mi-goto');

  const findbar = container.querySelector('#fe-findbar');
  const findInput = container.querySelector('#fe-find');
  const replaceInput = container.querySelector('#fe-replace');
  const btnFindPrev = container.querySelector('#fe-find-prev');
  const btnFindNext = container.querySelector('#fe-find-next');
  const btnReplaceOne = container.querySelector('#fe-replace-one');
  const btnReplaceAll = container.querySelector('#fe-replace-all');
  const btnFindClose = container.querySelector('#fe-find-close');
  const btnFindCase = container.querySelector('#fe-find-case');
  const btnFindWord = container.querySelector('#fe-find-word');

  const gotoModal = container.querySelector('#fe-goto');
  const gotoClose = container.querySelector('#fe-goto-close');
  const gotoInput = container.querySelector('#fe-goto-input');
  const gotoGo = container.querySelector('#fe-goto-go');

  const confirmModal = container.querySelector('#fe-confirm');
  const confirmClose = container.querySelector('#fe-confirm-close');
  const btnDiscard = container.querySelector('#fe-discard');
  const btnSaveConfirm = container.querySelector('#fe-save-confirm');
  const btnCancel = container.querySelector('#fe-cancel');

  // State
  let currentPath = '';
  let currentPathExists = false;
  let lastSavedContent = '';
  let unsaved = false;
  let openDirPath = '~';
  let saveDirPath = '~';
  let saveDirItems = [];
  let showLineNumbers = true;
  let stripeLines = false;
  let findCase = false;
  let findWord = false;
  let lastFind = { query: '', index: -1 };

  // State helpers
  function persistState(patch) {
    try {
      const cur = host.loadState({}) || {};
      host.saveState({ ...cur, ...patch });
    } catch (_) {}
  }

  // Utils
  function basename(p) {
    if (!p || p === '~') return '~';
    const parts = p.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : p;
  }
  function parentDir(p) {
    if (!p || p === '~') return '~';
    p = p.replace(/\/+$/, '');
    const idx = p.lastIndexOf('/');
    if (idx <= 0) return '/';
    return p.slice(0, idx);
  }
  function joinPath(dir, name) {
    if (!dir || dir === '~') return `~/${name}`;
    if (dir.endsWith('/')) return dir + name;
    return dir + '/' + name;
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
    pathDisplay.textContent = currentPath || 'Untitled';
    pathDisplay.title = currentPath || 'Untitled';
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
      currentPath = resolvedPath || path;
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
      showSaveAs();
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

  async function fetchBrowse(path) {
    const url = '/api/browse?path=' + encodeURIComponent(path || '~');
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || `Browse failed (${res.status})`);
    return body.data;
  }

  // Open modal behaviors
  function showOpenModal() { modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false'); }
  function hideOpenModal() { modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); }
  function showConfirm() { confirmModal.classList.add('show'); confirmModal.setAttribute('aria-hidden', 'false'); }
  function hideConfirm() { confirmModal.classList.remove('show'); confirmModal.setAttribute('aria-hidden', 'true'); }

  function buildCrumbOptions(dir) {
    const opts = [];
    if (!dir || dir === '~') return [{ path: '~', label: '~' }];
    let p = dir.replace(/\/+$/, '');
    while (p) {
      const label = basename(p);
      opts.unshift({ path: p, label: label || '/' });
      const par = parentDir(p);
      if (par === p || par === '/') { if (par && par !== p) opts.unshift({ path: par, label: '/' }); break; }
      p = par;
      if (p === '/' || p === '') { opts.unshift({ path: '/', label: '/' }); break; }
    }
    return opts;
  }
  function updateOpenCrumb(dir) {
    openCrumbBtn.textContent = basename(dir) || '~';
    openCrumbMenu.innerHTML = '';
    const opts = buildCrumbOptions(dir);
    for (const o of opts) {
      const d = document.createElement('div');
      d.className = 'fe-crumb-item';
      d.textContent = o.label;
      d.title = o.path;
      d.addEventListener('click', async () => { openCrumbMenu.classList.remove('show'); await loadOpenDir(o.path); });
      openCrumbMenu.appendChild(d);
    }
  }
  openCrumbBtn.addEventListener('click', (e) => { e.stopPropagation(); openCrumbMenu.classList.toggle('show'); });
  document.addEventListener('click', () => openCrumbMenu.classList.remove('show'));

  async function loadOpenDir(path) {
    try {
      listEl.innerHTML = '<li class="fe-list-item"><span>Loading...</span></li>';
      const items = await fetchBrowse(path);
      openDirPath = path;
      updateOpenCrumb(openDirPath);
      listEl.innerHTML = '';
      items.sort((a, b) => { if (a.type !== b.type) return a.type === 'directory' ? -1 : 1; return a.name.localeCompare(b.name); });
      for (const it of items) {
        const li = document.createElement('li');
        li.className = 'fe-list-item';
        const icon = it.type === 'directory' ? '📁' : '📄';
        li.innerHTML = `<span>${icon}</span><span class=\"fe-list-name\"></span><span class=\"fe-chip\">${it.type}</span>`;
        li.querySelector('.fe-list-name').textContent = it.name || it.path;
        li.addEventListener('click', async () => {
          if (it.type === 'directory') {
            await loadOpenDir(it.path);
          } else {
            await openFile(it.path);
            hideOpenModal();
          }
        });
        listEl.appendChild(li);
      }
    } catch (e) {
      listEl.innerHTML = '';
      host.toast('Browse error: ' + e.message);
    }
  }

  // Save As behaviors
  function showSaveAs() {
    // Start in current file's directory or openDirPath or home
    saveDirPath = currentPath ? parentDir(currentPath) : (openDirPath || '~');
    filenameInput.value = currentPath ? basename(currentPath) : '';
    saveAsModal.classList.add('show');
    saveAsModal.setAttribute('aria-hidden', 'false');
    loadSaveDir(saveDirPath);
  }
  function hideSaveAs() { saveAsModal.classList.remove('show'); saveAsModal.setAttribute('aria-hidden', 'true'); }
  function updateSaveCrumb(dir) {
    saveCrumbBtn.textContent = basename(dir) || '~';
    saveCrumbMenu.innerHTML = '';
    const opts = buildCrumbOptions(dir);
    for (const o of opts) {
      const d = document.createElement('div');
      d.className = 'fe-crumb-item';
      d.textContent = o.label;
      d.title = o.path;
      d.addEventListener('click', async () => { saveCrumbMenu.classList.remove('show'); await loadSaveDir(o.path); });
      saveCrumbMenu.appendChild(d);
    }
  }
  saveCrumbBtn.addEventListener('click', (e) => { e.stopPropagation(); saveCrumbMenu.classList.toggle('show'); });
  document.addEventListener('click', () => saveCrumbMenu.classList.remove('show'));

  async function loadSaveDir(dir) {
    try {
      saveAsList.innerHTML = '<li class="fe-list-item"><span>Loading...</span></li>';
      const items = await fetchBrowse(dir);
      saveDirPath = dir;
      updateSaveCrumb(saveDirPath);
      saveDirItems = items;
      saveAsList.innerHTML = '';
      items.sort((a, b) => { if (a.type !== b.type) return a.type === 'directory' ? -1 : 1; return a.name.localeCompare(b.name); });
      for (const it of items) {
        const li = document.createElement('li');
        li.className = 'fe-list-item';
        const icon = it.type === 'directory' ? '📁' : '📄';
        li.innerHTML = `<span>${icon}</span><span class=\"fe-list-name\"></span><span class=\"fe-chip\">${it.type}</span>`;
        li.querySelector('.fe-list-name').textContent = it.name || it.path;
        li.addEventListener('click', async () => {
          if (it.type === 'directory') {
            await loadSaveDir(it.path);
          } else {
            // Prefill filename from selected file
            filenameInput.value = it.name || basename(it.path);
          }
        });
        saveAsList.appendChild(li);
      }
    } catch (e) {
      saveAsList.innerHTML = '';
      host.toast('Browse error: ' + e.message);
    }
  }
  async function doSaveAs() {
    const name = (filenameInput.value || '').trim();
    if (!name) { host.toast('Enter a filename'); filenameInput.focus(); return; }
    const path = joinPath(saveDirPath, name);
    const exists = (saveDirItems || []).some(it => it.type === 'file' && (it.name === name || basename(it.path) === name));
    if (exists) {
      const ok = window.confirm('File exists. Overwrite?');
      if (!ok) return;
    }
    statusEl.textContent = 'Saving...';
    try {
      await api.post('write', { path, content: editor.value });
      currentPath = path;
      currentPathExists = true;
      lastSavedContent = editor.value;
      setUnsaved(false);
      updatePathDisplay();
      persistState({ lastPath: currentPath, showLineNumbers });
      host.toast('Saved');
      statusEl.textContent = '';
      hideSaveAs();
    } catch (e) {
      statusEl.textContent = '';
      host.toast('Save failed: ' + e.message);
    }
  }

  // Event bindings
  btnBrowse.addEventListener('click', async () => {
    try {
      openDirPath = currentPath ? parentDir(currentPath) : '~';
      showOpenModal();
      await loadOpenDir(openDirPath);
    } catch (e) {
      hideOpenModal();
      host.toast('Browse failed: ' + e.message);
    }
  });
  modalClose.addEventListener('click', hideOpenModal);
  btnUp.addEventListener('click', () => { const up = parentDir(openDirPath); loadOpenDir(up); });
  modal.addEventListener('click', (e) => { if (e.target === modal) hideOpenModal(); });

  saveAsClose.addEventListener('click', hideSaveAs);
  saveAsUp.addEventListener('click', () => { const up = parentDir(saveDirPath); loadSaveDir(up); });
  saveAsModal.addEventListener('click', (e) => { if (e.target === saveAsModal) hideSaveAs(); });
  saveAsSaveBtn.addEventListener('click', doSaveAs);
  filenameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSaveAs(); } });

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
      openFile(state.lastPath).catch(() => { updatePathDisplay(); });
    } else {
      setEditorContent('', false);
      setUnsaved(false);
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
  miNew.addEventListener('click', () => { closeAllMenus(); if (unsaved) { showConfirm(); return; } currentPath = ''; currentPathExists = false; setEditorContent('', true); updatePathDisplay(); persistState({ lastPath: null, draft: '', showLineNumbers }); });
  miOpen.addEventListener('click', () => { closeAllMenus(); btnBrowse.click(); });
  miSave.addEventListener('click', () => { closeAllMenus(); saveFile(); });
  miSaveAs.addEventListener('click', () => { closeAllMenus(); showSaveAs(); });
  const miClose = container.querySelector('#mi-close');
  const miQuit = container.querySelector('#mi-quit');
  miClose.addEventListener('click', () => {
    closeAllMenus();
    currentPath = '';
    currentPathExists = false;
    setEditorContent('', true);
    updatePathDisplay();
    try { const cur = host.loadState({}) || {}; host.saveState({ ...cur, lastPath: null, draft: '' }); } catch (_) {}
  });
  miQuit.addEventListener('click', () => {
    closeAllMenus();
    try { host.clearState(); } catch (_) {}
    currentPath = '';
    currentPathExists = false;
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
    if (k === 's') { e.preventDefault(); if (e.shiftKey) { showSaveAs(); } else { saveFile(); } }
    else if (k === 'o') { e.preventDefault(); btnBrowse.click(); }
    else if (k === 'n') { e.preventDefault(); miNew.click(); }
    else if (k === 'y') { e.preventDefault(); try { document.execCommand('redo'); } catch (_) {} }
    else if (k === 'f') { e.preventDefault(); showFindBar(); }
    else if (k === 'l') { e.preventDefault(); showGoto(); }
  });

  // Global escape closes modals
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideOpenModal(); hideSaveAs(); hideConfirm(); closeAllMenus(); } });
}
