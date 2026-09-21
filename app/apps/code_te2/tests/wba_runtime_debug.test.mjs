import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import { WbaRuntimeDebug, CompletionTrace, completionTrace, projectDebugResult } from '../workbench_protocol_proxy/node_workbench_adapter/dist/server/runtime-debug.mjs';
import { PipeMessagePackDecoder, encodePipeMessage } from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/pipe-codec.mjs';
import { encodeWbaRpcMessage, decodeWbaRpcMessage } from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/messagepack-codec.mjs';
import { provideCompletions } from '../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/intelligence/completions.mjs';

test('both build entrypoints publish the evaluator module', async () => {
  for (const relative of ['../build.mjs', '../workbench_protocol_proxy/node_workbench_adapter/build.mjs']) {
    assert.ok((await readFile(new URL(relative, import.meta.url), 'utf8')).includes('src/server/runtime-debug.ts'));
  }
});

test('live JS expressions, await, mutation and temporary probes work', async () => {
  const debug = new WbaRuntimeDebug(true);
  const wb = { value: 2, get() { return this.value; } };
  const run = code => debug.dispatch('runtime.debug.eval', { instanceId: debug.instanceId, code }, wb, {});
  assert.equal((await run('wb.get()')).value, 2);
  assert.equal((await run('await Promise.resolve(7)')).value, 7);
  assert.equal((await run('wb.value = 9; result = wb.get();')).value, 9);
  await run('probe.original = wb.get; wb.get = function() { return probe.original.call(this) + 1; }; result = wb.get();');
  assert.equal(wb.get(), 10);
  await run('wb.get = probe.original; delete probe.original; result = wb.get();');
  assert.equal(wb.get(), 9);
  assert.equal((await run('(await import("node:path")).basename("/a/b")')).value, 'b');
  await assert.rejects(run('throw new Error("probe failure");'), /probe failure/);
  assert.equal((await run('1')).value, 1);
});

test('debug gate, exact process target, invalid code and busy admission', async () => {
  await assert.rejects(new WbaRuntimeDebug(false).dispatch('runtime.debug.status', {}, {}, {}), /disabled/);
  const debug = new WbaRuntimeDebug(true);
  const params = { instanceId: debug.instanceId, code: '1' };
  await assert.rejects(debug.dispatch('runtime.debug.eval', { ...params, instanceId: 'old' }, {}, {}), /staleInstance/);
  for (const code of ['', 'x'.repeat(32769), 'é'.repeat(20000)]) {
    await assert.rejects(debug.dispatch('runtime.debug.eval', { ...params, code }, {}, {}), /invalidCode/);
  }
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const first = debug.dispatch('runtime.debug.eval', { ...params, code: 'await wb.pending' }, { pending }, {});
  await assert.rejects(debug.dispatch('runtime.debug.eval', params, {}, {}), /busy/);
  assert.equal((await debug.dispatch('runtime.debug.status', {}, {}, {})).busy, true);
  finish(42);
  assert.equal((await first).value, 42);
  assert.equal((await debug.dispatch('runtime.debug.status', {}, {}, {})).busy, false);
});

test('result projection bounds data without invoking accessors', () => {
  const value = { get danger() { throw new Error('getter invoked'); } };
  value.self = value;
  const projected = projectDebugResult(value);
  assert.equal(projected.truncated, true);
  assert.equal(projected.value.danger, '<accessor>');
  assert.equal(projected.value.self, '<cycle/shared>');
  assert.ok(JSON.stringify(projectDebugResult(Array(5000).fill('x'.repeat(5000)))).length <= 65536);
});

test('trace is gated, bounded and drops object payloads', () => {
  const trace = new CompletionTrace(false);
  trace.record('disabled');
  assert.equal(trace.snapshot().events.length, 0);
  trace.enabled = true;
  for (let i = 0; i < 300; i++) trace.record('test', { i, text: { secret: 'never retain' } });
  assert.equal(trace.snapshot().events.length, 256);
  assert.equal(trace.snapshot().events[0].i, 44);
  assert.equal('text' in trace.snapshot().events[0], false);
  trace.clear();
  assert.equal(trace.snapshot().events.length, 0);
});

test('completion trace separates sync, provider wait and extension request', async () => {
  const previous = completionTrace.enabled;
  completionTrace.enabled = true;
  completionTrace.clear();
  let available = false;
  const runtime = {
    ensureConnected() {}, languageFeaturesRpcId: 1,
    defaultAuthority: () => 'test', documentScheme: () => 'file', languageIdFromPath: () => 'python',
    didChange: async () => ({}), findAllProviderHandles: () => available ? [23] : [],
    waitFor: async condition => { available = true; return condition(); }, uriForPath: path => path,
    sendExtPending: () => ({ promise: Promise.resolve({ type: 9, result: { b: [] } }) }),
    log() {}, warn() {},
  };
  try {
    const result = await provideCompletions(runtime, { path: '/probe.py', languageId: 'python', text: 'private document', debugRequestId: 17 });
    assert.equal(result.ok, true);
    const events = completionTrace.snapshot().events;
    assert.deepEqual(events.map(e => e.phase), ['completion.begin', 'completion.sync.begin', 'completion.sync.end', 'completion.providerWait.begin', 'completion.providerWait.end', 'completion.rpc.sent', 'completion.rpc.reply', 'completion.end']);
    assert.equal(events[0].frontendRequest, 17);
    assert.equal(JSON.stringify(events).includes('private document'), false);
  } finally { completionTrace.clear(); completionTrace.enabled = previous; }
});

test('browser trace appears only when enabled and retains bounded metadata', async () => {
  const source = await readFile(new URL('../monaco_editor/editor_completion_trace.ts', import.meta.url), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const previous = globalThis.window;
  globalThis.window = {};
  try {
    assert.equal(mod.traceCompletion('disabled'), 0);
    mod.configureCompletionTrace(true);
    for (let i = 0; i < 200; i++) mod.traceCompletion('event', { i });
    assert.equal(window.__te2CompletionTrace.snapshot().events.length, 128);
    mod.configureCompletionTrace(false);
    assert.equal(window.__te2CompletionTrace, undefined);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

for (const enabled of [false, true]) test(`real adapter pipe eval and HTTP rejection (debug=${enabled})`, { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'te2-wba-debug-'));
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../workbench_protocol_proxy/node_workbench_adapter/dist/server/server.mjs', import.meta.url))], {
    env: { ...process.env, TE2_ADAPTER_HOST: '127.0.0.1', TE2_ADAPTER_PORT: String(port), TE2_RUNTIME_DEBUG: enabled ? '1' : '0', TE2_EXTENSION_STORAGE_PATH: join(dir, 'extensions'), TE2_WEBVIEW_RECONSTRUCTION_STORAGE_PATH: join(dir, 'webviews') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const decoder = new PipeMessagePackDecoder();
  const waiters = new Map();
  let sequence = 0;
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
  child.stdout.on('data', chunk => decoder.feed(chunk, frame => {
    if (frame.kind === 'reply') { waiters.get(frame.payload.id)?.(frame.payload); waiters.delete(frame.payload.id); }
  }));
  const rpc = (method, params = {}) => new Promise(resolve => {
    const id = ++sequence;
    waiters.set(id, resolve);
    child.stdin.write(encodePipeMessage({ jsonrpc: '2.0', id, method, params }));
  });
  const exited = once(child, 'close');
  child.on('close', () => { for (const resolve of waiters.values()) resolve({ error: { message: 'test child exited' } }); });
  const deadline = setTimeout(() => child.kill(), 12000);
  try {
    const status = await rpc('runtime.debug.status');
    if (!enabled) { assert.match(status.error.message, /disabled/); return; }
    const identity = status.result.instanceId;
    assert.ok(identity);
    const answer = await rpc('runtime.debug.eval', { instanceId: identity, code: '({ pid: process.pid, connected: wb.status().extConnected, answer: await Promise.resolve(42) })' });
    assert.equal(answer.result.value.answer, 42);
    const response = await fetch(`http://127.0.0.1:${port}/cmd`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 77, method: 'runtime.debug.eval', params: { instanceId: identity, code: 'probe.httpRan = true' } }) });
    assert.match((await response.json()).error.message, /pipeOnly/);
    assert.equal((await rpc('runtime.debug.eval', { instanceId: identity, code: 'probe.httpRan === undefined' })).result.value, true);
    const require = createRequire(import.meta.url);
    const { io } = require('../vendor/node_socketio/node_modules/socket.io/client-dist/socket.io.js');
    const socket = io(`http://127.0.0.1:${port}/wba`, {
      path: '/wba_ws/socket.io', transports: ['websocket'], reconnection: false,
      query: { client_instance_id: 'client_abcdefghijkl' }, auth: { rpcCodec: 'msgpack-v1' },
    });
    try {
      await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([e]) => { throw e; })]);
      const reply = once(socket, 'rpc');
      socket.emit('rpc', encodeWbaRpcMessage({ jsonrpc: '2.0', id: 99, method: 'runtime.debug.eval', params: { instanceId: identity, code: 'probe.socketRan = true' } }));
      assert.match(decodeWbaRpcMessage((await reply)[0]).error.message, /pipeOnly/);
    } finally { socket.disconnect(); }
    assert.equal((await rpc('runtime.debug.eval', { instanceId: identity, code: 'probe.socketRan === undefined' })).result.value, true);
    assert.match((await rpc('runtime.debug.eval', { instanceId: 'old', code: '1' })).error.message, /staleInstance/);
  } finally {
    child.stdin.end();
    const [code] = await exited;
    clearTimeout(deadline);
    await rm(dir, { recursive: true, force: true });
    assert.equal(code, 0, stderr);
  }
});
