import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Compiled data URL errors should not print the entire source bundle.
Error.stackTraceLimit = 0;
const base = new URL('.', import.meta.url);
async function sourceModule(entry) {
  const result = await build({ entryPoints: [new URL(entry, base).pathname], bundle: true,
    write: false, format: 'esm', target: 'es2022' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const contracts = await sourceModule('src/contracts.ts');
globalThis.window = { addEventListener() {} };
const main = await sourceModule('src/main.ts');
const task = { gid: 'one', status: 'active', name: 'a.zip', totalLength: 100, completedLength: 20,
  downloadSpeed: 10, uploadSpeed: 0, progress: 0.2, connections: 1, errorMessage: null };
const shell = { shell: { record: { id: 'shell-one', label: 'aria2', cwd: '/downloads', pid: 42,
  exit_code: null, created_at: 1, updated_at: 2, stats: { alive: true, uptime: 3, cpu_percent: 0, memory_rss: 1024 },
  logs: { stdout_tail: ['ready'], stderr_tail: [] } }, config: { label: 'aria2', created_at: 1 } } };

test('unknown downloads/status/shell edges validate payloads and nullable metadata', () => {
  assert.equal(contracts.readDownloads({ active: [task] }).active[0].gid, 'one');
  assert.deepEqual(contracts.readDownloads({}).waiting, []);
  assert.equal(contracts.readStatus({ version: { version: '1.37' }, globalStat: { numWaiting: '2' } }).version.version, '1.37');
  assert.equal(contracts.readShell(shell).shell.record.stats.alive, true);
  assert.deepEqual(contracts.readShell({ shell: null }), { shell: null });
  for (const [fn, value] of [[contracts.readDownloads, null], [contracts.readDownloads, { active: {} }],
    [contracts.readDownloads, { active: [{ ...task, gid: 3 }] }], [contracts.readStatus, { version: [] }],
    [contracts.readShell, { shell: { record: {} } }], [contracts.readShell, { shell: { record: { id: 'a', stats: { alive: 'yes' } } } }]]) {
    assert.throws(() => fn(value));
  }
});
test('saved state, picker and legacy browse ingress remain bounded to their shapes', () => {
  assert.deepEqual(contracts.readSaved({ sortKey: 3, lastDirectory: [], sortDir: 'asc' }), { sortKey: 'status', sortDir: 'asc', lastDirectory: '~' });
  assert.equal(contracts.readPicker(null), null);
  assert.deepEqual(contracts.readPicker({ path: '/downloads' }), { path: '/downloads' });
  assert.throws(() => contracts.readPicker({ path: 3 }));
  assert.deepEqual(contracts.readDirectoryResponse({ ok: true, data: [{ type: 'directory', name: 'a', path: '/a' }] })[0].path, '/a');
  assert.throws(() => contracts.readDirectoryResponse({ ok: false, error: 'denied' }), /denied/);
});

class Element {
  style = {}; dataset = {}; value = ''; checked = false; disabled = false; hidden = false;
  textContent = ''; children = []; handlers = new Map(); attributes = new Map(); focused = false;
  constructor() {
    const classes = new Set();
    this.classList = { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
      toggle: (x, on) => on ? classes.add(x) : classes.delete(x) };
  }
  set innerHTML(value) { this.markup = value; this.children = []; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  addEventListener(type, callback) { this.handlers.set(type, [...(this.handlers.get(type) || []), callback]); }
  focus() { this.focused = true; }
  closest(selector) {
    if (selector === 'button[data-action]' && this instanceof Button) return this;
    if (selector === 'input.aria-select' && this instanceof Input) return this;
    return null;
  }
  async fire(type, target = this) {
    for (const callback of this.handlers.get(type) || []) await callback({ target, preventDefault() {}, stopPropagation() {} });
  }
}
class Button extends Element {}
class Input extends Element {}
class Select extends Element {}
const template = await readFile(new URL('template.html', base), 'utf8');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function mount({ saved = {}, downloadsFailure = false } = {}) {
  globalThis.Element = Element; globalThis.HTMLElement = Element;
  globalThis.HTMLButtonElement = Button; globalThis.HTMLInputElement = Input; globalThis.HTMLSelectElement = Select;
  const nodes = new Map();
  for (const match of template.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const [, tag, id] = match;
    nodes.set('#' + id, tag === 'button' ? new Button() : tag === 'input' ? new Input() : tag === 'select' ? new Select() : new Element());
  }
  const root = new Element(); root.querySelector = selector => nodes.get(selector) || null;
  const toasts = []; const calls = []; const states = []; const timers = new Map(); const beforeExit = [];
  globalThis.document = new Element(); document.hidden = false;
  document.createElement = tag => tag === 'button' ? new Button() : tag === 'input' ? new Input() : new Element();
  globalThis.window = new Element();
  window.teUI = { dialog: { confirm: async () => true } };
  window.teFilePicker = { openDirectory: async () => ({ path: '/downloads/' }) };
  globalThis.setInterval = callback => { const id = timers.size + 1; timers.set(id, callback); return id; };
  globalThis.clearInterval = id => timers.delete(id);
  const api = {
    async get(path) {
      calls.push(['get', path]);
      if (path === 'status') return { version: { version: '1.37' }, globalStat: { numWaiting: '0' } };
      if (path === 'downloads') { if (downloadsFailure) throw new Error('HTTP 502'); return { active: [task], waiting: [], stopped: [] }; }
      return shell;
    },
    async post(path, payload) { calls.push(['post', path, payload]); return path.startsWith('shell/') ? shell : {}; },
  };
  main.default(root, api, { loadState: () => saved, saveState: value => states.push(value),
    toast: message => toasts.push(message), setTitle: title => calls.push(['title', title]),
    onBeforeExit: callback => beforeExit.push(callback) });
  await flush(); await flush();
  return { nodes, calls, states, timers, toasts, root, cleanup: () => beforeExit.forEach(callback => callback()) };
}

test('actual frontend renders typed projections and cleans up unchanged polling lifecycle', async () => {
  const app = await mount({ saved: { sortKey: 'name', sortDir: 'asc', lastDirectory: '/out' } });
  try {
    assert.equal(app.nodes.get('#aria-sort').value, 'name');
    assert.equal(app.nodes.get('#aria-directory').value, '/out');
    assert.equal(app.nodes.get('#aria-count-active').textContent, '1');
    assert.equal(app.nodes.get('#aria-shell-status').textContent, 'Running');
    assert.equal(app.nodes.get('#aria-shell-stdout').textContent, 'ready');
    assert.equal(app.timers.size, 1);
    const count = app.calls.filter(call => call[1] === 'downloads').length;
    [...app.timers.values()][0](); await flush();
    assert.equal(app.calls.filter(call => call[1] === 'downloads').length, count + 1);
  } finally { app.cleanup(); }
  assert.equal(app.timers.size, 0);
});
test('shell Start/Restart and bulk control keep existing routes and payloads', async () => {
  const app = await mount();
  try {
    await app.nodes.get('#aria-shell-start').fire('click'); await flush();
    await app.nodes.get('#aria-shell-restart').fire('click'); await flush();
    await app.nodes.get('#aria-pause-all').fire('click'); await flush();
    assert.ok(app.calls.some(call => call[0] === 'post' && call[1] === 'shell/spawn' && Object.keys(call[2]).length === 0));
    assert.ok(app.calls.some(call => call[1] === 'shell/action' && call[2].action === 'restart'));
    assert.ok(app.calls.some(call => call[1] === 'control' && call[2].action === 'pauseAll'));
  } finally { app.cleanup(); }
});
test('picker state and download form preserve add options without mutation replay', async () => {
  const app = await mount();
  try {
    await app.nodes.get('#aria-browse').fire('click'); await flush();
    assert.equal(app.nodes.get('#aria-directory').value, '/downloads');
    assert.equal(app.states.at(-1).lastDirectory, '/downloads');
    app.nodes.get('#aria-url').value = 'https://example.test/a';
    app.nodes.get('#aria-filename').value = 'a.zip';
    app.nodes.get('#aria-pause-on-add').checked = true;
    app.nodes.get('#aria-parallel').value = '4';
    await app.nodes.get('#aria-new-submit').fire('click'); await flush();
    const added = app.calls.filter(call => call[1] === 'add');
    assert.equal(added.length, 1);
    assert.deepEqual(added[0][2], { url: 'https://example.test/a', directory: '/downloads', filename: 'a.zip',
      options: { pause: 'true', 'max-connection-per-server': '4' } });
    await document.fire('visibilitychange'); await flush();
    assert.equal(app.calls.filter(call => call[1] === 'add').length, 1);
    assert.equal(app.nodes.get('#aria-url').value, '');
  } finally { app.cleanup(); }
});
test('502 remains visible without adding a silent fallback or mutating request', async () => {
  const app = await mount({ downloadsFailure: true });
  try {
    assert.match(app.nodes.get('#aria-error').textContent, /502/);
    assert.equal(app.calls.filter(call => call[0] === 'post').length, 0);
  } finally { app.cleanup(); }
});
test('single minified public entry retains existing asset mapping and authored inline CSS', async () => {
  const bundle = await readFile(new URL('main.js', base), 'utf8');
  assert.match(bundle, /Generated by build.mjs/);
  assert.doesNotMatch(bundle, /from["'].*dist\//);
  const inventory = await readFile(new URL('../../android_editor_assets_bundle.json', base), 'utf8');
  assert.ok(inventory.includes('app/apps/aria_downloader/main.js'));
  assert.match(template, /<style>/);
});
