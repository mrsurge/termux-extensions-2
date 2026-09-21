import assert from 'node:assert/strict';
import test from 'node:test';
import { CompletionWarmup, warmCompletionProvider } from '../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/intelligence/completion-warmup.mjs';
import { ProviderRegistry } from '../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/provider-registry.mjs';
import { WorkbenchClient } from '../workbench_protocol_proxy/node_workbench_adapter/dist/client/workbench-client.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const document = (path = '/workspace/main.py', languageId = 'python') => ({
  path, languageId, uri: { scheme: 'file', path },
});
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Exercise real WorkbenchClient event/readiness wiring with only the transport
// and document synchronization replaced; no live process or filesystem state.
async function clientFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'te2-warmup-test-'));
  const wb = new WorkbenchClient({ extensionStoragePath: root, webviewReconstructionStoragePath: root });
  t.after(async () => {
    wb._completionWarmup.reset();
    if (wb._metricsTimer) clearInterval(wb._metricsTimer);
    await rm(root, { recursive: true, force: true });
  });
  wb._useRemote = false;
  wb.ext = { protocol: {} };
  const doc = document();
  wb._documentRegistry.values = () => [doc];
  wb._documentRegistry.hydrateLogicalDocument = async () => ({ ok: true, path: doc.path });
  wb._semanticTokenProjections.invalidatePath = () => {};
  wb._semanticTokenProjections.schedule = () => {};
  wb._clientOperationGate.run = () => assert.fail('Warm-up must not acquire an interactive operation gate');
  const requests = [], releases = [];
  wb._sendExtPending = (...args) => {
    requests.push(args);
    return { promise: Promise.resolve({ type: 9, result: { x: 17, b: [], c: false } }) };
  };
  wb._sendExt = (...args) => releases.push(args);
  const register = () => {
    const outcome = wb._providerRegistry.registerFromRequest('$registerCompletionsProvider', [23, [{ language: 'python' }], [], true]);
    for (const event of outcome.events) wb._handleWorkbenchEvent(event);
  };
  return { wb, doc, requests, releases, register };
}

test('client registration waits for successful document synchronization in either order', async t => {
  for (const documentFirst of [false, true]) {
    const f = await clientFixture(t);
    if (documentFirst) await f.wb.hydrateLogicalDocument({});
    else f.register();
    await settle();
    assert.equal(f.requests.length, 0);
    if (documentFirst) f.register();
    else await f.wb.hydrateLogicalDocument({});
    await settle();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0][1], '$provideCompletionItems');
    assert.deepEqual(f.requests[0][2], [23, f.doc.uri, { lineNumber: 1, column: 1 }, { triggerKind: 0 }]);
    assert.equal(f.requests[0][4].timeoutMs, 30000);
    assert.equal(f.releases[0][1], '$releaseCompletionItems');
    assert.deepEqual(f.releases[0][2], [23, 17]);
    await f.wb.hydrateLogicalDocument({}); f.register(); await settle();
    assert.equal(f.requests.length, 1);
  }
});

test('failed hydration cannot warm a merely provisional document', async t => {
  const f = await clientFixture(t);
  f.wb._documentRegistry.hydrateLogicalDocument = async () => ({ ok: false });
  f.register(); await f.wb.hydrateLogicalDocument({}); await settle();
  assert.equal(f.requests.length, 0);
});

test('client does not release old result IDs into a replacement extension host', async t => {
  const f = await clientFixture(t);
  const pending = deferred();
  f.wb._sendExtPending = () => ({ promise: pending.promise });
  f.register(); await f.wb.hydrateLogicalDocument({}); await settle();
  f.wb.ext = { protocol: {} };
  pending.resolve({ type: 9, result: { x: 17, b: [] } }); await settle();
  assert.deepEqual(f.releases, []);
});

// Use the production selector registry, but no live extension host or timers.
function fixture(request = async () => {}) {
  const registry = new ProviderRegistry();
  const docs = [];
  const callbacks = [];
  const calls = [];
  const errors = [];
  let ready = true;
  const warmup = new CompletionWarmup({
    documents: () => docs,
    handles: doc => registry.findAllProviderHandlesForDocument('completions', { ...doc, scheme: 'file', authority: '' }),
    canRun: () => ready,
    request: (doc, handle) => { calls.push({ path: doc.path, handle, languageId: doc.languageId }); return request(doc, handle); },
    onError: error => errors.push(error), defer: fn => callbacks.push(fn),
  });
  return {
    warmup, docs, calls, errors,
    setReady: value => { ready = value; },
    register(handle = 23, selector = [{ language: 'python', scheme: 'file' }]) {
      const outcome = registry.registerFromRequest('$registerCompletionsProvider', [handle, selector, [], true]);
      for (const event of outcome.events) {
        assert.ok(['provider/completions', 'provider/completions/registered'].includes(event.type));
        warmup.notify();
      }
      return outcome;
    },
    async flush() { for (const fn of callbacks.splice(0)) fn(); await settle(); },
  };
}

test('provider before document and document before provider both warm exactly once', async () => {
  for (const documentFirst of [false, true]) {
    const f = fixture();
    if (documentFirst) { f.docs.push(document()); f.warmup.notify(); }
    else f.register();
    await f.flush();
    assert.equal(f.calls.length, 0);
    if (documentFirst) f.register();
    else { f.docs.push(document()); f.warmup.notify(); }
    await f.flush();
    assert.deepEqual(f.calls, [{ path: '/workspace/main.py', handle: 23, languageId: 'python' }]);
    f.register(); f.docs.push(document('/workspace/second.py')); f.warmup.notify();
    await f.flush();
    assert.equal(f.calls.length, 1);
  }
});

test('readiness blocks work without polling, then a successful open resumes it', async () => {
  const f = fixture();
  f.docs.push(document()); f.setReady(false); f.register();
  await f.flush(); await f.flush();
  assert.equal(f.calls.length, 0);
  f.setReady(true); f.warmup.notify(); await f.flush();
  assert.equal(f.calls.length, 1);
});

test('registration bursts and multiple clients/files do not duplicate an in-flight warm-up', async () => {
  const pending = deferred();
  const f = fixture(() => pending.promise);
  f.docs.push(document(), document('/workspace/other.py'));
  f.register(); f.register(); await f.flush();
  f.warmup.notify(); f.register(); await f.flush();
  assert.equal(f.calls.length, 1);
  pending.resolve(); await settle(); f.warmup.notify(); await f.flush();
  assert.equal(f.calls.length, 1);
});

test('each matching provider/language warms once, and selectors still exclude wrong documents', async () => {
  const f = fixture();
  f.docs.push(document('/workspace/no.txt', 'plaintext'), document(), document('/workspace/main.js', 'javascript'));
  f.register(23, [{ language: 'python' }, { language: 'javascript' }]);
  f.register(24, [{ pattern: '**/*.py', scheme: 'file' }]);
  await f.flush();
  assert.deepEqual(f.calls.map(x => [x.handle, x.languageId]).sort(), [[23, 'javascript'], [23, 'python'], [24, 'python']]);
});

test('real completion request before deferred work suppresses redundant synthetic request', async () => {
  const f = fixture();
  f.docs.push(document()); f.register(); f.warmup.markRequested(23, 'python');
  await f.flush(); assert.equal(f.calls.length, 0);
});

test('closing the candidate before dispatch prevents warming a missing document', async () => {
  const f = fixture(); f.docs.push(document()); f.register(); f.docs.length = 0;
  await f.flush(); assert.equal(f.calls.length, 0);
  f.docs.push(document('/workspace/new.py')); f.warmup.notify(); await f.flush();
  assert.equal(f.calls[0].path, '/workspace/new.py');
});

test('failed request is contained and not retried on tab changes', async () => {
  const f = fixture(async () => { throw new Error('provider unavailable'); });
  f.docs.push(document()); f.register(); await f.flush();
  f.warmup.notify(); await f.flush();
  assert.equal(f.calls.length, 1); assert.equal(f.errors.length, 1);
});

test('project/host reset fences queued work and allows a new session attempt', async () => {
  const f = fixture(); f.docs.push(document()); f.register();
  f.warmup.reset(); f.docs[0] = document('/new-project/a.py'); f.warmup.notify();
  await f.flush();
  assert.deepEqual(f.calls.map(x => x.path), ['/new-project/a.py']);
  f.warmup.reset(); f.warmup.notify(); await f.flush();
  assert.equal(f.calls.length, 2);
});

test('old in-flight completion cannot clear the new session running guard', async () => {
  const old = deferred(), fresh = deferred();
  let count = 0;
  const f = fixture(() => ++count === 1 ? old.promise : fresh.promise);
  f.docs.push(document()); f.register(); await f.flush();
  f.warmup.reset(); f.warmup.notify(); await f.flush();
  old.reject(new Error('old host gone')); await settle();
  f.register(24); await f.flush();
  assert.equal(f.calls.length, 2); assert.equal(f.errors.length, 0);
  fresh.resolve(); await settle();
  assert.equal(f.calls.length, 3);
});

test('warm-up discards completion payload and releases its cache, including empty lists', async () => {
  for (const items of [[], [{ a: 'hidden suggestion' }]]) {
    const released = [];
    const doc = document();
    const result = await warmCompletionProvider({
      request: async (handle, uri, timeoutMs) => {
        assert.equal(handle, 23); assert.equal(uri, doc.uri); assert.equal(timeoutMs, 30000);
        return { type: 9, result: { b: items, c: true, x: 0 } };
      },
      release: (...args) => released.push(args),
    }, doc, 23);
    assert.deepEqual(result, { itemCount: items.length, incomplete: true });
    assert.deepEqual(released, [[23, 0]]);
  }
});

test('null results, error replies and transport rejection never release invented cache IDs', async () => {
  let releaseCount = 0;
  const release = () => releaseCount++;
  const empty = await warmCompletionProvider({ request: async () => ({ type: 9, result: null }), release }, document(), 23);
  assert.equal(empty.itemCount, 0);
  await assert.rejects(warmCompletionProvider({ request: async () => ({ type: 10 }), release }, document(), 23));
  await assert.rejects(warmCompletionProvider({ request: async () => { throw new Error('timeout'); }, release }, document(), 23), /timeout/);
  assert.equal(releaseCount, 0);
});
