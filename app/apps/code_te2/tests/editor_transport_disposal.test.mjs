import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `
  export * from './monaco_editor/editor_rpc_transport.ts';
  export * from './monaco_editor/editor_wba_rpc_transport.ts';
  export * from './src/rpc/codec.ts';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function fixture(kind, connected = true, overrides = {}) {
  const emitter = new EventEmitter(), manager = new EventEmitter(), timers = new Set(), sent = [], traces = [], errors = [];
  let disconnects = 0;
  const socket = { connected, io: manager, on: emitter.on.bind(emitter), off: emitter.off.bind(emitter),
    emit(event, payload) { sent.push([event, payload]); },
    volatile: { emit(event, payload) { sent.push([event, payload]); } },
    disconnect() { disconnects++; } };
  const deps = { getSocket: () => socket,
    setTimeoutFn(callback, delay) { const timer = setTimeout(callback, delay); timers.add(timer); return timer; },
    clearTimeoutFn(timer) { clearTimeout(timer); timers.delete(timer); },
    onProtocolError: error => errors.push(error), onStartupTrace: phase => traces.push(phase), ...overrides };
  const transport = kind === 'editor' ? api.createEditorRpcTransport(deps) : api.createEditorWbaRpcTransport(deps);
  transport.attachSocket(socket);
  return { transport, deps, socket, emitter, manager, timers, sent, errors, traces, disconnects: () => disconnects };
}

for (const kind of ['editor', 'wba']) {
  test(`${kind} disposal during a notification stops remaining handlers and batch entries`, () => {
    const f = fixture(kind);
    const calls = [];
    f.transport.onNotification('test.notice', () => { calls.push('first'); f.transport.dispose(); });
    f.transport.onNotification('test.notice', () => calls.push('late'));
    f.emitter.emit('rpc', api.messagePackRpcWireCodec.encode([
      { jsonrpc: '2.0', method: 'test.notice', params: {} },
      { jsonrpc: '2.0', method: 'test.notice', params: {} },
    ]));
    assert.deepEqual(calls, ['first']);
  });

  test(`${kind} disposal rejects pending work and removes only owned listeners`, async () => {
    const f = fixture(kind);
    let external = 0, notifications = 0;
    const outsider = () => external++;
    f.emitter.on('rpc', outsider); f.manager.on('open', outsider);
    f.transport.onNotification('test.notice', () => notifications++);
    const oldCallbacks = f.emitter.listeners('rpc').filter(callback => callback !== outsider);
    const oldManagerCallbacks = f.manager.listeners('open').filter(callback => callback !== outsider);
    const request = f.transport.call('test.request', {});
    const rejected = assert.rejects(request, /disposed/);
    await Promise.resolve();
    assert.equal(f.transport.getPendingRequests().size, 1);
    f.transport.dispose(); f.transport.dispose();
    await rejected;
    assert.equal(f.transport.getPendingRequests().size, 0); assert.equal(f.timers.size, 0);
    assert.equal(f.transport.isConnected(), false);
    assert.deepEqual(f.emitter.listeners('rpc'), [outsider]);
    assert.deepEqual(f.manager.listeners('open'), [outsider]);
    assert.equal(f.disconnects(), 0);
    const bytes = api.messagePackRpcWireCodec.encode({ jsonrpc: '2.0', method: 'test.notice', params: {} });
    for (const callback of oldCallbacks) callback(bytes);
    const traceCount = f.traces.length;
    for (const callback of oldManagerCallbacks) callback();
    assert.equal(f.traces.length, traceCount); assert.equal(notifications, 0);
    f.emitter.emit('rpc', bytes); assert.equal(external, 1);
    assert.equal(f.transport.notify('test.notice', {}), false);
    await assert.rejects(f.transport.call('test.request', {}), /disposed/);
    const before = f.emitter.listenerCount('rpc');
    f.transport.attachSocket(f.socket); assert.equal(f.emitter.listenerCount('rpc'), before);
  });

  test(`${kind} disposal rejects startup waits and cannot reconnect`, async () => {
    const f = fixture(kind, false);
    const pending = kind === 'editor' ? f.transport.waitUntilConnected() : f.transport.call('test.request', {});
    const rejected = assert.rejects(pending, /disposed/);
    assert.equal(f.timers.size, 1);
    const oldConnect = f.emitter.listeners('connect');
    f.transport.dispose(); await rejected; assert.equal(f.timers.size, 0);
    f.socket.connected = true;
    for (const callback of oldConnect) callback();
    assert.equal(f.transport.isConnected(), false); assert.equal(f.sent.length, 0);
    if (kind === 'editor') await assert.rejects(f.transport.waitUntilConnected(), /disposed/);
  });

  test(`${kind} disposing one transport does not remove a surviving transport's handlers`, () => {
    const f = fixture(kind);
    const survivor = kind === 'editor' ? api.createEditorRpcTransport(f.deps) : api.createEditorWbaRpcTransport(f.deps);
    survivor.attachSocket(f.socket);
    let calls = 0;
    survivor.onNotification('test.notice', () => calls++);
    f.transport.dispose();
    f.emitter.emit('rpc', api.messagePackRpcWireCodec.encode({ jsonrpc: '2.0', method: 'test.notice', params: {} }));
    assert.equal(calls, 1); assert.equal(survivor.isConnected(), true);
    survivor.dispose(); assert.equal(f.emitter.listenerCount('rpc'), 0);
  });
}

test('editor disposal aborts in-flight decode and fences late decoded notifications', async () => {
  let finish, signal, notifications = 0;
  const f = fixture('editor', true, { codec: { id: 'msgpack-v1', encode: value => value,
    decode(_payload, abortSignal) { signal = abortSignal; return new Promise(resolve => { finish = resolve; }); } } });
  f.transport.onNotification('test.notice', () => notifications++);
  f.emitter.emit('rpc', new Uint8Array([1]));
  assert.equal(signal.aborted, false); f.transport.dispose(); assert.equal(signal.aborted, true);
  finish({ jsonrpc: '2.0', method: 'test.notice', params: {} });
  await Promise.resolve(); assert.equal(notifications, 0); assert.equal(f.errors.length, 0);
});

test('WBA disposal fences the resolved connection microtask before it emits a request', async () => {
  const f = fixture('wba');
  const pending = f.transport.call('test.request', {}), rejected = assert.rejects(pending, /disposed/);
  f.transport.dispose(); await rejected;
  assert.equal(f.sent.length, 0); assert.equal(f.timers.size, 0);
});
