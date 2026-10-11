import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';

const source = await readFile(new URL('../app/apps/file_explorer/src/main.ts', import.meta.url), 'utf8');
const navigation = (await transform(source.slice(source.indexOf('  async function loadDirectory('), source.indexOf('  function createFolder(')), { loader: 'ts' })).code;
function fixture() {
  let resets = 0, response = { path: '/project', entries: [] }, resolve;
  const state = { currentPath: '/project', entries: [], view: 'list' };
  const context = { state, ui: {}, tabs: null, HOME_DIR: '~', showHidden: false,
    viewport: { captureListingFocus() {}, cancelFilter() {}, finishLoading() {}, resetFilter() { resets++; } },
    files: { async list() { if (resolve) return new Promise(resolve); if (response instanceof Error) throw response; return response; } },
    closeAllMenus() {}, clearSelection() {}, setLoading() {}, renderBreadcrumbs() {}, refreshFilter() {},
    updateActionButtons() {}, applyView() {}, persistState() {}, publishStatefulSidebarUrl() {}, toast() {}, host: {},
    notify() {}, actionError(error, fallback) { return error instanceof Error ? error.message : fallback; }, appLive: true,
    usage: { close() {}, sync() {}, directoryReady() {} },
  };
  const load = vm.runInNewContext('let directoryGeneration = 0, directoryScopeEpoch = 0;\n' + navigation + '\nObject.assign(loadDirectory, { scope: () => directoryScopeEpoch })', context);
  return { load, state, scope: load.scope, resets: () => resets, reply(value) { response = value; }, hold(fn) { resolve = fn; } };
}
test('successful navigation clears regex; same-directory refresh and failures do not', async () => {
  const f = fixture();
  await f.load('/project'); assert.equal(f.resets(), 0);
  f.reply(new Error('denied')); await f.load('/denied'); assert.equal(f.resets(), 0);
  f.reply({ path: '/other', entries: [] }); await f.load('/other');
  assert.equal(f.resets(), 1); assert.equal(f.state.currentPath, '/other');
});
test('stale listing completion cannot reset the current filter or change directory', async () => {
  const f = fixture(); let first;
  f.hold(resolve => { first = resolve; }); const older = f.load('/old');
  f.hold(null); f.reply({ path: '/new', entries: [] }); await f.load('/new');
  first({ path: '/old', entries: [] }); await older;
  assert.equal(f.resets(), 1); assert.equal(f.state.currentPath, '/new');
});
test('action scope fences away-and-back navigation but survives same-directory refresh and errors', async () => {
  const f = fixture();
  await f.load('/project'); assert.equal(f.scope(), 0);
  f.reply(new Error('denied')); await f.load('/denied'); assert.equal(f.scope(), 0);
  f.reply({ path: '/other', entries: [] }); await f.load('/other'); assert.equal(f.scope(), 1);
  f.reply({ path: '/project', entries: [] }); await f.load('/project'); assert.equal(f.scope(), 2);
  await f.load('/project'); assert.equal(f.scope(), 2);
});
test('tab identity change resets regex independently of path/options refresh', async () => {
  const start = source.indexOf('  async function applyTab(');
  const end = source.indexOf('  async function showTabs(', start);
  let resets = 0;
  const calls = [];
  const context = { terminalDrawer: null, usage: { sync() {} }, viewport: { resetFilter() { resets++; } },
    state: {}, ui: {}, tabsUI: { invalidateSplash() {} }, rememberTab() {}, showTabChrome() {}, showTabs() {},
    loadDirectory: async path => calls.push(path), JSON };
  const compiled = (await transform(source.slice(start, end), { loader: 'ts' })).code;
  const apply = vm.runInNewContext("let renderedTab = '', renderedTabId = '', directoryScopeEpoch = 0, applyingTab = 0, showHidden = false, appLive = true;\n" + compiled + '\napplyTab', context);
  return (async () => {
    const tab = { id: 'a', path: '/project', options: { showHidden: false, view: 'list', sortBy: 'name', sortAsc: true } };
    await apply(tab); await apply({ ...tab, options: { ...tab.options, showHidden: true } });
    assert.equal(resets, 1);
    await apply({ ...tab, id: 'b' }); assert.equal(resets, 2); assert.equal(calls.length, 3);
  })();
});
