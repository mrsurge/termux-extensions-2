import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const appRoot = new URL('../', import.meta.url).pathname;
const bundle = await build({ stdin: { contents: `
  export { registerEditorSocketConnectionHandlers } from './monaco_editor/editor_socket_connection_runtime.ts';
  export { runEditorOpenTransaction } from './monaco_editor/editor_open_transaction_runner_main.ts';
  export { createEditorOpenTransactionStore, queueOpenTransaction } from './monaco_editor/editor_open_transaction_state.ts';
  export { resetDocumentRevisionRuntime } from './monaco_editor/editor_document_revision_runtime.ts';
`, resolveDir: appRoot }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const runtime = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
const file = path => ({ path, content: path, document_revision: 1 });

function harness(t) {
  t.mock.method(console, 'log', () => {});
  runtime.resetDocumentRevisionRuntime();
  const notifications = new Map(), socketEvents = new Map(), mounts = [], ready = [];
  const store = runtime.createEditorOpenTransactionStore();
  let path = null, model = null, generation = 0;
  const blocked = new Map();
  const editor = { setModel: value => mounts.push(value?.uri.toString()), layout() {} };
  const values = {
    rpcNotifications: { onNotification: (name, fn) => notifications.set(name, fn) },
    openTransactionStore: store,
    getCachedPrefs: () => ({ preferences: {} }),
    getCurrentPath: () => path, setCurrentPath: value => { path = value; },
    getModel: () => model, setModel: value => { model = value; },
    getEditor: () => editor, getDiffEditor: () => null,
    getBaseSha256: () => null, getLastContentSha256: () => null,
    ensureEditorWithPrefs: async () => {},
    languageFromPath: () => 'plaintext',
    prepareTextmateForDocument: async value => {
      if (blocked.has(value)) await blocked.get(value).promise;
      return 'plaintext';
    },
    createFileModel: (text, language, value) => ({
      uri: { toString: () => value }, getValue: () => text,
      getLanguageId: () => language, dispose() {},
    }),
    monacoFileUri: (...args) => ({ toString: () => args.at(-1) }),
    absPathFromVscodeUri: value => value,
    wbBumpGeneration: () => ++generation, wbCurrentGeneration: () => generation,
    getShowInlineDiffs: () => false, getShowDraftDiffs: () => false,
    coercePositiveInt: () => null,
    emitModelReady: value => { ready.push(value.path); return true; },
    requestAgentEditDocumentState: async () => {},
    wbOpenFileFlow: async () => {}, openFileFlow: async () => {},
    queueOpenTransaction: fn => runtime.queueOpenTransaction(store, fn),
    runEditorOpenTransaction: (value, isCurrent) => runtime.runEditorOpenTransaction(deps, value, isCurrent),
  };
  // Unrelated presentation hooks are inert; real selection/revision/queue code runs.
  const deps = new Proxy(values, { get: (target, key) => key in target ? target[key] : () => undefined });
  runtime.registerEditorSocketConnectionHandlers({ on: (name, fn) => socketEvents.set(name, fn) }, deps);
  return {
    mounts, ready, path: () => path,
    snapshot: value => notifications.get('editor.state.ssot')({ file: value, preferences: {} }),
    open: value => notifications.get('editor.file.opened')(value),
    disconnect: () => socketEvents.get('disconnect')(),
    block(value) {
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      blocked.set(value, { promise });
      return release;
    },
    settled: async () => { await store.openTransactionChain; await tick(); },
  };
}

test('delayed reconnect snapshot cannot overwrite a newer explicit open', async t => {
  const h = harness(t), release = h.block('/project/A.md');
  h.snapshot(file('/project/A.md')); await tick();
  h.open(file('/project/B.txt')); await h.settled();
  release(); await tick();
  assert.equal(h.path(), '/project/B.txt');
  assert.deepEqual(h.mounts, ['/project/B.txt']);
  assert.deepEqual(h.ready, ['/project/B.txt']);
});

test('delayed explicit open cannot overwrite a newer reconnect snapshot', async t => {
  const h = harness(t), release = h.block('/project/A.md');
  h.open(file('/project/A.md')); await tick();
  h.snapshot(file('/project/B.txt')); await tick();
  release(); await h.settled();
  assert.equal(h.path(), '/project/B.txt');
  assert.deepEqual(h.mounts, ['/project/B.txt']);
});

test('newest queued selection wins without mounting intermediate files', async t => {
  const h = harness(t), release = h.block('/project/A.md');
  h.open(file('/project/A.md')); await tick();
  h.open(file('/project/B.txt')); h.open(file('/project/C.txt'));
  release(); await h.settled();
  assert.equal(h.path(), '/project/C.txt');
  assert.deepEqual(h.mounts, ['/project/C.txt']);
});

test('empty replay invalidates an unfinished explicit open', async t => {
  const h = harness(t), release = h.block('/project/A.md');
  h.open(file('/project/A.md')); await tick();
  h.snapshot(null); release(); await h.settled();
  assert.deepEqual(h.mounts, []);
  assert.deepEqual(h.ready, []);
});

test('disconnect invalidates unfinished snapshot and explicit open work', async t => {
  for (const kind of ['snapshot', 'open']) {
    const h = harness(t), release = h.block('/project/A.md');
    h[kind](file('/project/A.md')); await tick();
    h.disconnect(); release(); await h.settled();
    assert.deepEqual(h.mounts, []);
    assert.deepEqual(h.ready, []);
  }
});
