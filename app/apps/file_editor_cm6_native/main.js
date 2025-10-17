// CodeMirror 6 Native-selection editor (auto-switch on touch/selection)
const CM_BASE = '/app/static/vendor/codemirror/@codemirror';

import {EditorState, Compartment, EditorSelection} from `${CM_BASE}/state/dist/index.js`;
import {EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection} from `${CM_BASE}/view/dist/index.js`;
import {defaultKeymap, history, undo, redo} from `${CM_BASE}/commands/dist/index.js`;
import {searchKeymap, openSearchPanel} from `${CM_BASE}/search/dist/index.js`;
import {syntaxHighlighting, defaultHighlightStyle} from `${CM_BASE}/language/dist/index.js`;

import {javascript} from `${CM_BASE}/lang-javascript/dist/index.js`;
import {json} from `${CM_BASE}/lang-json/dist/index.js`;
import {python} from `${CM_BASE}/lang-python/dist/index.js`;
import {html} from `${CM_BASE}/lang-html/dist/index.js`;
import {css} from `${CM_BASE}/lang-css/dist/index.js`;
import {markdown} from `${CM_BASE}/lang-markdown/dist/index.js`;
import {shell} from `${CM_BASE}/lang-shell/dist/index.js`;
import {xml} from `${CM_BASE}/lang-xml/dist/index.js`;

function detectLanguageFromFilename(filename) {
  if (!filename) return null;
  const parts = String(filename).toLowerCase().split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop();
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    json: 'json', css: 'css', scss: 'css', less: 'css', html: 'html', htm: 'html',
    md: 'markdown', markdown: 'markdown', py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell',
    xml: 'xml', svg: 'xml'
  };
  return map[ext] || null;
}
function langExtension(id){
  switch(id){
    case 'javascript': return javascript();
    case 'json': return json();
    case 'python': return python();
    case 'html': return html();
    case 'css': return css();
    case 'markdown': return markdown();
    case 'shell': return shell();
    case 'xml': return xml();
    default: return [];
  }
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

export default async function initFileEditor(container, api, host){
  const HOME_DIR = '/data/data/com.termux/files/home';
  const HOME_PREFIX = `${HOME_DIR}/`;
  const requireEl = (sel, scope = document) => { const el = scope.querySelector(sel); if (!el) throw new Error(`Missing ${sel}`); return el; };

  const editorHost = requireEl('#editor-container');
  const statusEl = requireEl('#fe-status');
  const fileNameEl = requireEl('#fe-file-name');

  const lineNumbersComp = new Compartment();
  const wrapComp = new Compartment();
  const langComp = new Compartment();
  const themeComp = new Compartment();
  const shadeComp = new Compartment();
  const highlightComp = new Compartment();

  const baseDarkTheme = EditorView.theme({
    '&': { color: '#e5e7eb', backgroundColor: '#0b0f1a' },
    '.cm-content': { caretColor: '#93c5fd' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#93c5fd' },
    '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(59,130,246,.35)' },
  }, { dark: true });
  const shadingTheme = EditorView.theme({ '.cm-line:nth-child(even)': { backgroundColor: 'rgba(255,255,255,0.06)' } }, { dark: true });

  let showLineNumbers = true, wordWrap = false, showSyntax = true, showShading = false;
  let currentLang = 'plaintext';
  let currentPath = '';
  let currentPathExists = false;
  let lastPickerPath = HOME_DIR;
  let lastSavedContent = '';
  let unsaved = false;

  function setUnsaved(flag){ unsaved = !!flag; statusEl.textContent = unsaved ? 'Unsaved changes' : ''; fileNameEl.classList.toggle('fe-unsaved', unsaved); }
  function parentDir(path){ const abs = toAbsolute(path||HOME_DIR,null,HOME_DIR); if(abs===HOME_DIR) return '/'; const t = abs.replace(/\/+$/,''); const i = t.lastIndexOf('/'); return i<=0 ? '/' : t.slice(0,i); }
  function basename(path){ const abs = toAbsolute(path||HOME_DIR,null,HOME_DIR); if(abs==='/') return '/'; const parts = abs.split('/'); return parts[parts.length-1]||'/'; }
  function formatDisplayPath(path){ const abs = toAbsolute(path||HOME_DIR,null,HOME_DIR); if(abs===HOME_DIR) return '~'; if(abs.startsWith(HOME_PREFIX)) return `~/${abs.slice(HOME_PREFIX.length)}`; return abs; }

  function updateFileTitleDisplay(){
    const abs = currentPath ? toAbsolute(currentPath,null,HOME_DIR) : '';
    fileNameEl.textContent = currentPath ? basename(abs) : 'Untitled';
    fileNameEl.title = currentPath ? formatDisplayPath(abs) : 'No file';
  }

  const view = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: [
        keymap.of([...defaultKeymap, ...searchKeymap]),
        history(),
        lineNumbersComp.of(showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
        wrapComp.of(wordWrap ? [EditorView.lineWrapping] : []),
        langComp.of([]),
        themeComp.of([baseDarkTheme, drawSelection(), highlightActiveLine()]),
        shadeComp.of(showShading ? [shadingTheme] : []),
        highlightComp.of(showSyntax ? [syntaxHighlighting(defaultHighlightStyle)] : []),
      ]
    }),
    parent: editorHost
  });

  function setContent(value, markSaved=false){
    const text = value ?? '';
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    if (markSaved){ lastSavedContent = text; setUnsaved(false);} else { setUnsaved(text !== lastSavedContent); }
  }
  const origDispatch = view.dispatch.bind(view);
  view.dispatch = (tr) => { origDispatch(tr); setUnsaved(view.state.doc.toString() !== lastSavedContent); };

  function applyLanguage(id){ currentLang = id || 'plaintext'; view.dispatch({ effects: langComp.reconfigure(showSyntax ? langExtension(currentLang) : []) }); }
  function applyLineNumbers(on){ view.dispatch({ effects: lineNumbersComp.reconfigure(on ? [lineNumbers(), highlightActiveLineGutter()] : []) }); }
  function applyWrap(on){ view.dispatch({ effects: wrapComp.reconfigure(on ? [EditorView.lineWrapping] : []) }); }
  function applyShading(on){ view.dispatch({ effects: shadeComp.reconfigure(on ? [shadingTheme] : []) }); editorHost.classList.toggle('fe-line-shading', !!on); }
  function applyHighlight(on){ view.dispatch({ effects: highlightComp.reconfigure(on ? [syntaxHighlighting(defaultHighlightStyle)] : []) }); }

  // --- Automatic native-selection mode ---
  let nativeMode = false;
  let longPressTimer = null;
  const LONG_PRESS_MS = 300;
  function cmContentEl(){ return editorHost.querySelector('.cm-content'); }

  function enableNativeSelection(){
    const el = cmContentEl();
    if (!el || nativeMode) return;
    nativeMode = true;
    el.setAttribute('contenteditable', 'true');
    el.style.webkitUserModify = 'read-write-plaintext-only';
    el.style.userSelect = 'text';
    el.focus();
  }
  function disableNativeSelection(){
    const el = cmContentEl();
    if (!el || !nativeMode) return;
    nativeMode = false;
    el.setAttribute('contenteditable', 'false');
    el.style.webkitUserModify = '';
    el.style.userSelect = '';
  }

  editorHost.addEventListener('touchstart', ()=>{
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(()=> enableNativeSelection(), LONG_PRESS_MS);
  }, {passive: true});
  editorHost.addEventListener('touchend', ()=>{
    clearTimeout(longPressTimer);
  }, {passive: true});
  editorHost.addEventListener('pointerdown', ()=>{
    if (nativeMode){
      setTimeout(()=> disableNativeSelection(), 150);
    }
  }, {passive: true});
  editorHost.addEventListener('beforeinput', ()=>{
    if (nativeMode) disableNativeSelection();
  });

  async function openFile(path){
    if(!path) throw new Error('Path is empty');
    statusEl.textContent='Opening...';
    try{
      const payload = await api.get(`read?path=${encodeURIComponent(path)}`);
      const resolved = toAbsolute(payload.path || path, null, HOME_DIR);
      currentPath = resolved; currentPathExists = true;
      applyLanguage(detectLanguageFromFilename(resolved) || 'plaintext');
      setContent(payload.content || '', true);
      updateFileTitleDisplay();
      statusEl.textContent='';
      view.focus();
    }catch(e){
      statusEl.textContent='';
      host.toast(`Failed to open: ${e.message}`);
      throw e;
    }
  }

  async function saveFile(){
    if(!currentPath || !currentPathExists){ return; }
    statusEl.textContent='Saving...';
    try{
      const content = view.state.doc.toString();
      await api.post('write', { path: currentPath, content });
      lastSavedContent = content; setUnsaved(false); host.toast('Saved');
    }catch(e){ host.toast(`Save failed: ${e.message}`); }
    finally { statusEl.textContent=''; }
  }

  host.setTitle('Text Editor (CM6 Native)');
  const state = host.loadState({ lastPath:null, draft:null, showLineNumbers:true, showLineShading:false, showSyntaxHighlight:true, wordWrap:false, theme:'dark' }) || {};
  showLineNumbers = state.showLineNumbers !== false; applyLineNumbers(showLineNumbers);
  showShading = !!state.showLineShading; applyShading(showShading);
  showSyntax = state.showSyntaxHighlight !== false; applyHighlight(showSyntax);
  wordWrap = !!state.wordWrap; applyWrap(wordWrap);

  setContent('', false);
  updateFileTitleDisplay();

  const params = new URLSearchParams(window.location.search);
  const fileFromUrl = params.get('file');
  if (fileFromUrl){
    try{ await openFile(fileFromUrl); } catch{}
  }
}

if (typeof window !== 'undefined' && !window.__APP_BOOTSTRAPPED__) {
  window.__APP_BOOTSTRAPPED__ = true;
  const api = {
    async get(url){ const resp = await fetch(url); return await resp.json(); },
    async post(url, body){ const resp = await fetch(url, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }); return await resp.json(); }
  };
  const host = {
    setTitle: (t)=>document.title=t,
    loadState: ()=>({}),
    toast: (m)=>console.log('[toast]', m)
  };
  const container = document.body;
  initFileEditor(container, api, host);
}
