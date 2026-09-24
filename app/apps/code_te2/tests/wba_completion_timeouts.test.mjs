import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { encode, decode } from '@msgpack/msgpack';
import { completionTimeouts } from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/completion-timeouts.mjs';
import { provideCompletions, synchronizeCompletionText } from '../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/intelligence/completions.mjs';
import { dispatchJsonRpcRequest } from '../workbench_protocol_proxy/node_workbench_adapter/dist/server/request-dispatch.mjs';
import { ClientOperationGate } from '../workbench_protocol_proxy/node_workbench_adapter/dist/client/client-operation-gate.mjs';
import { PendingExtRequestOwner } from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/pending-requests.mjs';

async function loadSource(relative) {
  if (process.versions.bun) return import(new URL(relative, import.meta.url).href);
  const built = await build({
    entryPoints: [new URL(relative, import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false,
  });
  const code = `${built.outputFiles[0].text}\n//# sourceURL=te2-test/${relative.split('/').pop()}\n`;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { provideWorkbenchCompletionItemsFromVscodeSuggest } = await loadSource('../monaco_editor/vscode_completion_vendor/suggest.ts');
const { createEditorWbaRpcTransport } = await loadSource('../monaco_editor/editor_wba_rpc_transport.ts');

async function settle() {
  for (let index = 0; index < 60; index++) await Promise.resolve();
}

// Drive the real browser timer, document gate and extension pending-request owner
// with one clock, so slow-device regression tests need no wall-clock sleeps.
function clock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const setTimeoutFn = (callback, delay) => {
    const id = ++sequence;
    timers.set(id, { at: now + delay, callback });
    return id;
  };
  return {
    now: () => now, setTimeoutFn,
    clearTimeoutFn: id => timers.delete(id),
    sleep: delay => new Promise(resolve => setTimeoutFn(resolve, delay)),
    async advance(delay) {
      const target = now + delay;
      await settle();
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await settle();
      }
      now = target;
      await settle();
    },
    get pending() { return timers.size; },
  };
}

let fixtureId = 0;
function fixture({ replyMs = 20000, preflightMs = 0, queueMs = 0, secondQueueMs = 0, providerWaitMs = 0, pinned = false, neverReply = false, providerHandles = [23] } = {}) {
  const time = clock();
  const gate = new ClientOperationGate(time);
  const pending = new PendingExtRequestOwner(time);
  const handlers = new Map();
  const budgets = [];
  let registered = !providerWaitMs;
  let occupied;
  if (queueMs) occupied = gate.run('other-client', () => time.sleep(queueMs), { label: 'other', timeoutMs: queueMs + 1000 });
  const completionRuntime = {
    ensureConnected() {}, defaultAuthority: () => 'test', documentScheme: () => 'file',
    languageFeaturesRpcId: 94, languageIdFromPath: () => 'python',
    didChange: async () => { await time.sleep(preflightMs); return { ok: true }; },
    findAllProviderHandles: () => registered ? providerHandles : [],
    waitFor: async () => { await time.sleep(providerWaitMs); registered = true; return true; },
    uriForPath: path => ({ scheme: 'file', path }), log() {}, warn() {},
    sendExtPending(_rpc, _method, _args, _cancellable, options) {
      budgets.push(options.timeoutMs);
      const req = pending.allocReqId();
      const promise = pending.createPromise(req, options);
      if (!neverReply) time.setTimeoutFn(() => pending.resolveReply({
        req, type: 9, result: { b: [{ a: 'example', h: 'example' }] },
      }), typeof replyMs === 'function' ? replyMs(_args[0]) : replyMs);
      return { promise };
    },
  };
  const runtime = {
    normalizePathParam: params => params.path,
    normalizeAuthorityParam: () => 'test', defaultRemoteAuthority: 'test',
    wb: {
      resolveLanguageId: () => 'python',
      activateLanguage: async () => {
        if (secondQueueMs) {
          occupied = gate.run('other-client', () => time.sleep(secondQueueMs), { label: 'between', timeoutMs: secondQueueMs + 1000 });
        }
        return { ok: true };
      },
      runClientDocumentOperation(params, label, operation, timeoutMs) {
        budgets.push(timeoutMs);
        return gate.run('client', operation, { label, timeoutMs });
      },
      async prepareCompletions(params) {
        const synced = await synchronizeCompletionText(completionRuntime, params);
        return async () => {
          if (synced.ok !== true) return synced;
          const reply = await provideCompletions(completionRuntime, { ...params, text: undefined });
          return reply.ok === true ? { ok: true, result: { sessionId: 'test-session', ...reply.result } } : reply;
        };
      },
    },
  };
  const socket = {
    connected: true,
    on: (event, fn) => handlers.set(event, fn),
    emit(_event, payload) {
      const request = decode(payload);
      void dispatchJsonRpcRequest(runtime, request).then(
        reply => handlers.get('rpc')(encode(reply, { ignoreUndefined: true })),
        error => handlers.get('rpc')(encode({ jsonrpc: '2.0', id: request.id, error: { message: error.message } })),
      );
    },
  };
  const transport = createEditorWbaRpcTransport({ ...time, getSocket: () => socket });
  transport.attachSocket(socket);
  const path = `/completion-${++fixtureId}.py`;
  const deps = {
    releaseCompletionItems: async () => {},
    languageId: 'python', model: {
      uri: { toString: () => `file://${path}` }, getValue: () => 'ex',
      getLanguageId: () => 'python', getVersionId: () => 1,
    },
    position: { lineNumber: 1, column: 3 }, context: {}, propertyKind: 9,
    getCurrentPath: () => path, absPathFromVscodeUri: () => path,
    providerHandle: pinned ? 23 : undefined,
    callWorkbenchCompletions(params, options) {
      budgets.push(options.timeoutMs);
      return transport.call('vscode.completions', params, options);
    },
  };
  return { time, gate, pending, budgets, deps, transport, handlers, occupied };
}

test('completion budgets cover preparation, the existing gate queue and transport', () => {
  assert.deepEqual(completionTimeouts(), { providerMs: 30000, preflightMs: 5000, operationMs: 45000, rpcMs: 195000 });
  for (const value of [undefined, NaN, Infinity, -1, 0, 'invalid']) assert.equal(completionTimeouts(value).providerMs, 30000);
  const bounded = completionTimeouts(1e9);
  assert.equal(bounded.operationMs, 120000);
  assert.ok(bounded.rpcMs > bounded.operationMs * 2 + 5000);
});

for (const pinned of [false, true]) test(`slow completion survives old deadlines (pinned=${pinned})`, async () => {
  const f = fixture({ pinned, replyMs: 29000, preflightMs: 4000, queueMs: 20000 });
  let completed = false;
  const result = provideWorkbenchCompletionItemsFromVscodeSuggest(f.deps).then(value => { completed = true; return value; });
  await f.time.advance(10000);
  assert.equal(completed, false);
  await f.time.advance(42999);
  assert.equal(completed, false);
  await f.time.advance(1);
  assert.equal(completed, true);
  assert.equal((await result).suggestions[0].label, 'example');
  assert.deepEqual(f.budgets, [195000, 45000, 10000, 30000]);
  assert.equal(f.pending.pendingSize, 0);
  assert.equal(f.transport.getPendingRequests().size, 0);
  assert.equal(f.gate.snapshot().owner, null);
  assert.equal(f.time.pending, 0);
  await f.occupied;
});

test('fast completion is not delayed by a larger budget or a stale short caller override', async () => {
  const f = fixture({ replyMs: 25 });
  const result = provideWorkbenchCompletionItemsFromVscodeSuggest({ ...f.deps, callTimeoutMs: 10000 });
  await f.time.advance(25);
  assert.equal((await result).suggestions[0].label, 'example');
  assert.equal(f.time.pending, 0);
});

test('slow provider RPC does not hold the document gate or block another provider', async () => {
  const f = fixture({ providerHandles: [23, 24], replyMs: handle => handle === 23 ? 20000 : 25 });
  let slowDone = false;
  const slow = provideWorkbenchCompletionItemsFromVscodeSuggest({ ...f.deps, providerHandle: 23 })
    .then(result => { slowDone = true; return result; });
  await f.time.advance(1);
  assert.equal(f.gate.snapshot().owner, null);
  const fast = provideWorkbenchCompletionItemsFromVscodeSuggest({ ...f.deps, providerHandle: 24 });
  await f.time.advance(25);
  assert.equal((await fast).suggestions.length, 1);
  assert.equal(slowDone, false);
  assert.equal(f.gate.snapshot().owner, null);
  await f.time.advance(20000);
  assert.equal((await slow).suggestions.length, 1);
});

test('outer RPC covers both gate admissions and late provider registration', async () => {
  const f = fixture({ replyMs: 29000, preflightMs: 4000, providerWaitMs: 4000, queueMs: 49000, secondQueueMs: 14000 });
  const result = provideWorkbenchCompletionItemsFromVscodeSuggest(f.deps);
  await f.time.advance(135000);
  assert.equal((await result).suggestions[0].label, 'example');
  assert.equal(f.gate.snapshot().owner, null);
  assert.equal(f.time.pending, 0);
});

for (const pinned of [false, true]) test(`silent provider remains bounded (pinned=${pinned})`, async () => {
  const f = fixture({ pinned, neverReply: true });
  const result = provideWorkbenchCompletionItemsFromVscodeSuggest(f.deps);
  const checked = pinned
    ? assert.rejects(result, /timed out waiting for completions reply/)
    : result.then(value => assert.deepEqual(value.suggestions, []));
  await f.time.advance(30000);
  await checked;
  assert.equal(f.pending.pendingSize, 0);
  assert.equal(f.gate.snapshot().owner, null);
  assert.equal(f.time.pending, 0);
});

test('disconnect still rejects a pending browser request immediately', async () => {
  const f = fixture({ neverReply: true });
  const result = provideWorkbenchCompletionItemsFromVscodeSuggest(f.deps);
  const checked = assert.rejects(result, /disconnected/);
  await f.time.advance(1);
  f.handlers.get('disconnect')();
  await checked;
  assert.equal(f.transport.getPendingRequests().size, 0);
  await f.time.advance(30000);
  assert.equal(f.time.pending, 0);
});
