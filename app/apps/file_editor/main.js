// Import CodeMirror bundle
import * as CM from '/static/vendor/codemirror/codemirror.bundle.js';

export default function (container, api, host) {
  console.log('File Editor app init with CodeMirror v20241211');

  const HOME_DIR = '/data/data/com.termux/files/home';
  const HOME_PREFIX = HOME_DIR + '/';

  const requireEl = (selector, scope = container) => {
    const el = scope.querySelector(selector);
    if (!el) throw new Error(`File Editor missing element ${selector}`);
    return el;
  };

  const fileNameEl = requireEl('#fe-file-name');
  const filePathEl = requireEl('#fe-file-path');
  const btnBrowse = requireEl('#fe-browse');
  const editorContainer = requireEl('#editor-container');
  const statusEl = requireEl('#fe-status');
  const horizontalScrollbar = requireEl('#fe-scrollbar');
  const horizontalScrollbarInner = requireEl('#fe-scrollbar-inner');
  
  // CodeMirror instance and state
  let editor = null;
  let searchPanel = null;

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

  // View menu UI
  const menuViewBtn = requireEl('#menu-view-btn');
  const menuViewDD = requireEl('#menu-view-dd');
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

  // State
  let currentPath = '';
  let currentPathExists = false;
  let lastSavedContent = '';
  let unsaved = false;
  let showLineNumbers = true;
  let showLineShading = false;
  let showSyntaxHighlight = true;
  let wordWrap = false;
  let lastPickerPath = HOME_DIR;
  let languageCompartment = null;
  let lineNumberCompartment = null;
  let syntaxCompartment = null;
  let wrapCompartment = null;
  let isSyncingHorizontal = false;

  // State helpers
  function persistState(patch) {
    try {
      const cur = host.loadState({}) || {};
      host.saveState({ ...cur, ...patch });
    } catch (_) {}
  }

  function persistPreferences(extra = {}) {
    persistState({
      showLineNumbers,
      showLineShading,
      showSyntaxHighlight,
      wordWrap,
      ...extra,
    });
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

  // Initialize CodeMirror editor
  function initCodeMirror() {
    // Create compartments for dynamic configuration
    languageCompartment = new CM.Compartment();
    lineNumberCompartment = new CM.Compartment();
    syntaxCompartment = new CM.Compartment();
    wrapCompartment = new CM.Compartment();

    // Basic extensions that are always active
    const basicExtensions = [
      CM.history(),
      CM.drawSelection(),
      CM.dropCursor(),
      CM.indentOnInput(),
      CM.bracketMatching(),
      CM.highlightActiveLine(),
      CM.highlightActiveLineGutter(),
      CM.highlightSelectionMatches(),
      CM.keymap.of([
        ...CM.defaultKeymap,
        ...CM.historyKeymap,
        ...CM.searchKeymap,
        { key: 'Tab', run: CM.indentWithTab },
        { key: 'Mod-s', run: () => { saveFile(); return true; }, preventDefault: true },
        { key: 'Mod-Shift-s', run: () => { saveAsDialog(); return true; }, preventDefault: true },
        { key: 'Mod-o', run: () => { btnBrowse.click(); return true; }, preventDefault: true },
        { key: 'Mod-n', run: () => { miNew.click(); return true; }, preventDefault: true },
        { key: 'Mod-f', run: CM.openSearchPanel, preventDefault: true },
        { key: 'Mod-g', run: CM.gotoLine, preventDefault: true },
        { key: 'Escape', run: () => {
          if (CM.searchPanelOpen(editor.state)) {
            CM.closeSearchPanel(editor);
            return true;
          }
          return false;
        }}
      ]),
      CM.search(),
      CM.EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const content = editor.state.doc.toString();
          setUnsaved(content !== lastSavedContent);
          updateStateDebounced();
        }
        if (update.docChanged || update.viewportChanged || update.geometryChanged) {
          requestAnimationFrame(updateHorizontalScrollbar);
        }
      }),
      languageCompartment.of([]),
      lineNumberCompartment.of(showLineNumbers ? CM.lineNumbers() : []),
      syntaxCompartment.of(showSyntaxHighlight ? CM.syntaxHighlighting(CM.defaultHighlightStyle) : []),
      wrapCompartment.of(wordWrap ? CM.EditorView.lineWrapping : []),
      CM.termuxTheme()
    ];

    // Create the editor state
    const state = CM.EditorState.create({
      doc: '',
      extensions: basicExtensions
    });

    // Create the editor view
    editor = new CM.EditorView({
      state,
      parent: editorContainer
    });

    if (editor && editor.scrollDOM) {
      const scroller = editor.scrollDOM;
      scroller.style.touchAction = 'pan-x pan-y';
      scroller.style.overscrollBehavior = 'contain';
      scroller.style.overflow = 'auto';
      scroller.style.webkitOverflowScrolling = 'touch';
      scroller.addEventListener('scroll', () => {
        if (isSyncingHorizontal || wordWrap) return;
        syncScrollbarFromEditor();
      }, { passive: true });
    }

    if (horizontalScrollbar) {
      horizontalScrollbar.addEventListener('scroll', () => {
        if (isSyncingHorizontal || wordWrap) return;
        syncEditorFromScrollbar();
      }, { passive: true });
    }

    updateHorizontalScrollbar();
  }

  // Get language support for a file
  function getLanguageSupport(filename) {
    const lang = CM.detectLanguage(filename);
    if (!lang) return [];

    const langMap = {
      javascript: CM.javascript,
      json: CM.json,
      css: CM.css,
      html: CM.html,
      markdown: CM.markdown,
      python: CM.python,
      xml: CM.xml,
    };

    const langSupport = langMap[lang];
    return langSupport ? langSupport() : [];
  }

  function setUnsaved(flag) {
    unsaved = !!flag;
    host.setTitle('Text Editor');
    fileNameEl.classList.toggle('fe-unsaved', unsaved);
  }
  
  function setEditorContent(value, markSaved = false) {
    if (!editor) return;
    const content = value != null ? value : '';
    
    // Update the editor content
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: content
      }
    });
    updateHorizontalScrollbar();
    
    if (markSaved) {
      lastSavedContent = content;
      setUnsaved(false);
    } else {
      setUnsaved(content !== lastSavedContent);
    }
  }
  
  function getEditorContent() {
    return editor ? editor.state.doc.toString() : '';
  }
  
  function updateStateDebounced() {
    if (updateStateDebounced._t) clearTimeout(updateStateDebounced._t);
    updateStateDebounced._t = setTimeout(() => {
      try { 
        const content = getEditorContent();
        persistPreferences({ lastPath: currentPath || null, draft: content }); 
      } catch (_) {}
    }, 400);
  }
  function updatePathDisplay() {
    if (!currentPath) {
      fileNameEl.textContent = 'Untitled';
      fileNameEl.title = 'Untitled';
      filePathEl.textContent = 'No file open';
      filePathEl.title = '';
      return;
    }
    const abs = toAbsolute(currentPath, HOME_DIR);
    const displayPath = formatDisplayPath(abs);
    fileNameEl.textContent = basename(abs);
    fileNameEl.title = basename(abs);
    filePathEl.textContent = displayPath;
    filePathEl.title = abs;
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
      
      // Update language support based on file extension
      const langSupport = getLanguageSupport(currentPath);
      editor.dispatch({
        effects: languageCompartment.reconfigure(langSupport)
      });
      
      persistPreferences({ lastPath: currentPath, draft: null });
      updatePathDisplay();
      updateHorizontalScrollbar();
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
      const content = getEditorContent();
      await api.post('write', { path: currentPath, content });
      lastSavedContent = content;
      setUnsaved(false);
      persistPreferences({ lastPath: currentPath });
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
      const content = getEditorContent();
      await api.post('write', { path: target.path, content });
      currentPath = target.path;
      currentPathExists = true;
      lastPickerPath = parentDir(currentPath);
      lastSavedContent = content;
      setUnsaved(false);
      updatePathDisplay();
      updateHorizontalScrollbar();
      
      // Update language support for new file
      const langSupport = getLanguageSupport(currentPath);
      editor.dispatch({
        effects: languageCompartment.reconfigure(langSupport)
      });
      
      persistPreferences({ lastPath: currentPath });
      host.toast('Saved');
    } catch (e) {
      host.toast('Save failed: ' + e.message);
    } finally {
      statusEl.textContent = '';
      updateHorizontalScrollbar();
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
  // Window resize handler if needed
window.addEventListener('resize', () => {
  if (editor) {
    editor.requestMeasure();
    updateHorizontalScrollbar();
  }
});

  // Before exit handler
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
      wordWrap
    };
  });

  // Initialization
  (function init() {
    host.setTitle('Text Editor');
    
    // Initialize CodeMirror
    initCodeMirror();
    
    const state = host.loadState({ 
      lastPath: null, 
      draft: null, 
      showLineNumbers: true,
      showLineShading: false,
      showSyntaxHighlight: true,
      wordWrap: false
    }) || { 
      lastPath: null, 
      draft: null, 
      showLineNumbers: true,
      showLineShading: false,
      showSyntaxHighlight: true,
      wordWrap: false
    };
    
    showLineNumbers = state.showLineNumbers !== false;
    showLineShading = !!state.showLineShading;
    showSyntaxHighlight = state.showSyntaxHighlight !== false;
    wordWrap = !!state.wordWrap;
    
    setShowLineNumbers(showLineNumbers);
    setLineShading(showLineShading);
    setSyntaxHighlighting(showSyntaxHighlight);
    setWordWrap(wordWrap);
    
    // Check for file parameter in URL (from file-explorer or direct link)
    const urlParams = new URLSearchParams(window.location.search);
    const fileFromUrl = urlParams.get('file');
    
    if (fileFromUrl) {
      // Priority 1: Load file from URL parameter
      const abs = toAbsolute(fileFromUrl, HOME_DIR);
      lastPickerPath = parentDir(abs);
      openFile(abs).catch((e) => {
        host.toast('Failed to open file: ' + e.message);
        currentPath = '';
        updatePathDisplay();
        // Fall back to empty editor if file can't be opened
        setEditorContent('', false);
        setUnsaved(false);
      });
    } else if (state.draft) {
      // Priority 2: Restore unsaved draft
      setEditorContent(state.draft, false);
      setUnsaved(true);
      if (state.lastPath) {
        currentPath = toAbsolute(state.lastPath, HOME_DIR);
        currentPathExists = false; // Draft may not match saved file
        updatePathDisplay();
        
        // Set language support based on last path
        const langSupport = getLanguageSupport(currentPath);
        editor.dispatch({
          effects: languageCompartment.reconfigure(langSupport)
        });
      }
    } else if (state.lastPath) {
      // Priority 3: Reopen last file
      const abs = toAbsolute(state.lastPath, HOME_DIR);
      lastPickerPath = parentDir(abs);
      openFile(abs).catch(() => { 
        currentPath = abs; 
        updatePathDisplay(); 
      });
    } else {
      // Priority 4: Start with empty editor
      setEditorContent('', false);
      setUnsaved(false);
      lastPickerPath = HOME_DIR;
      updatePathDisplay();
    }
  })();

  // Menu behavior
  function closeAllMenus() { 
    menuFileDD.classList.remove('show'); 
    menuEditDD.classList.remove('show'); 
    menuViewDD.classList.remove('show');
  }
  menuFileBtn.addEventListener('click', (e) => { 
    e.stopPropagation(); 
    const s = menuFileDD.classList.toggle('show'); 
    if (s) {
      menuEditDD.classList.remove('show');
      menuViewDD.classList.remove('show');
    }
  });
  menuEditBtn.addEventListener('click', (e) => { 
    e.stopPropagation(); 
    const s = menuEditDD.classList.toggle('show'); 
    if (s) {
      menuFileDD.classList.remove('show');
      menuViewDD.classList.remove('show');
    }
  });
  document.addEventListener('click', () => closeAllMenus());

  // Menu actions
  function focusEditor() { 
    if (editor) editor.focus(); 
  }
  miNew.addEventListener('click', () => {
    closeAllMenus();
    if (unsaved) { showConfirm(); return; }
    currentPath = '';
    currentPathExists = false;
    lastPickerPath = HOME_DIR;
    setEditorContent('', true);
    updatePathDisplay();
    updateHorizontalScrollbar();
    persistPreferences({ lastPath: null, draft: '' });
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
    updateHorizontalScrollbar();
    persistPreferences({ lastPath: null, draft: '' });
  });
  miQuit.addEventListener('click', () => {
    closeAllMenus();
    try { host.clearState(); } catch (_) {}
    currentPath = '';
    currentPathExists = false;
    lastPickerPath = HOME_DIR;
    setEditorContent('', true);
    updatePathDisplay();
    updateHorizontalScrollbar();
    if (editor) {
      editor.scrollDOM.scrollTop = 0;
    }
  });
  miUndo.addEventListener('click', () => { 
    closeAllMenus(); 
    focusEditor(); 
    CM.undo(editor);
  });
  miRedo.addEventListener('click', () => { 
    closeAllMenus(); 
    focusEditor(); 
    CM.redo(editor);
  });
  miCut.addEventListener('click', () => { 
    closeAllMenus(); 
    focusEditor(); 
    document.execCommand('cut');
  });
  miCopy.addEventListener('click', () => { 
    closeAllMenus(); 
    focusEditor(); 
    document.execCommand('copy');
  });
  miPaste.addEventListener('click', async () => { 
    closeAllMenus(); 
    focusEditor(); 
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        editor.dispatch(editor.state.replaceSelection(text));
      } else {
        document.execCommand('paste');
      }
    } catch (e) { 
      host.toast('Paste failed: ' + e.message); 
    }
  });
  miSelectAll.addEventListener('click', () => { 
    closeAllMenus(); 
    focusEditor(); 
    CM.selectAll(editor);
  });

  // View menu behavior
  menuViewBtn.addEventListener('click', (e) => { 
    e.stopPropagation(); 
    const s = menuViewDD.classList.toggle('show'); 
    if (s) { 
      menuFileDD.classList.remove('show'); 
      menuEditDD.classList.remove('show'); 
    } 
  });
  
  const closeMenusDoc = () => { menuViewDD.classList.remove('show'); };
  document.addEventListener('click', closeMenusDoc);
  
  function setShowLineNumbers(show) {
    showLineNumbers = !!show;
    if (editor) {
      editor.dispatch({
        effects: lineNumberCompartment.reconfigure(showLineNumbers ? CM.lineNumbers() : [])
      });
    }
    updateViewMenuState();
  }

  function setLineShading(show) {
    showLineShading = !!show;
    if (editor) {
      const editorDom = editor.dom;
      if (showLineShading) {
        editorDom.classList.add('line-shading');
      } else {
        editorDom.classList.remove('line-shading');
      }
    }
    updateViewMenuState();
  }

  function setSyntaxHighlighting(show) {
    showSyntaxHighlight = !!show;
    if (editor) {
      editor.dispatch({
        effects: syntaxCompartment.reconfigure(
          showSyntaxHighlight ? CM.syntaxHighlighting(CM.defaultHighlightStyle) : []
        )
      });
    }
    updateViewMenuState();
  }

  function setWordWrap(wrap) {
    wordWrap = !!wrap;
    if (editor) {
      editor.dispatch({
        effects: wrapCompartment.reconfigure(
          wordWrap ? CM.EditorView.lineWrapping : []
        )
      });
      if (wordWrap) {
        editor.scrollDOM.scrollLeft = 0;
      }
    }
    updateViewMenuState();
    updateHorizontalScrollbar();
  }

  function setMenuItemChecked(item, active) {
    if (!item) return;
    item.classList.toggle('fe-menu-item-checked', !!active);
    if (item.hasAttribute('aria-checked')) {
      item.setAttribute('aria-checked', active ? 'true' : 'false');
    }
  }

  function updateViewMenuState() {
    setMenuItemChecked(miToggleLines, showLineNumbers);
    setMenuItemChecked(miToggleShading, showLineShading);
    setMenuItemChecked(miToggleSyntax, showSyntaxHighlight);
    setMenuItemChecked(miToggleWrap, wordWrap);
  }

  function updateHorizontalScrollbar() {
    if (!horizontalScrollbar || !horizontalScrollbarInner || !editor) return;
    const scroller = editor.scrollDOM;
    const needsScrollbar = !wordWrap && scroller.scrollWidth > scroller.clientWidth + 1;
    horizontalScrollbar.hidden = !needsScrollbar;
    horizontalScrollbar.style.display = needsScrollbar ? 'block' : 'none';
    if (!needsScrollbar) {
      horizontalScrollbarInner.style.width = '0px';
      horizontalScrollbar.scrollLeft = 0;
      return;
    }
    horizontalScrollbarInner.style.width = `${scroller.scrollWidth}px`;
    if (!isSyncingHorizontal) {
      isSyncingHorizontal = true;
      horizontalScrollbar.scrollLeft = scroller.scrollLeft;
      isSyncingHorizontal = false;
    }
  }

  function syncScrollbarFromEditor() {
    if (!horizontalScrollbar || horizontalScrollbar.hidden || !editor) return;
    const scroller = editor.scrollDOM;
    const target = scroller.scrollLeft;
    if (Math.abs(horizontalScrollbar.scrollLeft - target) <= 1) return;
    isSyncingHorizontal = true;
    horizontalScrollbar.scrollLeft = target;
    isSyncingHorizontal = false;
  }

  function syncEditorFromScrollbar() {
    if (!horizontalScrollbar || horizontalScrollbar.hidden || !editor) return;
    const scroller = editor.scrollDOM;
    const target = horizontalScrollbar.scrollLeft;
    if (Math.abs(scroller.scrollLeft - target) <= 1) return;
    isSyncingHorizontal = true;
    scroller.scrollLeft = target;
    isSyncingHorizontal = false;
  }

  function bindMenuToggle(element, action) {
    if (!element) return;
    const handler = () => {
      closeAllMenus();
      action();
    };
    element.addEventListener('click', handler);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handler();
      }
    });
  }
  
  bindMenuToggle(miToggleLines, () => {
    setShowLineNumbers(!showLineNumbers);
    persistPreferences();
  });
  
  bindMenuToggle(miToggleShading, () => {
    setLineShading(!showLineShading);
    persistPreferences();
  });
  
  bindMenuToggle(miToggleSyntax, () => {
    setSyntaxHighlighting(!showSyntaxHighlight);
    persistPreferences();
  });
  
  bindMenuToggle(miToggleWrap, () => {
    setWordWrap(!wordWrap);
    persistPreferences();
  });
  
  miFind.addEventListener('click', () => { 
    closeAllMenus(); 
    if (editor) CM.openSearchPanel(editor);
  });
  
  miGoto.addEventListener('click', () => { 
    closeAllMenus(); 
    if (editor) CM.gotoLine(editor);
  });

  // Confirm modal actions
  confirmClose.addEventListener('click', hideConfirm);
  btnCancel.addEventListener('click', hideConfirm);
  btnDiscard.addEventListener('click', () => { hideConfirm(); setUnsaved(false); });
  btnSaveConfirm.addEventListener('click', async () => { await saveFile(); hideConfirm(); });

  // Global escape closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideConfirm();
      closeAllMenus();
    }
  });
}
