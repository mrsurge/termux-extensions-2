import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';
import { Window } from 'happy-dom';

const appRoot = path.resolve(import.meta.dirname, '..');
let moduleSequence = 0;

async function importBootSequence() {
  const result = await build({
    entryPoints: [
      path.join(appRoot, 'main_page/frontend/boot/boot-sequence.ts'),
    ],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleSequence++}`
  );
}

test('managed Code Server is rechecked before a stale missing snapshot can prompt', async () => {
  let dialogCalls = 0;
  globalThis.window = {
    teUI: {
      dialog: {
        open: async () => {
          dialogCalls += 1;
          throw new Error('the install dialog must not open');
        },
      },
    },
  };
  const { prepareCodeServer } = await importBootSequence();
  const seeded = [];
  let backendSetCalls = 0;
  const snapshot = {
    ui_prefs: { webWorkersEnabled: false },
    code_server: { compatible: false, state: 'missing' },
  };

  const ready = await prepareCodeServer(
    snapshot,
    snapshot.ui_prefs,
    {
      requestBackendBootSnapshot: async () => ({
        ok: true,
        snapshot: {
          ui_prefs: { webWorkersEnabled: false },
          code_server: {
            compatible: true,
            state: 'ready',
            executable: '/data/te2/code_server/4.130.0/bin/code-server',
          },
        },
      }),
      requestBackendLanguageBackendSet: async () => {
        backendSetCalls += 1;
        return { ok: true };
      },
      seedUiPrefsSnapshot: (value) => seeded.push({ ...value }),
      spinnerSetStep: () => {},
    },
  );

  assert.equal(ready, true);
  assert.equal(dialogCalls, 0);
  assert.equal(backendSetCalls, 0);
  assert.equal(snapshot.code_server.compatible, true);
  assert.deepEqual(seeded, [{ webWorkersEnabled: false }]);
});

test('host mounts and restores a document while WBA readiness is pending', async () => {
  const win = new Window();
  globalThis.window = win;
  globalThis.CustomEvent = win.CustomEvent;
  const { runBootSequence } = await importBootSequence();
  const calls = [];
  let ready;
  const readiness = new Promise((resolve) => { ready = resolve; });
  const snapshot = {
    ui_prefs: { webWorkersEnabled: false }, code_server: { compatible: true },
    session_state: {}, host_state: { activeProject: '/project', activeProjectExists: true, currentPath: '/project/file.py' },
  };
  const noop = () => {};
  const deps = {
    initResponsiveLayout: noop, loadLayoutPreferences: noop, initResizeManager: noop,
    initExplorerUI: async () => {}, requestBackendBootSnapshot: async () => ({ ok: true, snapshot }),
    seedUiPrefsSnapshot: noop, seedPersistedSessionState: noop, hydrateEditorState: noop,
    setBranchMenuHandle: noop, initBranchMenu: noop,
    ensureWorkbenchAdapterReady: () => { calls.push('wait'); return readiness; },
    connectUIIPC: async () => { calls.push('ipc'); },
    mountInlineEditorHost: async () => { calls.push('mount'); }, connectSidebarIPC: noop,
    applySidebarUiPrefs: noop, broadcastRecentsUpdate: noop, refreshMenuState: async () => {},
    apiPost: async () => {}, initSessionStateContext: noop, queueSessionStateUpdate: noop,
    resetSavedState: noop, markUnsaved: noop, getUrlSearch: () => '',
    applyRestoredPathState: () => { calls.push('document'); },
    openWebSocket: () => { throw new Error('Legacy file socket must not open during boot'); },
  };
  try {
    // A hanging readiness promise must not hold the returned boot promise open.
    await Promise.race([runBootSequence(deps), new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('boot waited for WBA')), 1000);
      timer.unref();
    })]);
    assert.deepEqual(calls, ['wait', 'ipc', 'mount', 'document']);
    ready(true);
    calls.length = 0;
    snapshot.ui_prefs.webWorkersEnabled = true;
    await runBootSequence(deps);
    assert.deepEqual(calls, ['ipc', 'mount', 'document']);
  } finally { ready(false); win.happyDOM.abort(); }
});

async function importMonacoBoot() {
  const built = await build({
    entryPoints: [path.join(appRoot, 'monaco_editor/editor_monaco_boot_runtime.ts')],
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'monaco-fixture', setup(builder) {
      builder.onResolve({ filter: /monaco\.bootstrap\.bundle\.js$/ }, () => ({ path: 'monaco', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export async function loadMonaco() { return {}; }', loader: 'js' }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
}

test('boot connects before theme wait and attaches no document until colors are ready', async () => {
  const { bootMonacoRuntime } = await importMonacoBoot();
  const win = new Window();
  const previousWorker = globalThis.Worker;
  globalThis.Worker = class {};
  const calls = [];
  let ready;
  const theme = new Promise(resolve => { ready = resolve; });
  let prefs = null;
  const noop = () => {};
  try {
    const boot = bootMonacoRuntime({
      getWindow: () => win, getApiBase: () => '', getBootSnapshot: () => ({}),
      getCachedPrefs: () => prefs, languageWorkersEnabled: () => true, getWorkerLogOnce: () => ({}),
      ensureTe2DiffTheme: noop,
      applyBootSnapshot: (includeDocument = true) => {
        calls.push(includeDocument ? 'model' : 'preferences'); prefs = {};
      },
      connectEditorHostActions: () => calls.push('subscribe'),
      connectEditorSocket: () => calls.push('connect'),
      ensureDocumentTheme: async () => { calls.push('theme-request'); await theme; calls.push('theme-applied'); },
      ensureEditorWithPrefs: async () => calls.push('attach'),
      applyActiveModelLanguage: noop, collectBootLanguageIds: () => [], warnIfPlaintextOnlyLanguages: noop,
      emitToHost: name => calls.push(name), updateDebug: noop, onReady: () => calls.push('ready'),
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['preferences', 'subscribe', 'connect', 'theme-request']);
    ready(); await boot;
    assert.deepEqual(calls, ['preferences', 'subscribe', 'connect', 'theme-request', 'theme-applied',
      'model', 'attach', 'editor_ready', 'ready']);
  } finally { ready(); globalThis.Worker = previousWorker; await win.happyDOM.close(); }
});

test('theme failure rejects boot readiness instead of mounting an unthemed document', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { bootMonacoRuntime } = await importMonacoBoot();
  const win = new Window();
  const previousWorker = globalThis.Worker;
  globalThis.Worker = class {};
  const calls = [];
  const noop = () => {};
  try {
    await bootMonacoRuntime({
      getWindow: () => win, getApiBase: () => '', getBootSnapshot: () => ({}), getCachedPrefs: () => ({}),
      languageWorkersEnabled: () => true, getWorkerLogOnce: () => ({}), ensureTe2DiffTheme: noop,
      applyBootSnapshot: () => calls.push('model'), ensureEditorWithPrefs: async () => calls.push('attach'),
      connectEditorHostActions: noop, connectEditorSocket: () => calls.push('connect'),
      ensureDocumentTheme: async () => { throw Error('theme failed'); },
      emitToHost: name => calls.push(name), updateDebug: noop, onReady: () => calls.push('ready'),
      onError: error => calls.push(error.message),
    });
    assert.deepEqual(calls, ['connect', 'theme failed']);
  } finally { globalThis.Worker = previousWorker; await win.happyDOM.close(); }
});

test('Monaco editor-ready does not wait for the WBA language catalog', { timeout: 2000 }, async () => {
  const { bootMonacoRuntime } = await importMonacoBoot();
  const win = new Window();
  const previousWorker = globalThis.Worker;
  globalThis.Worker = class {};
  const calls = [];
  let resolveCatalog;
  const catalog = new Promise((resolve) => { resolveCatalog = resolve; });
  const noop = () => {};
  try {
    await bootMonacoRuntime({
      getWindow: () => win, getApiBase: () => '', getBootSnapshot: () => ({}),
      getCachedPrefs: () => ({}), languageWorkersEnabled: () => false, getWorkerLogOnce: () => ({}),
      ensureTe2DiffTheme: noop, ensureDocumentTheme: async () => {}, applyBootSnapshot: noop,
      ensureEditorWithPrefs: async () => { calls.push('editor'); },
      connectEditorHostActions: noop, connectEditorSocket: noop,
      ensureWorkbenchLanguageCatalogInstalled: () => catalog,
      installWorkbenchLanguageBridgeProviders: () => { calls.push('providers'); },
      applyActiveModelLanguage: noop, collectBootLanguageIds: () => [], warnIfPlaintextOnlyLanguages: noop,
      emitToHost: (name) => { calls.push(name); }, updateDebug: noop,
      onReady: () => { calls.push('local_ready'); },
    });
    assert.deepEqual(calls, ['editor', 'editor_ready', 'local_ready']);
    resolveCatalog(true);
    await Promise.resolve();
    assert.deepEqual(calls, ['editor', 'editor_ready', 'local_ready', 'providers']);
  } finally { resolveCatalog(false); globalThis.Worker = previousWorker; win.happyDOM.abort(); }
});
