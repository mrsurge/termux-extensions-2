import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app/apps/file_explorer/src/main.js', import.meta.url), 'utf8');
const navigation = source.slice(source.indexOf('  async function loadDirectory('), source.indexOf('  async function createFolder('));
function fixture() {
  let resets = 0, response = { path: '/project', entries: [] }, resolve;
  const state = { currentPath: '/project', entries: [], view: 'list' };
  const context = { state, ui: {}, tabs: null, HOME_DIR: '~', showHidden: false,
    viewport: { captureListingFocus() {}, cancelFilter() {}, resetFilter() { resets++; } },
    files: { async list() { if (resolve) return new Promise(resolve); if (response instanceof Error) throw response; return response; } },
    closeAllMenus() {}, clearSelection() {}, setLoading() {}, renderBreadcrumbs() {}, refreshFilter() {},
    updateActionButtons() {}, applyView() {}, persistState() {}, publishStatefulSidebarUrl() {}, toast() {}, host: {},
  };
  const load = vm.runInNewContext('let directoryGeneration = 0;\n' + navigation + '\nloadDirectory', context);
  return { load, state, resets: () => resets, reply(value) { response = value; }, hold(fn) { resolve = fn; } };
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
test('tab identity change resets regex independently of path/options refresh', () => {
  const start = source.indexOf('  async function applyTab(');
  const end = source.indexOf('  async function showTabs(', start);
  let resets = 0;
  const calls = [];
  const context = { terminalDrawer: null, viewport: { resetFilter() { resets++; } },
    state: {}, ui: {}, tabsUI: { invalidateSplash() {} }, rememberTab() {}, showTabChrome() {}, showTabs() {},
    loadDirectory: async path => calls.push(path), JSON };
  const apply = vm.runInNewContext("let renderedTab = '', renderedTabId = '', splashGeneration = 0, applyingTab = 0, showHidden = false;\n" + source.slice(start, end) + '\napplyTab', context);
  return (async () => {
    const tab = { id: 'a', path: '/project', options: { showHidden: false, view: 'list', sortBy: 'name', sortAsc: true } };
    await apply(tab); await apply({ ...tab, options: { ...tab.options, showHidden: true } });
    assert.equal(resets, 1);
    await apply({ ...tab, id: 'b' }); assert.equal(resets, 2); assert.equal(calls.length, 3);
  })();
});
