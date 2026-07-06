import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const BRIDGE_PATH = new URL('./console_bridge.js', import.meta.url);
let _moduleCache = null;

function createMockSocket() {
  const handlers = new Map();
  const emitted = [];
  return {
    connected: true,
    on(event, fn) { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(fn); },
    emit(event, data) { emitted.push({ event, data }); },
    off() {},
    _handlers: handlers,
    _emitted: emitted,
    _fire(event, data) { const fns = handlers.get(event) || []; for (const fn of fns) fn(data); },
    _lastResult() { return emitted.findLast(e => e.event === 'console:evalResult'); },
  };
}

function createMockWindow() {
  const listeners = new Map();
  return {
    io: undefined,
    sessionStorage: { _data: {}, getItem(k) { return this._data[k] ?? null; }, setItem(k, v) { this._data[k] = v; } },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    dispatchEvent() {},
    _listeners: listeners,
  };
}

async function loadBridge(mockWindow, mockSocket) {
  globalThis.window = mockWindow;
  globalThis.CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } };

  if (!_moduleCache) {
    _moduleCache = await import(BRIDGE_PATH.href);
  }
  _moduleCache.destroyConsoleBridge();
  const result = _moduleCache.initConsoleBridge({ socket: mockSocket, workerId: 'test-worker', workerLabel: 'test' });
  return { ..._moduleCache, ...result };
}

describe('console bridge eval', () => {
  let cleanup = null;

  afterEach(() => {
    if (cleanup) { cleanup(); cleanup = null; }
  });

  test('sync value returns ok', async () => {
    const mockSocket = createMockSocket();
    const mockWindow = createMockWindow();
    const bridge = await loadBridge(mockWindow, mockSocket);
    cleanup = bridge.destroy;

    mockSocket._fire('console:eval', { reqId: 'r1', code: '42', timeoutSeconds: 5 });
    await new Promise(r => setTimeout(r, 50));

    const result = mockSocket._lastResult();
    assert.ok(result, 'evalResult should have been emitted');
    assert.equal(result.data.ok, true);
    assert.equal(result.data.value, 42);
    assert.equal(result.data.reqId, 'r1');
  });

  test('resolving promise returns ok', async () => {
    const mockSocket = createMockSocket();
    const mockWindow = createMockWindow();
    const bridge = await loadBridge(mockWindow, mockSocket);
    cleanup = bridge.destroy;

    mockSocket._fire('console:eval', { reqId: 'r2', code: 'Promise.resolve(99)', timeoutSeconds: 5 });
    await new Promise(r => setTimeout(r, 50));

    const result = mockSocket._lastResult();
    assert.ok(result);
    assert.equal(result.data.ok, true);
    assert.equal(result.data.value, 99);
  });

  test('rejecting promise returns error', async () => {
    const mockSocket = createMockSocket();
    const mockWindow = createMockWindow();
    const bridge = await loadBridge(mockWindow, mockSocket);
    cleanup = bridge.destroy;

    mockSocket._fire('console:eval', { reqId: 'r3', code: 'Promise.reject(new Error("boom"))', timeoutSeconds: 5 });
    await new Promise(r => setTimeout(r, 50));

    const result = mockSocket._lastResult();
    assert.ok(result);
    assert.equal(result.data.ok, false);
    assert.ok(result.data.error);
  });

  test('never-resolving promise times out', async () => {
    const mockSocket = createMockSocket();
    const mockWindow = createMockWindow();
    const bridge = await loadBridge(mockWindow, mockSocket);
    cleanup = bridge.destroy;

    mockSocket._fire('console:eval', { reqId: 'r4', code: 'new Promise(() => {})', timeoutSeconds: 0.01 });
    await new Promise(r => setTimeout(r, 2200));

    const result = mockSocket._lastResult();
    assert.ok(result, 'evalResult should have been emitted after timeout');
    assert.equal(result.data.ok, false);
    assert.equal(result.data.errorType, 'eval_timeout');
  });

  test('cancel signal stops pending eval', async () => {
    const mockSocket = createMockSocket();
    const mockWindow = createMockWindow();
    const bridge = await loadBridge(mockWindow, mockSocket);
    cleanup = bridge.destroy;

    mockSocket._fire('console:eval', { reqId: 'r5', code: 'new Promise(() => {})', timeoutSeconds: 10 });
    await new Promise(r => setTimeout(r, 10));

    mockSocket._fire('console:evalCancel', { reqId: 'r5' });
    await new Promise(r => setTimeout(r, 50));

    const result = mockSocket._lastResult();
    assert.ok(result, 'evalResult should have been emitted after cancel');
    assert.equal(result.data.ok, false);
    assert.equal(result.data.errorType, 'eval_cancelled');
  });

  test('undefined serializes as null', async () => {
    const mockSocket = createMockSocket();
    const mockWindow = createMockWindow();
    const bridge = await loadBridge(mockWindow, mockSocket);
    cleanup = bridge.destroy;

    mockSocket._fire('console:eval', { reqId: 'r6', code: 'undefined', timeoutSeconds: 5 });
    await new Promise(r => setTimeout(r, 50));

    const result = mockSocket._lastResult();
    assert.ok(result);
    assert.equal(result.data.ok, true);
    assert.equal(result.data.value, null);
  });
});
