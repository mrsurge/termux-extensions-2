import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Data-URL compiled modules otherwise print the entire bundle on fixture errors.
Error.stackTraceLimit = 0;

const base = new URL('.', import.meta.url);
async function sourceModule(entry, plugins = []) {
  const result = await build({ entryPoints: [new URL(entry, base).pathname], bundle: true,
    write: false, format: 'esm', target: 'es2022', plugins });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const contracts = await sourceModule('src/contracts.ts');
test('listing edges validate filesystem and archive records, including null sizes', () => {
  for (const mode of ['filesystem', 'archive']) {
    const listing = contracts.decodeListing({ mode, path: '/home', archive_path: '/home/a.zip',
      entries: [{ id: 'a', name: 'a', type: 'file', path: '/home/a.zip', internal: 'a', size: null }] });
    assert.equal(listing.mode, mode); assert.equal(listing.entries[0].internal, 'a');
  }
  for (const value of [null, [], { mode: 'bad', entries: [] }, { mode: 'filesystem', entries: {} },
    { mode: 'archive', entries: [{ id: 'a', name: 'a', type: 'file', path: 3 }] },
    { mode: 'archive', entries: [{ id: 'a', name: 'a', type: 'file', path: 'a', size: -1 }] }]) {
    assert.throws(() => contracts.decodeListing(value));
  }
});
test('bookmarks, pickers, jobs and global envelopes validate unknown data', () => {
  assert.deepEqual(contracts.decodeBookmarks([{ name: 'Home', path: '~' }]), [{ name: 'Home', path: '~' }]);
  assert.equal(contracts.decodePicker(null), null);
  assert.deepEqual(contracts.decodePicker({ path: '/home', existed: true }), { path: '/home', existed: true });
  assert.deepEqual(contracts.decodeJobs([{ id: 'j', status: 'running', error: null, progress: { completed: 2 } }])[0].progress, { completed: 2 });
  assert.deepEqual(contracts.unwrapResponse({ ok: true, data: [] }, true, 200), []);
  assert.throws(() => contracts.unwrapResponse({ ok: false, error: 'denied' }, true, 200), /denied/);
  for (const [fn, value] of [[contracts.decodeBookmarks, [{}]], [contracts.decodePicker, { path: 2 }],
    [contracts.decodePicker, { path: '/x', existed: 'yes' }], [contracts.decodeJobs, [{ id: 3 }]],
    [contracts.decodeJob, { id: 'j', status: 'running', progress: [] }]]) assert.throws(() => fn(value));
});

class Element {
  style = {}; dataset = {}; attributes = new Map(); handlers = new Map(); children = [];
  selectors = new Map(); textContent = ''; disabled = false;
  constructor() {
    const classes = new Set();
    this.classList = { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) };
  }
  set innerHTML(value) { this.children = []; }
  querySelector(selector) { return this.selectors.get(selector) || null; }
  querySelectorAll() { return []; }
  appendChild(child) { this.children.push(child); return child; }
  getRootNode() { return globalThis.document; }
  addEventListener(type, callback) { this.handlers.set(type, [...(this.handlers.get(type) || []), callback]); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  hasAttribute(key) { return this.attributes.has(key); }
  closest(selector) { return selector === '.am-card-select' && this instanceof Input ? this : null; }
  async fire(type) { for (const callback of this.handlers.get(type) || []) await callback({ target: this, stopPropagation() {} }); }
}
class Button extends Element {}
class Input extends Element { checked = false; value = ''; }
class Template extends Element {
  content = { firstElementChild: { cloneNode: () => {
    const card = new Element();
    card.selectors.set('.am-card-select', new Input());
    card.selectors.set('.am-card-title', new Element());
    card.selectors.set('[data-role="meta"]', new Element());
    return card;
  } } };
}
const pollers = [];
globalThis.__archiveJobFixture = {
  createJobPoller(options) {
    let running = false;
    const poller = { ...options, start() { running = true; }, stop() { running = false; }, isRunning() { return running; } };
    pollers.push(poller); return poller;
  },
  async cancelJob() {}, async deleteJob() {},
};
const main = await sourceModule('src/main.ts', [{ name: 'job-helper-fixture', setup(builder) {
  builder.onResolve({ filter: /^\/static\/js\/jobs_client.js$/ }, () => ({ path: 'jobs', namespace: 'fixture' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents:
    'export const {createJobPoller,cancelJob,deleteJob}=globalThis.__archiveJobFixture;', loader: 'js' }));
} }]);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
async function mount({ search = '', saved = null, jobFailure = false } = {}) {
  globalThis.Element = Element; globalThis.HTMLElement = Element; globalThis.HTMLButtonElement = Button;
  globalThis.HTMLInputElement = Input; globalThis.HTMLTemplateElement = Template;
  globalThis.document = new Element();
  document.createElement = tag => tag === 'input' ? new Input() : tag === 'button' ? new Button() : new Element();
  document.selectors.set('#am-entry-card', new Template());
  const root = new Element();
  for (const role of ['entry-grid', 'empty-state', 'breadcrumbs']) root.selectors.set(`[data-role="${role}"]`, new Element());
  for (const action of ['new-archive', 'exit-archive', 'extract', 'add-to-archive', 'test-archive']) root.selectors.set(`[data-action="${action}"]`, new Button());
  root.selectors.set('#am-show-hidden', new Input());
  const calls = []; const toasts = []; const notifications = []; const savedStates = [];
  window = globalThis.window = { location: { search }, teFilePicker: { openDirectory: async () => ({ path: '/home/out' }) },
    teUI: { toast: message => toasts.push(message), notify: options => notifications.push(options), dismiss() {},
      dialog: { prompt: async () => null, confirm: async () => true } } };
  globalThis.fetch = async (url, options) => {
    calls.push(['fetch', url, options]);
    if (url === '/api/bookmarks') return { ok: true, status: 200, json: async () => ({ ok: true, data: [] }) };
    return { ok: !jobFailure, status: jobFailure ? 500 : 200,
      json: async () => jobFailure ? { error: 'admission failed' } : { ok: true, data: { id: 'job', status: 'running' } } };
  };
  await main.default(root, {
    async get(url) {
      calls.push(['get', url]); const query = new URLSearchParams(url.split('?')[1]);
      const archive = query.get('archive') === '1';
      return { mode: archive ? 'archive' : 'filesystem', path: query.get('path'), archive_path: query.get('path'), internal: query.get('internal'),
        entries: [{ id: 'one', name: archive ? 'readme.md' : 'docs', type: archive ? 'file' : 'directory',
          path: archive ? query.get('path') : '/home/docs', internal: archive ? 'docs/readme.md' : undefined, size: 3 }] };
    },
    async post(...args) { calls.push(['post', ...args]); return {id: 'job-operation', status: 'running'}; },
  }, { loadState: () => saved, saveState: value => savedStates.push(value), toast: message => toasts.push(message) });
  await flush();
  return { root, calls, toasts, notifications, savedStates, grid: root.querySelector('[data-role="entry-grid"]') };
}
test('restored state rejects malformed fields without losing valid preferences', () => {
  const state = main.restoreState({ loadState: () => ({ mode: 'bad', cwd: 3, archivePath: {}, showHidden: true }) }, {});
  assert.equal(state.cwd, '~'); assert.equal(state.mode, 'filesystem'); assert.equal(state.archivePath, null);
  assert.equal(state.showHidden, true); assert.equal(state.selectedIds.size, 0);
});
test('actual frontend mounts query archive, selects a member, admits one extraction and tracks it', async () => {
  const app = await mount({ search: '?archive=%2Fhome%2Fa.zip&internal=docs&hidden=1' });
  assert.match(app.calls.find(call => call[0] === 'get')[1], /archive=1/);
  const card = app.grid.children[0]; const checkbox = card.querySelector('.am-card-select');
  checkbox.checked = true; await checkbox.fire('change');
  assert.equal(app.root.querySelector('[data-action="extract"]').disabled, false);
  await app.root.querySelector('[data-action="extract"]').fire('click');
  const requests = app.calls.filter(call => call[1] === '/api/app/archive_manager/jobs'); assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0][2].body), { type: 'extract_archive', params: {
    archive_path: '/home/a.zip', items: ['docs/readme.md'], destination: '/home/out', options: {} } });
  assert.equal(app.notifications.at(-1).id, 'job'); assert.equal(pollers.at(-1).isRunning(), true);
  assert.equal(app.savedStates.at(-1).archivePath, '/home/a.zip');
  app.notifications.at(-1).onDismiss(); assert.equal(pollers.at(-1).isRunning(), false);
});
test('filesystem double click navigates and show-hidden change persists and refreshes', async () => {
  const app = await mount({ saved: { cwd: '/home', showHidden: false } });
  await app.grid.children[0].fire('dblclick'); await flush();
  assert.match(app.calls.filter(call => call[0] === 'get').at(-1)[1], /path=%2Fhome%2Fdocs/);
  const toggle = app.root.querySelector('#am-show-hidden'); toggle.checked = true;
  await toggle.fire('change'); await flush();
  assert.equal(app.savedStates.at(-1).showHidden, true);
  assert.match(app.calls.filter(call => call[0] === 'get').at(-1)[1], /hidden=1/);
});
test('creation defaults to ZIP and tracks admission instead of announcing completion', async () => {
  const app = await mount({ saved: {cwd: '/home'} });
  let pickerOptions;
  window.teFilePicker.saveFile = async options => {pickerOptions = options; return {path: '/home/docs.zip', existed: true};};
  const checkbox = app.grid.children[0].querySelector('.am-card-select');
  checkbox.checked = true; await checkbox.fire('change');
  await app.root.querySelector('[data-action="new-archive"]').fire('click');
  assert.equal(pickerOptions.filename, 'docs.zip');
  const posts = app.calls.filter(call => call[0] === 'post');
  assert.deepEqual(posts[0], ['post', 'archives/create', {archive_path: '/home/docs.zip', sources: ['/home/docs'], options: {overwrite: true}}]);
  assert.ok(app.toasts.includes('Archive creation started.'));
  assert.ok(!app.toasts.includes('Archive created successfully.'));
  assert.equal(app.notifications.at(-1).id, 'job-operation');
  app.notifications.at(-1).onDismiss();
});
test('Test Archive uses the app backend and tracks the returned job', async () => {
  const app = await mount({search: '?archive=%2Fhome%2Fa.zip'});
  await app.root.querySelector('[data-action="test-archive"]').fire('click');
  assert.deepEqual(app.calls.find(call => call[0] === 'post'), ['post', 'archives/test', {archive_path: '/home/a.zip'}]);
  assert.equal(app.notifications.at(-1).id, 'job-operation');
  app.notifications.at(-1).onDismiss();
});
test('failed job admission reports error without retry or tracking', async () => {
  const app = await mount({ search: '?archive=%2Fhome%2Fa.zip', jobFailure: true });
  const checkbox = app.grid.children[0].querySelector('.am-card-select'); checkbox.checked = true; await checkbox.fire('change');
  await app.root.querySelector('[data-action="extract"]').fire('click');
  assert.equal(app.calls.filter(call => call[1] === '/api/app/archive_manager/jobs').length, 1);
  assert.equal(app.notifications.length, 0); assert.ok(app.toasts.includes('admission failed'));
});
test('bundle retains existing asset URL and shared external job helper without extra adapter', async () => {
  const generated = await readFile(new URL('main.js', base), 'utf8');
  assert.match(generated, /Generated by build.mjs/); assert.match(generated, /\/static\/js\/jobs_client.js/);
  assert.doesNotMatch(generated, /\/static\/dist\//);
  const inventory = JSON.parse(await readFile(new URL('../../android_editor_assets_bundle.json', base), 'utf8'));
  assert.ok(JSON.stringify(inventory).includes('apps/archive_manager/main.js'));
});
