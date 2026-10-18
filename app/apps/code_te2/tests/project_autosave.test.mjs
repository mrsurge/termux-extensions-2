import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
const built = await build({ stdin: { contents: `
export * from './main_page/frontend/ui/preferences.ts';
export * from './main_page/frontend/ui/autosave-modal.ts';
export * from './monaco_editor/editor_save_mirror_socket_handlers.ts';
export * from './monaco_editor/editor_rpc_contract.ts';
export * from './monaco_editor/editor_ui_editor_runtime.ts';
export * from './monaco_editor/editor_rpc_transport.ts';
`, resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, format: 'esm' });
const api = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text + '\n//# sourceURL=project_autosave.test.bundle.mjs').toString('base64')}`);

test('preference projections reject another project and older same-project mode', async () => {
  const previousElement = globalThis.HTMLElement;
  globalThis.HTMLElement = class {};
  let project = '/a', state, resolve;
  const controller = api.createPreferencesController({
    getProject: () => project, getClientId: () => null, getMenuItems: () => ({}),
    setEditorViewState: value => { state = value; }, setMenuChecked() {}, applyFontScale() {},
    requestBackendEditorStateGet: () => new Promise(done => { resolve = done; }),
    requestBackendEditorPreferenceUpdate: async () => ({ ok: true }),
  });
  const prefs = (root, revision, autoSave) => ({ autosaveProject: root, autosaveRevision: revision, autoSave });
  assert.equal(controller.applyPreferencesChangedPayload({ view_state: prefs('/a', 2, true) }), true);
  assert.equal(controller.applyPreferencesChangedPayload({ view_state: prefs('/a', 1, false) }), false);
  assert.equal(state.autoSave, true);
  const pending = controller.refreshMenuState();
  project = '/b';
  resolve({ view_state: prefs('/a', 3, false) }); await pending;
  assert.equal(state.autoSave, true);
  assert.equal(controller.applyPreferencesChangedPayload({ view_state: prefs('/b', 0, false) }), true);
  project = '/a';
  assert.equal(controller.applyPreferencesChangedPayload({ view_state: prefs('/a', 1, false) }), false);
  assert.equal(controller.applyPreferencesChangedPayload({ view_state: prefs('/a', 2, true) }), true);
  globalThis.HTMLElement = previousElement;
});

test('mode dialog offers all three explicit choices and Cancel never mutates', async () => {
  const win = new Window();
  const previous = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement };
  Object.assign(globalThis, { window: win, document: win.document, HTMLElement: win.HTMLElement });
  const calls = [];
  try {
    const controller = api.createAutosaveModalController({ getProject: () => '/a',
      request: async payload => { calls.push(payload); return { ok: true, preview: { project: '/a', count: 3, token: 'receipt' } }; },
      refresh: async () => {}, toast: assert.fail,
    });
    const pending = controller.showAutosaveModal();
    await Promise.resolve(); await Promise.resolve();
    const buttons = [...document.querySelectorAll('.declarative-modal-footer button')];
    assert.deepEqual(buttons.map(button => button.textContent), ['Save All and Enable', 'Discard All and Enable', 'Cancel']);
    assert.match(document.body.textContent, /3 unsaved file/);
    buttons[2].click();
    assert.equal(await pending, false);
    assert.equal(calls.length, 1);
    assert.equal(document.querySelector('.fe-modal'), null);
  } finally { Object.assign(globalThis, previous); await win.happyDOM.abort(); }
});

test('snapshot freeze is acknowledged only by a supporting editor and cleared on disconnect', () => {
  const callbacks = new Map(), socketEvents = new Map(), responses = [], paused = [];
  api.registerEditorSaveMirrorSocketHandlers({ on: (name, callback) => socketEvents.set(name, callback) }, {
    rpcNotifications: { onNotification: (name, callback) => callbacks.set(name, callback) },
    setAutosaveTransitionReadOnly: value => paused.push(value),
    getCurrentPath: () => '/a/file', getModel: () => ({ getValue: () => 'text' }),
    getBaseSha256: () => 'a'.repeat(64), emitToHost: (_event, response) => responses.push(response),
  });
  const snapshot = callbacks.get(api.EDITOR_RPC_NOTIFICATIONS.saveSnapshotRequest);
  snapshot({ requestId: 'one', autosaveFreeze: 'token' });
  assert.equal(responses[0].autosaveFreeze, 'token');
  snapshot({ requestId: 'two', autosaveRelease: 'wrong' });
  assert.equal(responses[1].autosaveFreeze, 'token');
  socketEvents.get('disconnect')();
  assert.deepEqual(paused, [true, false]);
});

test('real configuration listener never persists a snapshot pause or its release', () => {
  let readOnly = false;
  const calls = [], replies = [], handlers = new Map();
  const editor = { getOption: () => readOnly, updateOptions: options => {
    readOnly = options.readOnly;
    runtime.onEditorConfigChanged(editor);
  } };
  const runtime = api.createEditorUiEditorRuntime({
    getMonaco: () => ({ editor: { EditorOption: { readOnly: 1 } } }),
    getDocument: () => ({}), getEditor: () => editor,
    updatePreference: async payload => { calls.push(payload); },
  });
  runtime.onEditorConfigChanged(editor);
  api.registerEditorSaveMirrorSocketHandlers({ on() {} }, {
    rpcNotifications: { onNotification: (name, callback) => handlers.set(name, callback) },
    setAutosaveTransitionReadOnly: paused => runtime.withTransientReadOnlyChange(() => editor.updateOptions({ readOnly: paused })),
    getCurrentPath: () => '/project/file', getModel: () => ({ getValue: () => 'content' }),
    getBaseSha256: () => 'a'.repeat(64), emitToHost: (_event, reply) => replies.push(reply),
  });
  const request = handlers.get(api.EDITOR_RPC_NOTIFICATIONS.saveSnapshotRequest);
  request({ requestId: 'freeze', autosaveFreeze: 'receipt' });
  assert.equal(readOnly, true);
  assert.equal(replies[0].autosaveFreeze, 'receipt');
  request({ requestId: 'release', autosaveRelease: 'receipt' });
  assert.equal(readOnly, false);
  assert.deepEqual(calls, []);
  editor.updateOptions({ readOnly: true });
  assert.deepEqual(calls, [{ key: 'readOnly', value: true }]);
  assert.throws(() => runtime.withTransientReadOnlyChange(() => { throw new Error('test'); }));
  editor.updateOptions({ readOnly: false });
  assert.equal(calls.length, 2);
});

test('snapshot responses use reliable sends even while volatile writes would drop', async () => {
  const sent = [], events = new Map();
  const errors = [];
  let volatileAttempts = 0;
  const socket = {
    connected: true, emit: (event, payload) => sent.push({ event, payload }),
    on: (event, callback) => events.set(event, callback), sendBuffer: [],
    volatile: { emit: () => { volatileAttempts += 1; /* busy socket drops */ } },
  };
  const codec = { id: 'test', encode: value => value, decode: value => value };
  const transport = api.createEditorRpcTransport({ codec, getSocket: () => socket,
    setTimeoutFn: () => 1, clearTimeoutFn() {}, onReliablePublishError: (_method, error) => errors.push(error) });
  transport.attachSocket(socket);
  assert.equal(api.publishEditorControlResponse(transport, 'editor_save_snapshot_response', { requestId: 'backend-request', autosaveFreeze: 'receipt' }), true);
  assert.equal(volatileAttempts, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.method, api.EDITOR_RPC_METHODS.saveSnapshotResponse);
  assert.equal(sent[0].payload.params.autosaveFreeze, 'receipt');
  // Disconnect rejects this accepted send and clears any socket replay buffer.
  socket.sendBuffer.push('must not replay');
  socket.connected = false;
  events.get('disconnect')();
  await Promise.resolve();
  assert.equal(errors.length, 1);
  assert.equal(transport.getPendingRequests().size, 0);
  assert.deepEqual(socket.sendBuffer, []);
  assert.equal(api.publishEditorControlResponse(transport, 'editor_save_snapshot_response', {}), false);
  assert.equal(api.publishEditorControlResponse(transport, 'editor_cache_state', {}), null);
});
