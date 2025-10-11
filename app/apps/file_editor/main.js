const ACE_BASE_URL = '/static/vendor/ace';
let aceLoaderPromise = null;

function loadAce() {
  if (window.ace) return Promise.resolve(window.ace);
  if (!aceLoaderPromise) {
    aceLoaderPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${ACE_BASE_URL}/ace.js`;
      script.onload = () => resolve(window.ace);
      script.onerror = () => reject(new Error('Failed to load Ace editor'));
      document.head.appendChild(script);
    });
  }
  return aceLoaderPromise;
}

function configureAceModules(ace) {
  const modules = {
    'ace/mode/javascript': 'mode-javascript.js',
    'ace/mode/json': 'mode-json.js',
    'ace/mode/css': 'mode-css.js',
    'ace/mode/html': 'mode-html.js',
    'ace/mode/markdown': 'mode-markdown.js',
    'ace/mode/python': 'mode-python.js',
    'ace/mode/xml': 'mode-xml.js',
    'ace/theme/terminal': 'theme-terminal.js',
    'ace/ext/language_tools': 'ext-language_tools.js',
    'ace/ext/searchbox': 'ext-searchbox.js',
  };
  Object.entries(modules).forEach(([id, file]) => {
    ace.config.setModuleUrl(id, `${ACE_BASE_URL}/${file}`);
  });
}

function detectLanguageFromFilename(filename) {
  if (!filename) return null;
  const parts = String(filename).toLowerCase().split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop();
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    json: 'json',
    css: 'css', scss: 'css', less: 'css',
    html: 'html', htm: 'html',
    md: 'markdown', markdown: 'markdown',
    py: 'python', pyw: 'python',
    xml: 'xml', svg: 'xml',
  };
  return map[ext] || null;
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

function toAbsolute(path, base, homeDir) {
  if (!path) return simplifyAbsolute(base || homeDir);
  let value = String(path).trim();
  if (!value) return simplifyAbsolute(base || homeDir);
  if (value === '~') return homeDir;
  if (value.startsWith('~/')) return simplifyAbsolute(`${homeDir}/${value.slice(2)}`);
  if (value.startsWith('/')) return simplifyAbsolute(value);
  const origin = toAbsolute(base || homeDir, null, homeDir);
  return simplifyAbsolute(`${origin.replace(/\/+$/, '')}/${value}`);
}

export default async function initFileEditor(container, api, host) {
  const ace = await loadAce();
  configureAceModules(ace);

  const HOME_DIR = '/data/data/com.termux/files/home';
  const HOME_PREFIX = `${HOME_DIR}/`;

  const requireEl = (selector, scope = container) => {
    const el = scope.querySelector(selector);
    if (!el) throw new Error(`File Editor missing element ${selector}`);
    return el;
  };

  const fileNameEl = requireEl('#fe-file-name');
  const filePathEl = requireEl('#fe-file-path');
  const btnBrowse = requireEl('#fe-browse');
  const editorHost = requireEl('#editor-container');
  const statusEl = requireEl('#fe-status');

  const menuFileBtn = requireEl('#menu-file-btn');
  const menuFileDD = requireEl('#menu-file-dd');
  const menuEditBtn = requireEl('#menu-edit-btn');
  const menuEditDD = requireEl('#menu-edit-dd');
  const menuViewBtn = requireEl('#menu-view-btn');
  const menuViewDD = requireEl('#menu-view-dd');

  const miNew = requireEl('#mi-new');
  const miOpen = requireEl('#mi-open');
  const miSave = requireEl('#mi-save');
  const miSaveAs = requireEl('#mi-saveas');
  const miClose = requireEl('#mi-close');
  const miQuit = requireEl('#mi-quit');

  const miUndo = requireEl('#mi-undo');
  const miRedo = requireEl('#mi-redo');
  const miCut = requireEl('#mi-cut');
  const miCopy = requireEl('#mi-copy');
  const miPaste = requireEl('#mi-paste');
  const miSelectAll = requireEl('#mi-selectall');

  const miToggleLines = requireEl('#mi-toggle-lines');
  const miToggleShading = requireEl('#mi-toggle-shading');
  const miToggleSyntax = requireEl('#mi-toggle-syntax');
  const miToggleWrap = requireEl('#mi-toggle-wrap');
  const miFind = requireEl('#mi-find');
  const miGoto = requireEl('#mi-goto');

  const confirmModal = requireEl('#fe-confirm');
  const confirmClose = requireEl('#fe-confirm-close');
  const btnDiscard = requireEl('#fe-discard');
  const btnSaveConfirm = requireEl('#fe-save-confirm');
  const btnCancel = requireEl('#fe-cancel');

  const editorEl = document.createElement('div');
  editorEl.className = 'fe-ace-editor';
  editorEl.style.width = '100%';
  editorEl.style.height = '100%';
  editorHost.innerHTML = '';
  editorHost.appendChild(editorEl);

  const editor = ace.edit(editorEl, {
    theme: 'ace/theme/terminal',
    mode: 'ace/mode/text',
    showPrintMargin: false,
    showGutter: true,
    highlightActiveLine: true,
    wrap: false,
  });

  editor.session.setUseWorker(false);
  editor.setOptions({
    enableLiveAutocompletion: false,
    enableBasicAutocompletion: false,
    fontSize: '14px',
  });

  const scroller = editor.renderer.scroller;
  scroller.style.touchAction = 'pan-x pan-y';
  scroller.style.webkitOverflowScrolling = 'touch';

  let currentPath = '';
  let currentMode = 'text';
  let currentModeLanguage = null;
  let currentPathExists = false;
  let lastSavedContent = '';
  let unsaved = false;
  let showLineNumbers = true;
  let showLineShading = false;
  let showSyntaxHighlight = true;
  let wordWrap = false;
  let lastPickerPath = HOME_DIR;
  let searchBoxReadyPromise = null;

  function persistState(patch) {
    try {
      const existing = host.loadState({}) || {};
      host.saveState({ ...existing, ...patch });
    } catch (_) {}
  }

  function showConfirm() {
    confirmModal.classList.add('show');
    confirmModal.setAttribute('aria-hidden', 'false');
  }

  function hideConfirm() {
    confirmModal.classList.remove('show');
    confirmModal.setAttribute('aria-hidden', 'true');
  }

  function persistPreferences(extra = {}) {
    persistState({
      lastPath: currentPath || null,
      draft: unsaved ? editor.getValue() : null,
      showLineNumbers,
      showLineShading,
      showSyntaxHighlight,
      wordWrap,
      ...extra,
    });
  }

  function setMenuChecked(element, checked) {
    if (!element) return;
    element.classList.toggle('fe-menu-item-checked', !!checked);
    element.setAttribute('aria-checked', checked ? 'true' : 'false');
  }

  function ensureSearchBoxLoaded() {
    if (searchBoxReadyPromise) return searchBoxReadyPromise;
    searchBoxReadyPromise = new Promise((resolve) => {
      try {
        ace.config.loadModule('ace/ext/searchbox', (searchbox) => {
          if (searchbox && typeof searchbox.Search === 'function') {
            searchbox.Search(editor);
          }
          resolve();
        });
      } catch (_) {
        resolve();
      }
    });
    return searchBoxReadyPromise;
  }

  function parentDir(path) {
    const abs = toAbsolute(path || HOME_DIR, null, HOME_DIR);
    if (abs === '/' || abs === '') return '/';
    if (abs === HOME_DIR) return '/';
    const trimmed = abs.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    if (idx <= 0) return '/';
    return trimmed.slice(0, idx) || '/';
  }

  function basename(path) {
    const abs = toAbsolute(path || HOME_DIR, null, HOME_DIR);
    if (abs === '/') return '/';
    const parts = abs.split('/');
    return parts[parts.length - 1] || '/';
  }

  function formatDisplayPath(path) {
    const abs = toAbsolute(path || HOME_DIR, null, HOME_DIR);
    if (abs === HOME_DIR) return '~';
    if (abs.startsWith(HOME_PREFIX)) return `~/${abs.slice(HOME_PREFIX.length)}`;
    return abs;
  }

  function setUnsaved(flag) {
    unsaved = !!flag;
    host.setTitle('Text Editor');
    fileNameEl.classList.toggle('fe-unsaved', unsaved);
    statusEl.textContent = unsaved ? 'Unsaved changes' : '';
  }

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

  function updateLineNumbers() {
    editor.renderer.setShowGutter(showLineNumbers);
  }

  function updateLineShading() {
    editorEl.classList.toggle('fe-ace-line-shading', showLineShading);
  }

  function updateWordWrap() {
    editor.session.setUseWrapMode(wordWrap);
    editor.renderer.updateFull();
  }

  function updateSyntaxMode() {
    const mode = showSyntaxHighlight ? currentMode : 'text';
    editor.session.setMode(`ace/mode/${mode}`);
  }

  function setEditorContent(value, markSaved = false) {
    const content = value != null ? value : '';
    editor.setValue(content, -1);
    if (markSaved) {
      lastSavedContent = content;
      setUnsaved(false);
    } else {
      setUnsaved(content !== lastSavedContent);
    }
  }

  function getEditorContent() {
    return editor.getValue();
  }

  async function openFile(path) {
    if (!path) throw new Error('Path is empty');
    statusEl.textContent = 'Opening...';
    try {
      const payload = await api.get(`read?path=${encodeURIComponent(path)}`);
      const resolved = toAbsolute(payload.path || path, null, HOME_DIR);
      currentPath = resolved;
      currentPathExists = true;
      lastPickerPath = parentDir(resolved);
      currentModeLanguage = detectLanguageFromFilename(resolved);
      currentMode = currentModeLanguage || 'text';
      updateSyntaxMode();
      setEditorContent(payload.content || '', true);
      updatePathDisplay();
      persistPreferences({ lastPath: currentPath, draft: null });
      statusEl.textContent = '';
      editor.focus();
    } catch (error) {
      statusEl.textContent = '';
      host.toast(`Failed to open: ${error.message}`);
      throw error;
    }
  }

  async function saveFile() {
    if (!currentPath || !currentPathExists) {
      await saveAsDialog();
      return;
    }
    statusEl.textContent = 'Saving...';
    try {
      const content = getEditorContent();
      await api.post('write', { path: currentPath, content });
      lastSavedContent = content;
      setUnsaved(false);
      persistPreferences({ lastPath: currentPath });
      host.toast('Saved');
      statusEl.textContent = '';
    } catch (error) {
      statusEl.textContent = '';
      host.toast(`Save failed: ${error.message}`);
    }
  }

  async function saveAsDialog() {
    const target = await pickSaveTarget();
    if (!target || !target.path) return;
    if (target.existed && !window.confirm('File exists. Overwrite?')) return;
    statusEl.textContent = 'Saving...';
    try {
      const content = getEditorContent();
      await api.post('write', { path: target.path, content });
      currentPath = toAbsolute(target.path, null, HOME_DIR);
      currentPathExists = true;
      lastPickerPath = parentDir(currentPath);
      lastSavedContent = content;
      currentModeLanguage = detectLanguageFromFilename(currentPath);
      currentMode = currentModeLanguage || currentMode;
      updateSyntaxMode();
      setUnsaved(false);
      updatePathDisplay();
      persistPreferences({ lastPath: currentPath });
      host.toast('Saved');
    } catch (error) {
      host.toast(`Save failed: ${error.message}`);
    } finally {
      statusEl.textContent = '';
    }
  }

  function pickerAvailable() {
    return window.teFilePicker && typeof window.teFilePicker.openFile === 'function';
  }

  async function pickFile(startPath) {
    if (!pickerAvailable()) {
      host.toast('File picker unavailable');
      return null;
    }
    const baseStart = startPath || (currentPath ? parentDir(currentPath) : lastPickerPath);
    const initial = toAbsolute(baseStart, null, HOME_DIR);
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
    } catch (error) {
      if (error && error.message === 'cancelled') return null;
      host.toast(error?.message || 'Browse failed');
      return null;
    }
  }

  async function pickSaveTarget() {
    if (!pickerAvailable()) {
      host.toast('File picker unavailable');
      return null;
    }
    const baseDir = currentPath ? parentDir(currentPath) : lastPickerPath;
    const initialDir = toAbsolute(baseDir, null, HOME_DIR);
    try {
      const result = await window.teFilePicker.saveFile({
        title: 'Save As',
        startPath: initialDir,
        filename: currentPath ? basename(currentPath) : '',
        selectLabel: 'Save',
      });
      return result || null;
    } catch (error) {
      if (error && error.message === 'cancelled') return null;
      host.toast(error?.message || 'Save cancelled');
      return null;
    }
  }

  function closeAllMenus() {
    menuFileDD.classList.remove('show');
    menuEditDD.classList.remove('show');
    menuViewDD.classList.remove('show');
  }

  function focusEditor() {
    editor.focus();
  }

  function bindMenuToggle(element, action) {
    if (!element) return;
    const run = () => {
      closeAllMenus();
      action();
    };
    element.addEventListener('click', run);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        run();
      }
    });
  }

  btnBrowse.addEventListener('click', async () => {
    const path = await pickFile();
    if (path) {
      try {
        await openFile(path);
      } catch (error) {
        host.toast(`Failed to open file: ${error.message}`);
      }
    }
  });

  window.addEventListener('resize', () => {
    editor.resize();
  });

  editor.session.on('change', () => {
    setUnsaved(editor.getValue() !== lastSavedContent);
  });

  host.onBeforeExit(() => {
    if (unsaved) {
      showConfirm();
      host.toast('Unsaved changes — Save or Discard before leaving.');
      return { cancel: true };
    }
    return {
      lastPath: currentPath || null,
      draft: getEditorContent(),
      showLineNumbers,
      showLineShading,
      showSyntaxHighlight,
      wordWrap,
    };
  });

  menuFileBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = menuFileDD.classList.toggle('show');
    if (open) {
      menuEditDD.classList.remove('show');
      menuViewDD.classList.remove('show');
    }
  });

  menuEditBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = menuEditDD.classList.toggle('show');
    if (open) {
      menuFileDD.classList.remove('show');
      menuViewDD.classList.remove('show');
    }
  });

  menuViewBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = menuViewDD.classList.toggle('show');
    if (open) {
      menuFileDD.classList.remove('show');
      menuEditDD.classList.remove('show');
    }
  });

  document.addEventListener('click', () => closeAllMenus());

  miNew.addEventListener('click', () => {
    closeAllMenus();
    if (unsaved) {
      showConfirm();
      return;
    }
    currentPath = '';
    currentPathExists = false;
    lastPickerPath = HOME_DIR;
    currentModeLanguage = null;
    currentMode = 'text';
    updateSyntaxMode();
    setEditorContent('', true);
    updatePathDisplay();
    persistPreferences({ lastPath: null, draft: '' });
  });

  miOpen.addEventListener('click', () => { closeAllMenus(); btnBrowse.click(); });
  miSave.addEventListener('click', () => { closeAllMenus(); saveFile(); });
  miSaveAs.addEventListener('click', () => { closeAllMenus(); saveAsDialog(); });

  miClose.addEventListener('click', () => {
    closeAllMenus();
    currentPath = '';
    currentPathExists = false;
    lastPickerPath = HOME_DIR;
    currentModeLanguage = null;
    currentMode = 'text';
    updateSyntaxMode();
    setEditorContent('', true);
    updatePathDisplay();
    persistPreferences({ lastPath: null, draft: '' });
  });

  miQuit.addEventListener('click', () => {
    closeAllMenus();
    try { host.clearState(); } catch (_) {}
    currentPath = '';
    currentPathExists = false;
    lastPickerPath = HOME_DIR;
    currentModeLanguage = null;
    currentMode = 'text';
    updateSyntaxMode();
    setEditorContent('', true);
    updatePathDisplay();
  });

  miUndo.addEventListener('click', () => { closeAllMenus(); editor.undo(); });
  miRedo.addEventListener('click', () => { closeAllMenus(); editor.redo(); });
  miCut.addEventListener('click', () => { closeAllMenus(); editor.execCommand('cut'); });
  miCopy.addEventListener('click', () => { closeAllMenus(); editor.execCommand('copy'); });
  miPaste.addEventListener('click', async () => {
    closeAllMenus();
    try {
      const text = await navigator.clipboard?.readText?.();
      if (text != null) {
        editor.insert(text);
        return;
      }
    } catch (_) {}
    document.execCommand('paste');
  });
  miSelectAll.addEventListener('click', () => { closeAllMenus(); editor.execCommand('selectall'); });

  bindMenuToggle(miToggleLines, () => {
    showLineNumbers = !showLineNumbers;
    updateLineNumbers();
    setMenuChecked(miToggleLines, showLineNumbers);
    persistPreferences();
  });

  bindMenuToggle(miToggleShading, () => {
    showLineShading = !showLineShading;
    updateLineShading();
    setMenuChecked(miToggleShading, showLineShading);
    persistPreferences();
  });

  bindMenuToggle(miToggleSyntax, () => {
    showSyntaxHighlight = !showSyntaxHighlight;
    updateSyntaxMode();
    setMenuChecked(miToggleSyntax, showSyntaxHighlight);
    persistPreferences();
  });

  bindMenuToggle(miToggleWrap, () => {
    wordWrap = !wordWrap;
    updateWordWrap();
    setMenuChecked(miToggleWrap, wordWrap);
    persistPreferences();
  });

  miFind.addEventListener('click', () => {
    closeAllMenus();
    ensureSearchBoxLoaded().then(() => {
      editor.execCommand('toggleSearchBox');
      editor.focus();
    });
  });

  editor.commands.removeCommand('find');
  editor.commands.removeCommand('replace');

  editor.commands.addCommand({
    name: 'te-open-searchbox',
    bindKey: { win: 'Ctrl-F', mac: 'Command-F' },
    exec(ed) {
      ensureSearchBoxLoaded().then(() => {
        ed.execCommand('toggleSearchBox');
      });
    },
  });

  editor.commands.addCommand({
    name: 'te-open-searchbox-replace',
    bindKey: { win: 'Ctrl-H', mac: 'Command-Option-F' },
    exec(ed) {
      ensureSearchBoxLoaded().then(() => {
        ed.execCommand('toggleSearchBox');
      });
    },
  });

  miGoto.addEventListener('click', () => {
    closeAllMenus();
    const input = window.prompt('Go to line');
    if (!input) return;
    const line = Number.parseInt(input, 10);
    if (Number.isNaN(line)) {
      host.toast('Invalid line number');
      return;
    }
    editor.gotoLine(Math.max(line, 1), 0, true);
    editor.focus();
  });

  confirmClose.addEventListener('click', hideConfirm);
  btnCancel.addEventListener('click', hideConfirm);
  btnDiscard.addEventListener('click', () => {
    hideConfirm();
    setUnsaved(false);
    host.requestExit();
  });
  btnSaveConfirm.addEventListener('click', async () => {
    await saveFile();
    hideConfirm();
    host.requestExit();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideConfirm();
      closeAllMenus();
    }
  });

  host.setTitle('Text Editor');
  const state = host.loadState({
    lastPath: null,
    draft: null,
    showLineNumbers: true,
    showLineShading: false,
    showSyntaxHighlight: true,
    wordWrap: false,
  }) || {};

  showLineNumbers = state.showLineNumbers !== false;
  showLineShading = !!state.showLineShading;
  showSyntaxHighlight = state.showSyntaxHighlight !== false;
  wordWrap = !!state.wordWrap;

  updateLineNumbers();
  updateLineShading();
  updateWordWrap();
  setMenuChecked(miToggleLines, showLineNumbers);
  setMenuChecked(miToggleShading, showLineShading);
  setMenuChecked(miToggleSyntax, showSyntaxHighlight);
  setMenuChecked(miToggleWrap, wordWrap);

  const params = new URLSearchParams(window.location.search);
  const fileFromUrl = params.get('file');

  if (fileFromUrl) {
    const abs = toAbsolute(fileFromUrl, null, HOME_DIR);
    lastPickerPath = parentDir(abs);
    openFile(abs).catch((error) => {
      host.toast(`Failed to open file: ${error.message}`);
      currentPath = '';
      currentPathExists = false;
      setEditorContent('', false);
      setUnsaved(false);
      updatePathDisplay();
    });
    return;
  }

  if (state.draft) {
    currentPath = state.lastPath ? toAbsolute(state.lastPath, null, HOME_DIR) : '';
    currentPathExists = false;
    currentModeLanguage = currentPath ? detectLanguageFromFilename(currentPath) : null;
    currentMode = currentModeLanguage || 'text';
    updateSyntaxMode();
    setEditorContent(state.draft, false);
    setUnsaved(true);
    updatePathDisplay();
    return;
  }

  if (state.lastPath) {
    const abs = toAbsolute(state.lastPath, null, HOME_DIR);
    lastPickerPath = parentDir(abs);
    openFile(abs).catch(() => {
      currentPath = abs;
      currentPathExists = false;
      currentModeLanguage = detectLanguageFromFilename(abs);
      currentMode = currentModeLanguage || 'text';
      updateSyntaxMode();
      setEditorContent('', false);
      updatePathDisplay();
    });
    return;
  }

  setEditorContent('', false);
  updatePathDisplay();
}
