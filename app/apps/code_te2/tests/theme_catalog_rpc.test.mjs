import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function loadModule(relative, plugins = []) {
  const result = await build({ entryPoints: [import.meta.dirname + '/../' + relative],
    bundle: true, write: false, format: 'esm', platform: 'browser', plugins });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { ensureThemeRegistryState, createDocumentThemeGate } = await loadModule('monaco_editor/editor_theme_registry_state_utils.ts');
const { createSettingsThemesController } = await loadModule('main_page/frontend/ui/settings-themes.ts');
const { parseThemeCatalog } = await loadModule('src/theme_catalog.ts');
const { createSettingsRefreshController } = await loadModule('main_page/frontend/ui/settings-refresh.ts', [{
  name: 'settings-text-field', setup(builder) {
    builder.onResolve({ filter: /cm6-json-textmate-field/ }, () => ({ path: 'field', namespace: 'test-field' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-field' }, () => ({ loader: 'js', contents:
      'export function createJsonTextmateField() { return { element: document.createElement("div"), getValue() { return ""; }, setValue() {} }; }',
    }));
  },
}]);
const theme = { id: 'github-dark', label: 'GitHub Dark', uiTheme: 'vs-dark', source: 'vendored',
  sourceLabel: 'GitHub', serveUrl: 'monaco_editor/themes/vendored/github/dark.json' };

test('catalog shares concurrent requests and caches only a validated success', async () => {
  const state = {};
  let resolve;
  let calls = 0;
  const request = () => { calls++; return new Promise(done => { resolve = done; }); };
  const first = ensureThemeRegistryState(state, request);
  const second = ensureThemeRegistryState(state, request);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({ themes: [theme] });
  assert.equal(await first, await second);
  assert.deepEqual(state.registry[theme.id], theme);
  assert.equal(state.promise, null);
  assert.equal(await ensureThemeRegistryState(state, request), state.registry);
  assert.equal(calls, 1);
});

test('disconnected and malformed catalogs stay retryable, with no HTTP fallback', async () => {
  const state = {};
  await assert.rejects(ensureThemeRegistryState(state, async () => { throw Error('disconnected'); }), /disconnected/);
  assert.equal(state.registry, undefined);
  assert.equal(state.promise, null);
  await assert.rejects(ensureThemeRegistryState(state, async () => ({ themes: [{}] })), /Invalid theme catalog entry/);
  const next = await ensureThemeRegistryState(state, async () => ({ themes: [theme] }));
  assert.equal(next[theme.id].serveUrl, theme.serveUrl);
  assert.throws(() => parseThemeCatalog({}), /Invalid theme catalog/);
  assert.deepEqual(parseThemeCatalog({ themes: [] }), { themes: [] });
});

test('document theme gate waits for connection and the latest theme, then reuses it', async () => {
  let connect, finish;
  const connection = new Promise(resolve => { connect = resolve; });
  const resource = new Promise(resolve => { finish = resolve; });
  const calls = [];
  const gate = createDocumentThemeGate(() => connection, async key => {
    calls.push(key);
    if (key === 'github-light') await resource;
  });
  let released = false;
  const first = gate.apply('github-dark').then(() => { released = true; });
  const latest = gate.apply('github-light');
  await Promise.resolve();
  assert.deepEqual(calls, []);
  assert.equal(released, false);
  connect();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['github-light']);
  assert.equal(released, false);
  const changed = gate.apply('github-dark-dimmed');
  finish();
  await Promise.all([first, latest, changed]);
  assert.deepEqual(calls, ['github-light', 'github-dark-dimmed']);
  assert.equal(released, true);
  await gate.apply('github-dark-dimmed');
  assert.equal(calls.length, 2);
});

test('failed theme gate rejects model waiters and retries without caching success', async () => {
  let attempts = 0;
  const gate = createDocumentThemeGate(async () => {}, async () => {
    if (++attempts === 1) throw Error('theme unavailable');
  });
  await assert.rejects(gate.apply('github-dark'), /theme unavailable/);
  await gate.apply('github-dark');
  assert.equal(attempts, 2);
});

test('theme picker uses injected host RPC, preserves selection, and displays request failures', async (t) => {
  const warning = t.mock.method(console, 'warn', () => {});
  const win = new Window();
  const element = () => win.document.createElement('div');
  const list = element(), summary = element();
  let failing = true;
  const updates = [], applied = [];
  const controller = createSettingsThemesController({
    themesModalEl: element(), themesCloseEl: element(), themesListEl: list,
    settingsThemeStripEl: element(), settingsThemeSummaryEl: summary,
    getEditorViewState: () => ({ theme: theme.id }),
    updatePreference: async (...args) => { updates.push(args); return true; },
    setEditorTheme: id => applied.push(id), toast: () => {},
    requestThemeCatalog: async () => {
      if (failing) throw Error('offline');
      return { themes: [theme] };
    },
  });
  try {
    await controller.refreshEditorThemesModal();
    assert.match(list.textContent, /Failed to load themes/);
    assert.equal(warning.mock.callCount(), 1);
    failing = false;
    await controller.refreshEditorThemesModal();
    const input = list.querySelector('input');
    assert.equal(input.value, theme.id);
    assert.equal(input.checked, true);
    input.dispatchEvent(new win.Event('change'));
    await Promise.resolve();
    assert.deepEqual(updates, [['theme', theme.id]]);
    assert.deepEqual(applied, [theme.id]);
    assert.equal(summary.textContent, theme.label);
  } finally { await win.happyDOM.close(); }
});

test('all production consumers use owning lanes and never the removed HTTP catalog', async () => {
  const read = path => fs.readFile(new URL('../' + path, import.meta.url), 'utf8');
  const main = await read('main.ts');
  const secondary = await read('main_page/frontend/secondary-editor-runtime.ts');
  const editor = await read('monaco_editor/m_editor_app.ts');
  assert.match(main, /requestThemeCatalog:.*requestUiIpc\(UI_IPC_RPC_METHODS.hostThemesList\)/);
  assert.match(secondary, /connection.request\(UI_IPC_RPC_METHODS.hostThemesList/);
  assert.match(editor, /editorRpcCall\(EDITOR_RPC_METHODS.themeSelected/);
  assert.doesNotMatch(editor, /editorRpcCall\(EDITOR_RPC_METHODS.themesList/);
  assert.match(editor, /async function ensureEditorWithPrefs\(\) \{\s*await ensureDocumentTheme\(\)/);
  for (const path of ['main_page/frontend/ui/settings-themes.ts', 'main_page/frontend/ui/settings-refresh.ts',
    'monaco_editor/editor_theme_registry_state_utils.ts', 'monaco_editor/historical_appearance.ts']) {
    assert.doesNotMatch(await read(path), /available_themes/);
  }
});

test('settings summary reads the host catalog and preserves selected name on RPC failure', async () => {
  const win = new Window();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = win.document;
  const summary = win.document.createElement('div');
  let fails = false;
  const controller = createSettingsRefreshController({
    settingsModalEl: win.document.createElement('div'), themeSummaryEl: summary,
    extSummaryEl: win.document.createElement('div'), extManagerModalEl: win.document.createElement('div'),
    customSettingsInputEl: win.document.createElement('textarea'),
    getEditorViewState: () => ({ theme: theme.id }), getUiPrefs: () => ({}),
    requestThemeCatalog: async () => {
      if (fails) throw Error('disconnected');
      return { themes: [theme] };
    },
  });
  try {
    await controller.refreshEditorSettingsModal();
    assert.equal(summary.textContent, 'GitHub Dark — 1 available');
    fails = true;
    await controller.refreshEditorSettingsModal();
    assert.equal(summary.textContent, theme.id);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
    await win.happyDOM.close();
  }
});

test('selected theme failure cannot publish a fallback or satisfy model readiness', async () => {
  const { applyMonacoThemeRuntime } = await loadModule('monaco_editor/editor_theme_apply_runtime_utils.ts');
  const win = new Window();
  const applied = [];
  let unavailable = true;
  const options = {
    win: { monaco: { editor: { setTheme: theme => applied.push(theme), defineTheme() {} } } },
    doc: win.document,
    getSelectedThemeFn: async () => {
      if (unavailable) throw Error('selected theme unavailable');
      return { id: 'github-light-default', uiTheme: 'vs', theme: { tokenColors: [] } };
    },
    toMonacoThemeFn: () => ({}),
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(applyMonacoThemeRuntime(options), /selected theme unavailable/);
    assert.deepEqual(applied, []);
    unavailable = false;
    await applyMonacoThemeRuntime(options);
    assert.deepEqual(applied, ['github-light-default']);
  } finally {
    console.warn = warn;
    await win.happyDOM.close();
  }
});
