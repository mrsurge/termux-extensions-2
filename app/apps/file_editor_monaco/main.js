// Monaco + EditContext variant
const MONACO_BASE_URL = '/static/vendor/monaco';

function injectMonacoCSS() {
  const href = `${MONACO_BASE_URL}/vs/editor/editor.main.css`;
  if (![...document.styleSheets].some(s => s.href && s.href.includes('/vs/editor/editor.main.css'))) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
}

let monacoReady;
function loadMonaco() {
  if (window.monaco) return Promise.resolve(window.monaco);
  if (!monacoReady) {
    injectMonacoCSS();
    monacoReady = new Promise((resolve, reject) => {
      const loader = document.createElement('script');
      loader.src = `${MONACO_BASE_URL}/vs/loader.js`;
      loader.onload = () => {
        window.require.config({ paths: { 'vs': `${MONACO_BASE_URL}/vs` } });
        window.require(['vs/editor/editor.main'], () => resolve(window.monaco));
      };
      loader.onerror = () => reject(new Error('Failed to load monaco loader'));
      document.head.appendChild(loader);
    });
  }
  return monacoReady;
}

function detectLanguageFromFilename(filename) {
  if (!filename) return null;
  const parts = String(filename).toLowerCase().split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop();
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    json: 'json', css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html',
    md: 'markdown', markdown: 'markdown', py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', xml: 'xml', svg: 'xml'
  };
  return map[ext] || null;
}

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
  const monaco = await loadMonaco();

  const HOME_DIR = '/data/data/com.termux/files/home';
  const HOME_PREFIX = `${HOME_DIR}/`;
  const requireEl = (sel, scope = container) => { const el = scope.querySelector(sel); if (!el) throw new Error(`Missing ${sel}`); return el; };

  const fileNameEl = requireEl('#fe-file-name');
  const filePathEl = requireEl('#fe-file-path');
  const btnBrowse = requireEl('#fe-browse');
  const editorHost = requireEl('#editor-container');
  const statusEl = requireEl('#fe-status');

  const menuFileBtn = requireEl('#menu-file-btn');
  const menuFileDD  = requireEl('#menu-file-dd');
  const menuEditBtn = requireEl('#menu-edit-btn');
  const menuEditDD  = requireEl('#menu-edit-dd');
  const menuViewBtn = requireEl('#menu-view-btn');
  const menuViewDD  = requireEl('#menu-view-dd');
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

  // Editor host
  const editorEl = document.createElement('div');
  editorEl.style.width = '100%';
  editorEl.style.height = '100%';
  editorHost.innerHTML = '';
  editorHost.appendChild(editorEl);

  // Detect EditContext support
  const supportsEC = !!(window.EditContext) || ('editContext' in document.documentElement);

  const model = monaco.editor.createModel('', 'plaintext');
  const editor = monaco.editor.create(editorEl, {
    model,
    readOnly: false,
    automaticLayout: true,
    theme: 'vs-dark',
    lineNumbers: 'on',
    wordWrap: 'off',
    minimap: { enabled: false },
    padding: { top: 6, bottom: 6 },
    scrollBeyondLastLine: false,
    editContext: supportsEC // <-- Enable EditContext when available
  });

  // State
  let currentPath = '';
  let currentLang = 'plaintext';
  let currentPathExists = false;
  let lastSavedContent = '';
  let unsaved = false;
  let showLineNumbers = true;
  let showLineShading = false;
  let showSyntaxHighlight = true;
  let wordWrap = false;
  let lastPickerPath = HOME_DIR;

  function setMenuChecked(el, checked) { el.classList.toggle('fe-menu-item-checked', !!checked); el.setAttribute('aria-checked', checked ? 'true' : 'false'); }
  function setUnsaved(flag){ unsaved = !!flag; fileNameEl.classList.toggle('fe-unsaved', unsaved); statusEl.textContent = unsaved ? 'Unsaved changes' : ''; }
  function parentDir(path){ const abs = toAbsolute(path||HOME_DIR,null,HOME_DIR); if(abs===HOME_DIR) return '/'; const t = abs.replace(/\/+$/,''); const i = t.lastIndexOf('/'); return i<=0 ? '/' : t.slice(0,i); }
  function basename(path){ const abs = toAbsolute(path||HOME_DIR,null,HOME_DIR); if(abs==='/') return '/'; const parts = abs.split('/'); return parts[parts.length-1]||'/'; }
  function formatDisplayPath(path){ const abs = toAbsolute(path||HOME_DIR,null,HOME_DIR); if(abs===HOME_DIR) return '~'; if(abs.startsWith(HOME_PREFIX)) return `~/${abs.slice(HOME_PREFIX.length)}`; return abs; }
  function updatePathDisplay(){ if(!currentPath){ fileNameEl.textContent='Untitled'; filePathEl.textContent='No file open'; fileNameEl.title=''; filePathEl.title=''; return; } const abs = toAbsolute(currentPath,null,HOME_DIR); fileNameEl.textContent = basename(abs); fileNameEl.title = basename(abs); filePathEl.textContent = formatDisplayPath(abs); filePathEl.title = abs; }

  function setContent(value, markSaved=false){ const content = value ?? ''; model.setValue(content); if(markSaved){ lastSavedContent = content; setUnsaved(false);} else { setUnsaved(content !== lastSavedContent);} }
  function getContent(){ return model.getValue(); }

  function applyTheme(dark){ monaco.editor.setTheme(dark ? 'vs-dark' : 'vs'); }
  function applyLineNumbers(on){ editor.updateOptions({ lineNumbers: on ? 'on':'off' }); }
  function applyWrap(on){ editor.updateOptions({ wordWrap: on ? 'on':'off' }); }
  function applyShading(on){ editorHost.classList.toggle('fe-line-shading', !!on); }
  function applyLanguage(lang){ monaco.editor.setModelLanguage(model, showSyntaxHighlight ? lang : 'plaintext'); }

  editor.onDidChangeModelContent(() => setUnsaved(getContent() !== lastSavedContent));
  window.addEventListener('resize', () => editor.layout());

  async function openFile(path){ if(!path) throw new Error('Path is empty'); statusEl.textContent='Opening...'; try{ const payload = await api.get(`read?path=${encodeURIComponent(path)}`); const resolved = toAbsolute(payload.path || path, null, HOME_DIR); currentPath = resolved; currentPathExists = true; lastPickerPath = parentDir(resolved); currentLang = detectLanguageFromFilename(resolved) || 'plaintext'; applyLanguage(currentLang); setContent(payload.content || '', true); updatePathDisplay(); statusEl.textContent=''; editor.focus(); } catch(e){ statusEl.textContent=''; host.toast(`Failed to open: ${e.message}`); throw e; } }

  async function saveFile(){ if(!currentPath || !currentPathExists){ await saveAsDialog(); return; } statusEl.textContent='Saving...'; try { const content = getContent(); await api.post('write', { path: currentPath, content }); lastSavedContent = content; setUnsaved(false); host.toast('Saved'); } catch(e){ host.toast(`Save failed: ${e.message}`); } finally { statusEl.textContent=''; } }

  function pickerAvailable(){ return window.teFilePicker && typeof window.teFilePicker.openFile === 'function'; }
  async function pickFile(startPath){ if(!pickerAvailable()){ host.toast('File picker unavailable'); return null; } const baseStart = startPath || (currentPath ? parentDir(currentPath) : lastPickerPath); const initial = toAbsolute(baseStart,null,HOME_DIR); try{ const choice = await window.teFilePicker.openFile({ title:'Open File', startPath: initial, selectLabel:'Open' }); if(choice && choice.path){ lastPickerPath = parentDir(choice.path); return choice.path; } return null; }catch(err){ if(err && err.message==='cancelled') return null; host.toast(err?.message || 'Browse failed'); return null; } }

  async function pickSaveTarget(){ if(!pickerAvailable()){ host.toast('File picker unavailable'); return null; } const baseDir = currentPath ? parentDir(currentPath) : lastPickerPath; const initialDir = toAbsolute(baseDir,null,HOME_DIR); try{ return await window.teFilePicker.saveFile({ title:'Save As', startPath: initialDir, filename: currentPath ? basename(currentPath) : '', selectLabel:'Save' }); } catch(err){ if(err && err.message==='cancelled') return null; host.toast(err?.message || 'Save cancelled'); return null; } }

  async function saveAsDialog(){ const target = await pickSaveTarget(); if(!target || !target.path) return; if(target.existed && !window.confirm('File exists. Overwrite?')) return; statusEl.textContent='Saving...'; try{ const content = getContent(); await api.post('write', { path: target.path, content }); currentPath = toAbsolute(target.path,null,HOME_DIR); currentPathExists = true; lastPickerPath = parentDir(currentPath); lastSavedContent = content; currentLang = detectLanguageFromFilename(currentPath) || currentLang; applyLanguage(currentLang); setUnsaved(false); updatePathDisplay(); host.toast('Saved'); } catch(e){ host.toast(`Save failed: ${e.message}`); } finally { statusEl.textContent=''; } }

  function closeAllMenus(){ menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); menuViewDD.classList.remove('show'); }
  document.addEventListener('click', () => closeAllMenus());

  btnBrowse.addEventListener('click', async () => { const path = await pickFile(); if(path){ try{ await openFile(path);}catch(e){ host.toast(`Failed to open file: ${e.message}`);} } });
  menuFileBtn.addEventListener('click', (e)=>{ e.stopPropagation(); const open = menuFileDD.classList.toggle('show'); if(open){ menuEditDD.classList.remove('show'); menuViewDD.classList.remove('show'); } });
  menuEditBtn.addEventListener('click', (e)=>{ e.stopPropagation(); const open = menuEditDD.classList.toggle('show'); if(open){ menuFileDD.classList.remove('show'); menuViewDD.classList.remove('show'); } });
  menuViewBtn.addEventListener('click', (e)=>{ e.stopPropagation(); const open = menuViewDD.classList.toggle('show'); if(open){ menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); } });

  function bindToggle(el, fn){ if(!el) return; const run = ()=>{ closeAllMenus(); fn(); }; el.addEventListener('click', run); el.addEventListener('keydown', (ev)=>{ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); run(); } }); }

  // File menu
  miNew.addEventListener('click', ()=>{ closeAllMenus(); if(unsaved){ confirmModal.classList.add('show'); confirmModal.setAttribute('aria-hidden','false'); return; } currentPath=''; currentPathExists=false; lastPickerPath=HOME_DIR; currentLang='plaintext'; applyLanguage(currentLang); setContent('', true); updatePathDisplay(); });
  miOpen.addEventListener('click', ()=>{ closeAllMenus(); btnBrowse.click(); });
  miSave.addEventListener('click', ()=>{ closeAllMenus(); saveFile(); });
  miSaveAs.addEventListener('click', ()=>{ closeAllMenus(); saveAsDialog(); });
  miClose.addEventListener('click', ()=>{ closeAllMenus(); currentPath=''; currentPathExists=false; lastPickerPath=HOME_DIR; currentLang='plaintext'; applyLanguage(currentLang); setContent('', true); updatePathDisplay(); });
  miQuit.addEventListener('click', ()=>{ closeAllMenus(); try{ host.clearState(); }catch(_){} currentPath=''; currentPathExists=false; lastPickerPath=HOME_DIR; currentLang='plaintext'; applyLanguage(currentLang); setContent('', true); updatePathDisplay(); });

  // Edit menu
  miUndo.addEventListener('click', ()=>{ closeAllMenus(); editor.trigger('ui','undo',null); });
  miRedo.addEventListener('click', ()=>{ closeAllMenus(); editor.trigger('ui','redo',null); });
  miCut.addEventListener('click', ()=>{ closeAllMenus(); document.execCommand('cut'); });
  miCopy.addEventListener('click', ()=>{ closeAllMenus(); document.execCommand('copy'); });
  miPaste.addEventListener('click', async ()=>{ closeAllMenus(); try{ const t = await navigator.clipboard?.readText?.(); if(t!=null) editor.executeEdits('paste',[{ range: editor.getSelection(), text: t }]); else document.execCommand('paste'); }catch(_){ document.execCommand('paste'); } });
  miSelectAll.addEventListener('click', ()=>{ closeAllMenus(); editor.setSelection({ startLineNumber:1, startColumn:1, endLineNumber: model.getLineCount(), endColumn: model.getLineMaxColumn(model.getLineCount()) }); });

  // View menu
  bindToggle(miToggleLines, ()=>{ showLineNumbers = !showLineNumbers; applyLineNumbers(showLineNumbers); setMenuChecked(miToggleLines, showLineNumbers); });
  bindToggle(miToggleShading, ()=>{ showLineShading = !showLineShading; applyShading(showLineShading); setMenuChecked(miToggleShading, showLineShading); });
  bindToggle(miToggleSyntax, ()=>{ showSyntaxHighlight = !showSyntaxHighlight; applyLanguage(currentLang); setMenuChecked(miToggleSyntax, showSyntaxHighlight); });
  bindToggle(miToggleWrap, ()=>{ wordWrap = !wordWrap; applyWrap(wordWrap); setMenuChecked(miToggleWrap, wordWrap); });
  miFind.addEventListener('click', ()=>{ closeAllMenus(); editor.getAction('actions.find').run(); });
  miGoto.addEventListener('click', ()=>{ closeAllMenus(); const input = window.prompt('Go to line'); if(!input) return; const line = Number.parseInt(input,10); if(Number.isNaN(line)) return host.toast('Invalid line number'); const ln = Math.max(1, Math.min(line, model.getLineCount())); editor.revealLineInCenter(ln); editor.setPosition({ lineNumber: ln, column: 1 }); editor.focus(); });

  // Confirm modal
  const hideConfirm = ()=>{ confirmModal.classList.remove('show'); confirmModal.setAttribute('aria-hidden','true'); };
  confirmClose.addEventListener('click', hideConfirm);
  btnCancel.addEventListener('click', hideConfirm);
  btnDiscard.addEventListener('click', ()=>{ hideConfirm(); setUnsaved(false); host.requestExit(); });
  btnSaveConfirm.addEventListener('click', async ()=>{ await saveFile(); hideConfirm(); host.requestExit(); });
  document.addEventListener('keydown', (ev)=>{ if(ev.key==='Escape'){ hideConfirm(); closeAllMenus(); } });

  host.setTitle('Text Editor (Monaco + EC)');
  const state = host.loadState({ lastPath:null, draft:null, showLineNumbers:true, showLineShading:false, showSyntaxHighlight:true, wordWrap:false, theme:'dark' }) || {};
  showLineNumbers = state.showLineNumbers !== false; applyLineNumbers(showLineNumbers); setMenuChecked(miToggleLines, showLineNumbers);
  showLineShading = !!state.showLineShading; applyShading(showLineShading); setMenuChecked(miToggleShading, showLineShading);
  showSyntaxHighlight = state.showSyntaxHighlight !== false; setMenuChecked(miToggleSyntax, showSyntaxHighlight);
  wordWrap = !!state.wordWrap; applyWrap(wordWrap); setMenuChecked(miToggleWrap, wordWrap);
  applyTheme((state.theme||'dark') !== 'light');

  const params = new URLSearchParams(window.location.search);
  const fileFromUrl = params.get('file');
  if (fileFromUrl) { const abs = toAbsolute(fileFromUrl,null,HOME_DIR); lastPickerPath = parentDir(abs); try { await openFile(abs); } catch(e) { currentPath=''; currentPathExists=false; setContent('', false); setUnsaved(false); updatePathDisplay(); } return; }

  if (state.draft) { currentPath = state.lastPath ? toAbsolute(state.lastPath,null,HOME_DIR) : ''; currentPathExists=false; currentLang = currentPath ? (detectLanguageFromFilename(currentPath)||'plaintext') : 'plaintext'; applyLanguage(currentLang); setContent(state.draft, false); setUnsaved(true); updatePathDisplay(); return; }

  if (state.lastPath) { const abs = toAbsolute(state.lastPath,null,HOME_DIR); lastPickerPath = parentDir(abs); try { await openFile(abs);} catch(_){ currentPath = abs; currentPathExists=false; currentLang = detectLanguageFromFilename(abs)||'plaintext'; applyLanguage(currentLang); setContent('', false); updatePathDisplay(); } return; }

  setContent('', false); updatePathDisplay();
}
