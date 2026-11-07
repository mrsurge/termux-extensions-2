import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `
  export * from './monaco_editor/editor_model_utils.ts';
  export * from './monaco_editor/editor_mirror_runtime.ts';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const runtime = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function harness() {
  const models = new Map();
  let creations = 0;
  const monaco = { editor: { createModel(text, language, uri) {
    creations++;
    const key = String(uri);
    if (models.has(key)) throw Error('duplicate URI');
    const listeners = new Set();
    const model = {
      uri, text, disposals: 0, subscriptions: 0,
      getValue() { return this.text; }, getLanguageId: () => language,
      isDisposed() { return this.disposals > 0; },
      onDidChangeContent(callback) {
        listeners.add(callback); model.subscriptions++;
        return { dispose() { if (listeners.delete(callback)) model.subscriptions--; } };
      },
      edit(value) { this.text = value; for (const callback of [...listeners]) callback(); },
      dispose() { this.disposals++; models.delete(key); },
    };
    models.set(key, model); return model;
  } } };
  const uri = path => ({ toString: () => `file://${path}` });
  const acquire = (owner, path = '/project/a', content = 'initial') => runtime.createFileModel(monaco, owner, uri, content, 'text', path);
  return { monaco, acquire, uri, models, creations: () => creations,
    release: (owner, model) => runtime.releaseFileModel(monaco, owner, model),
    releaseOwner: owner => runtime.releaseFileModelOwner(monaco, owner) };
}

function view(model, path = '/project/a') {
  const state = { model, path, remote: false, connected: true, mirrors: [], wba: [], diffs: 0, edits: 0 };
  state.runtime = runtime.createEditorMirrorRuntime({
    getEditor: () => ({ onDidChangeModelContent() { assert.fail('must listen to the model, not each view'); } }),
    getCurrentPath: () => state.path, getModel: () => state.model,
    getBaseSha256: () => 'base', getIsApplyingRemote: () => state.remote,
    setLastLocalEditAt: () => state.edits++, getCurrentGeneration: () => 4,
    publishDidChange: (...args) => state.wba.push(args), requestDraftDiff: () => { state.diffs++; return true; },
    getLocalMirrorDebounceMs: () => 10, setMirrorActive() {}, incrementMirrorBindTotal() {}, syncTraceDebug() {},
    isRpcConnected: () => state.connected,
    rpcCall: async (method, payload) => { state.mirrors.push({ method, payload }); },
  });
  state.runtime.installMirrorPublisher(); return state;
}

test('two presentation leases share one canonical model without overwriting unpublished text', () => {
  const h = harness(), a = {}, b = {};
  const model = h.acquire(a);
  model.edit('unsaved');
  assert.equal(h.acquire(b, '/project/a', 'stale server content'), model);
  assert.equal(h.acquire(a), model);
  assert.equal(model.getValue(), 'unsaved');
  assert.equal(h.creations(), 1);
  h.release(a, model); h.release(a, model);
  assert.equal(model.disposals, 0);
  h.release(b, model); h.release(b, model);
  assert.equal(model.disposals, 1);
  assert.notEqual(h.acquire(a), model);
  h.releaseOwner(a);
});

test('owner teardown releases its leases only; failed canonical creation never invents an anonymous duplicate', () => {
  const h = harness(), a = {}, b = {};
  const shared = h.acquire(a), other = h.acquire(a, '/project/b');
  h.acquire(b);
  h.releaseOwner(a);
  assert.equal(shared.disposals, 0); assert.equal(other.disposals, 1);
  h.releaseOwner(b); assert.equal(shared.disposals, 1);
  let calls = 0;
  assert.throws(() => runtime.createFileModel({ editor: { createModel() { calls++; throw Error('collision'); } } }, {}, h.uri, '', 'text', '/foreign'), /collision/);
  assert.equal(calls, 1);
});

test('two views install one listener, publish once, and suppress remote edits from either view', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(), a = {}, b = {}, model = h.acquire(a); h.acquire(b);
  const first = view(model), second = view(model);
  first.runtime.installMirrorPublisher(); second.runtime.installMirrorPublisher();
  assert.equal(model.subscriptions, 1);
  model.edit('local'); t.mock.timers.tick(10);
  assert.equal(first.mirrors.length + second.mirrors.length, 1);
  assert.equal(first.wba.length + second.wba.length, 1);
  assert.equal(first.edits, 1); assert.equal(second.edits, 1);
  model.edit('pending local');
  second.remote = true; model.edit('remote'); second.remote = false;
  t.mock.timers.tick(20);
  assert.equal(first.mirrors.length + second.mirrors.length, 1);
  first.runtime.disposeMirrorPublisher(); h.release(a, model);
  assert.equal(model.subscriptions, 1); assert.equal(model.disposals, 0);
  model.edit('second view'); t.mock.timers.tick(10);
  assert.equal(second.mirrors.length, 1);
  second.runtime.disposeMirrorPublisher(); h.release(b, model);
  assert.equal(model.subscriptions, 0); assert.equal(model.disposals, 1);
});

test('queued work hands off to a surviving connected view; final disposal cancels it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(), a = {}, b = {}, model = h.acquire(a); h.acquire(b);
  const first = view(model), second = view(model);
  model.edit('pending'); first.runtime.disposeMirrorPublisher(); h.release(a, model);
  t.mock.timers.tick(10);
  assert.equal(second.mirrors.length, 1); assert.equal(first.mirrors.length, 0);
  model.edit('cancel'); second.runtime.disposeMirrorPublisher(); h.release(b, model);
  t.mock.timers.tick(10);
  assert.equal(second.mirrors.length, 1);
});

test('flush publishes once, disconnected ownership fails over, and path switches cannot retarget pending text', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(), a = {}, b = {}, model = h.acquire(a); h.acquire(b);
  const first = view(model), second = view(model);
  first.connected = false;
  model.edit('connected'); second.runtime.flushMirrorDebounce(); second.runtime.flushMirrorDebounce();
  t.mock.timers.tick(10);
  assert.equal(first.mirrors.length, 0); assert.equal(second.mirrors.length, 1);
  model.edit('must not become b'); second.path = '/project/b'; t.mock.timers.tick(10);
  assert.equal(second.mirrors.length, 1);
  const next = h.acquire(b, '/project/b'); second.model = next;
  second.runtime.installMirrorPublisher(); h.release(b, model);
  next.edit('actual b'); t.mock.timers.tick(10);
  assert.equal(second.mirrors[1].payload.path, '/project/b');
  assert.equal(second.mirrors[1].payload.content, 'actual b');
  first.runtime.disposeMirrorPublisher(); second.runtime.disposeMirrorPublisher(); h.releaseOwner(a); h.releaseOwner(b);
});
