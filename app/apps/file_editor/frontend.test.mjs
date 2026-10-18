import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const base = new URL('.', import.meta.url);
async function sourceModule(entry, plugins = []) {
  const result = await build({ entryPoints: [new URL(entry, base).pathname], bundle: true, write: false,
    format: 'esm', target: 'es2022', plugins });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const contracts = await sourceModule('src/contracts.ts');

test('API edge accepts wrapped/unwrapped and empty documents, rejects invalid data', () => {
  const doc = { path: '/home/empty', content: '' };
  assert.deepEqual(contracts.readDocument(doc), doc);
  assert.deepEqual(contracts.readDocument({ ok: true, data: doc }), doc);
  for (const value of [null, [], { path: 3, content: '' }, { ok: true, data: { path: '/x' } }, { ok: false, error: 'denied' }]) {
    assert.throws(() => contracts.readDocument(value));
  }
});
test('picker and restored-state boundaries do not admit malformed identity/document fields', () => {
  assert.equal(contracts.pickerChoice(null), null);
  assert.deepEqual(contracts.pickerChoice({ path: '/x', existed: true }), { path: '/x', existed: true });
  assert.throws(() => contracts.pickerChoice({ path: 3 }));
  const state = contracts.normalizeState({ draft: 3, lastPath: {}, wordWrap: true, theme: 'one-dark' });
  assert.equal(state.draft, null); assert.equal(state.lastPath, null);
  assert.equal(state.wordWrap, true); assert.equal(state.theme, 'one-dark');
});

class Element {
  style = {}; textContent = ''; title = ''; attributes = new Map(); handlers = new Map(); children = new Map();
  constructor() {
    const classes = new Set();
    this.classList = { add: x => classes.add(x), remove: x => classes.delete(x),
      contains: x => classes.has(x), toggle: x => { if (classes.has(x)) { classes.delete(x); return false; } classes.add(x); return true; } };
  }
  querySelector(selector) { if (!this.children.has(selector)) this.children.set(selector, new Element()); return this.children.get(selector); }
  querySelectorAll() { return []; }
  addEventListener(event, handler) { const list = this.handlers.get(event) || []; list.push(handler); this.handlers.set(event, list); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  click() { for (const handler of this.handlers.get('click') || []) handler({ stopPropagation() {}, preventDefault() {} }); }
}
const observers = [];
class Observer {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe() {} disconnect() {}
}
let currentView;
class EditorView {
  static theme() { return []; } static lineWrapping = [];
  dom = new Element();
  constructor({ state }) { this.state = state; currentView = this; }
  focus() {} destroy() {}
  dispatch() {}
}
function editorState(doc) {
  return { doc: { toString: () => doc, length: doc.length }, selection: { main: { from: 0, to: 0 } } };
}
const empty = () => [];
globalThis.__fileEditorCMFixture = {
  EditorView, EditorState: { create: ({ doc }) => editorState(doc) },
  keymap: { of: empty }, highlightActiveLine: empty, highlightActiveLineGutter: empty,
  lineNumbers: empty, defaultKeymap: [], history: empty, historyKeymap: [], searchKeymap: [],
  indentWithTab: { key: 'Tab' }, syntaxHighlighting: empty, StreamLanguage: { define: empty },
  defaultHighlightStyle: {}, undo() {}, redo() {}, oneDark: [], search: empty, openSearchPanel() {},
  termuxTheme: empty, javascript: empty, json: empty, python: empty, html: empty,
  css: empty, markdown: empty, xml: empty,
  shell: undefined, shellMode: undefined, modeShell: undefined,
};
const main = await sourceModule('src/main.ts', [{ name: 'existing-browser-assets', setup(builder) {
  builder.onResolve({ filter: /^\/static\// }, args => {
    if (args.path.includes('codemirror')) return { path: 'cm6', namespace: 'fixture' };
    return { path: new URL(`../../static/js/${args.path.split('/').pop()}`, base).pathname };
  });
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents:
    `const cm = globalThis.__fileEditorCMFixture;
     export const { EditorState, EditorView, keymap, highlightActiveLine, highlightActiveLineGutter,
       lineNumbers, defaultKeymap, history, historyKeymap, searchKeymap, indentWithTab,
       syntaxHighlighting, StreamLanguage, defaultHighlightStyle, undo, redo, oneDark, search,
       openSearchPanel, termuxTheme, javascript, json, python, html, css, markdown, xml,
       shell, shellMode, modeShell } = cm;`, loader: 'js' }));
} }]);

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
async function mount({ search = '', seed = null, rawPreferences = null } = {}) {
  observers.length = 0;
  const root = new Element(); const calls = []; const storage = new Map();
  if (rawPreferences) storage.set('te2:file-editor:preferences:v1', JSON.stringify(rawPreferences));
  globalThis.HTMLElement = Element;
  globalThis.MutationObserver = Observer;
  globalThis.document = new Element();
  globalThis.window = { location: { search }, localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
  }, teUI: { dialog: { confirm: async () => true, prompt: async () => null } } };
  const api = {
    get: async path => { calls.push(['get', path]); return { path: '/home/file.md', content: 'disk' }; },
    post: async (path, body) => { calls.push(['post', path, body]); return { ok: true, data: {} }; },
  };
  const host = { toast: message => calls.push(['toast', message]), setTitle() {}, clearState() {},
    loadState: defaults => seed ?? defaults, onBeforeExit: handler => { host.exit = handler; }, onBeforeUnload() {} };
  await main.default(root, api, host); await flush();
  return { root, api, host, calls, storage, edit(text) {
    currentView.state = editorState(text); observers.forEach(observer => observer.callback());
  } };
}
test('actual frontend loads URL file, uses own sidebar backend and persists five preferences', async () => {
  const f = await mount({ search: '?file=%2Fhome%2Ffile.md&te2_host_id=h&te2_token_id=t',
    seed: { lastPath: '/wrong-slot', draft: 'wrong-draft' }, rawPreferences: { wordWrap: true, showLineNumbers: false } });
  assert.equal(currentView.state.doc.toString(), 'disk');
  assert.deepEqual(f.calls.find(x => x[0] === 'get'), ['get', 'read?path=%2Fhome%2Ffile.md']);
  const publication = f.calls.find(x => x[1] === 'sidebar/window/state');
  assert.equal(publication[2].host_id, 'h'); assert.equal(publication[2].file, '/home/file.md');
  f.root.querySelector('#mi-toggle-wrap').click();
  const stored = JSON.parse(f.storage.get('te2:file-editor:preferences:v1'));
  assert.equal(stored.wordWrap, false); assert.equal(stored.showLineNumbers, false);
  assert.deepEqual(Object.keys(stored).sort(), ['showLineNumbers', 'showLineShading', 'showSyntaxHighlight', 'theme', 'wordWrap'].sort());
});
test('actual frontend discard resumes navigation and failed save retains pending consent', async () => {
  const f = await mount({ search: '?file=%2Fhome%2Ffile.md' });
  f.edit('draft');
  f.root.querySelector('#mi-close').click(); await flush();
  assert.equal(f.root.querySelector('#fe-confirm').classList.contains('show'), true);
  f.root.querySelector('#fe-discard').click(); await flush();
  assert.equal(currentView.state.doc.toString(), '');
  assert.equal(f.root.querySelector('#fe-file-name').textContent, 'Untitled');
  await f.api.get(''); // transport is still independently usable
  f.edit('another draft'); f.root.querySelector('#mi-close').click(); await flush();
  f.api.post = async () => { throw Error('disk full'); };
  // After closing the document, Save As needs a picker. Give it an existing path.
  window.teFilePicker = { openFile: async () => null, saveFile: async () => ({ path: '/home/new.md' }) };
  f.root.querySelector('#fe-save-confirm').click(); await flush();
  assert.equal(f.root.querySelector('#fe-confirm').classList.contains('show'), true);
  f.root.querySelector('#fe-cancel').click(); await flush();
  assert.equal(currentView.state.doc.toString(), 'another draft');
  f.api.post = async () => ({ ok: true, data: { path: '/home/new.md' } });
  f.root.querySelector('#mi-close').click(); await flush();
  f.root.querySelector('#fe-save-confirm').click(); await flush(); await flush();
  assert.equal(f.root.querySelector('#fe-confirm').classList.contains('show'), false);
  assert.equal(currentView.state.doc.toString(), '');
});
test('existing public entrypoint is the minified module, without an extra asset hop', async () => {
  const bundle = await readFile(new URL('main.js', base), 'utf8');
  assert.match(bundle, /Generated by build.mjs/);
  assert.match(bundle, /\/static\/vendor\/codemirror\.1\/codemirror\.bundle\.js/);
  assert.match(bundle, /\/static\/js\/te_file_editor_preferences\.mjs/);
  assert.ok(bundle.length < 20000);
  assert.doesNotMatch(bundle, /node_modules|@codemirror\/state/);
  assert.doesNotMatch(bundle, /\.\/static\/dist\/main\.js/);
  const manifest = JSON.parse(await readFile(new URL('../../android_editor_assets_bundle.json', base), 'utf8'));
  assert.ok(manifest.entries.some(entry => entry.src === 'app/apps/file_editor/main.js' && entry.dest === 'apps/file_editor/main.js'));
});
