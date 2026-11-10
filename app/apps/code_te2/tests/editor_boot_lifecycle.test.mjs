import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function load(path) {
  const result = await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'browser' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { EditorBootOwner } = await load('monaco_editor/editor_boot_owner.ts');

test('concurrent/repeated mount shares boot without resetting the DOM or snapshot', async () => {
  const owner = new EditorBootOwner();
  const root = {};
  let boots = 0;
  let finish;
  const first = owner.mount(root, () => { boots++; return new Promise(resolve => { finish = resolve; }); });
  const second = owner.mount(root, async () => { throw Error('must not replace live boot'); });
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(boots, 1);
  finish();
  await first;
  assert.equal(owner.mount(root, async () => { boots++; }), first);
  assert.equal(boots, 1);
});

test('unsafe second same-realm working editor fails before boot; separate realms remain independent', async () => {
  const owner = new EditorBootOwner();
  await owner.mount({}, async () => {});
  await assert.rejects(owner.mount({}, async () => { assert.fail('second boot'); }), /separate realms/);
  await new EditorBootOwner().mount({}, async () => {});
});

test('partial initialization failure is retained, not silently retried', async () => {
  const owner = new EditorBootOwner();
  const root = {};
  const failed = owner.mount(root, () => { throw Error('provider installation failed'); });
  await assert.rejects(failed, /provider installation/);
  assert.equal(owner.mount(root, async () => { assert.fail('unsafe retry'); }), failed);
});

test('keyboard runtime releases handlers and cannot rebind after disposal', async () => {
  const win = new Window();
  const saved = new Map(['window', 'document', 'CustomEvent'].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { window: win, document: win.document, CustomEvent: win.CustomEvent });
  try {
    const { installEditorKeyboardRuntime } = await load('monaco_editor/editor_keyboard_runtime.ts');
    let focused = 0, actions = 0;
    const root = win.document.createElement('div'); root.setAttribute('data-te2-working-editor-host', ''); win.document.body.append(root);
    const runtime = installEditorKeyboardRuntime({
      root,
      getEditor: () => ({ focus: () => focused++, hasTextFocus: () => true, addAction: () => actions++ }),
      getPrefs: () => ({}), updatePreference: async () => {},
    });
    runtime.bindEditor();
    win.dispatchEvent(new win.CustomEvent('code-te2:focus-editor'));
    assert.equal(focused, 1);
    runtime.dispose(); runtime.dispose(); runtime.bindEditor();
    win.dispatchEvent(new win.CustomEvent('code-te2:focus-editor'));
    win.dispatchEvent(new win.Event('pagehide'));
    assert.equal(focused, 1);
    assert.equal(actions, 1);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
    win.happyDOM.abort();
  }
});

test('host-action runtime unsubscribes once and fences callbacks already queued at disposal', async () => {
  const { createEditorRpcHostActionRuntime } = await load('monaco_editor/editor_rpc_host_action_runtime.ts');
  const handlers = [];
  const win = {};
  let releases = 0, adapterReady = 0;
  const runtime = createEditorRpcHostActionRuntime({
    getWindow: () => win, getEditor: () => null, getDiffEditor: () => null,
    replayOpenFileAfterBaton() {}, notifyEditorRpc: () => true,
    onAdapterReady: () => adapterReady++,
    onEditorRpcNotification: (_method, handler) => { handlers.push(handler); return () => releases++; },
  });
  runtime.connect(); runtime.connect();
  assert.equal(handlers.length, 3);
  handlers[0]({ status: 'ready' });
  assert.equal(adapterReady, 1);
  runtime.dispose(); runtime.dispose(); runtime.connect(); runtime.bindEditorHooks();
  const before = { ...win };
  for (const handler of handlers) handler({ status: 'ready', projectPath: '/stale' });
  assert.equal(releases, 3);
  assert.equal(adapterReady, 1);
  assert.deepEqual(win, before);
});

test('UI runtime disconnects its observer and removes resize handling permanently', async () => {
  const { createEditorUiEditorRuntime } = await load('monaco_editor/editor_ui_editor_runtime.ts');
  let observes = 0, disconnects = 0, layouts = 0;
  const listeners = new Set();
  let observerCallback;
  const win = {
    ResizeObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe() { observes++; }
      disconnect() { disconnects++; }
    },
    addEventListener: (_name, listener) => listeners.add(listener),
    removeEventListener: (_name, listener) => listeners.delete(listener),
  };
  const runtime = createEditorUiEditorRuntime({
    getWindow: () => win, getEditorContainer: () => ({}),
    getEditor: () => ({ layout: () => layouts++ }), getDiffEditor: () => null,
  });
  runtime.ensureLayoutObserver(); runtime.ensureLayoutObserver();
  assert.equal(observes, 1);
  assert.equal(listeners.size, 1);
  observerCallback();
  assert.equal(layouts, 1);
  runtime.dispose(); runtime.dispose(); runtime.ensureLayoutObserver();
  observerCallback(); runtime.layoutEditors();
  assert.equal(disconnects, 1);
  assert.equal(listeners.size, 0);
  assert.equal(layouts, 1);
  assert.equal(observes, 1);
});

test('working boot is explicit, not an import side effect or shared snapshot mailbox', async () => {
  const runtime = await readFile('monaco_editor/m_editor_app.ts', 'utf8');
  const host = await readFile('monaco_editor/inline_host.ts', 'utf8');
  assert.match(runtime, /export function startWorkingEditorRuntime\(options:/);
  assert.match(host, /await startWorkingEditorRuntime\(/);
  for (const source of [runtime, host]) {
    assert.doesNotMatch(source, /__te2InlineMonaco(?:BootSnapshot|BuildSidebarMentionPayload|RuntimeBoot)/);
  }
});
