import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const copies = [
  new URL('../main_page/frontend/console_bridge.js', import.meta.url),
  new URL('../../../static/js/te2_console_bridge.js', import.meta.url),
];

test('actual app-shell bootstrap projects only explicit server booleans before application import', async () => {
  const shell = await readFile(new URL('../../../templates/app_shell.html', import.meta.url), 'utf8');
  const start = shell.indexOf('            function applyBootstrap(payload)');
  const end = shell.indexOf('            return await new Promise(', start);
  assert.ok(start >= 0 && end > start);
  for (const [fields, expected] of [
    [{}, false], [{ debug_console: true }, true], [{ runtime_debug: true }, true],
    [{ debug_console: false, runtime_debug: true }, false],
    [{ debug_console: 'true', runtime_debug: 'true' }, false],
  ]) {
    const window = {};
    runInNewContext(`let bootstrapApp, debugFullStack, runtimeStartupDebug;
      const appId = 'sample', teStateStore = null;
      function startupMark() {}
      ${shell.slice(start, end)}
      applyBootstrap(payload);`, { window, payload: { app_bootstrap: { app_id: 'sample', ...fields } } });
    assert.equal(window.__te2BuiltinConsoleEnabled, expected);
  }
});

test('shared and host copies use the identical new policy without changing existing API differences', async () => {
  const policy = source => source.slice(source.indexOf('// Built-in callers opt into'),
    source.indexOf('export function initConsoleBridge(opts'));
  assert.equal(policy(await readFile(copies[0], 'utf8')), policy(await readFile(copies[1], 'utf8')));
});

async function fixture(path, enabled) {
  const output = await build({ entryPoints: [path.pathname], bundle: true,
    write: false, platform: 'browser', format: 'iife', globalName: 'bridge' });
  const handlers = new Map(), emitted = [], listeners = new Map();
  let sockets = 0, disconnects = 0, prepared = 0;
  const socket = {
    connected: true,
    on: (name, fn) => handlers.set(name, fn),
    off: name => handlers.delete(name),
    emit: (name, value) => emitted.push({ name, value }),
    disconnect: () => { disconnects++; },
  };
  const originals = Object.fromEntries(['log', 'info', 'debug', 'warn', 'error'].map(k => [k, () => {}]));
  const console = { ...originals };
  const window = {
    __te2BuiltinConsoleEnabled: enabled,
    location: { search: '' },
    io: () => { sockets++; return socket; },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
    dispatchEvent() {},
  };
  const context = { window, console, URLSearchParams, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } };
  runInNewContext(output.outputFiles[0].text, context);
  const api = context.bridge;
  return { api, window, console, originals, emitted, handlers, listeners,
    options: { workerId: 'test:client', prepare: async () => { prepared++; } },
    counts: () => ({ sockets, disconnects, prepared }) };
}

for (const path of copies) {
  test(`${path.pathname}: quiet by default; explicit activation is local and reversible`, async () => {
    const f = await fixture(path);
    assert.ok(await f.api.initBuiltinConsoleBridge(f.options));
    assert.deepEqual(f.counts(), { sockets: 1, disconnects: 0, prepared: 1 });
    assert.equal(f.console.log, f.originals.log);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.emitted.filter(e => e.name === 'console:register').length, 1);
    assert.ok(f.handlers.has('console:eval'));
    assert.equal(f.api.getConsoleBridgeStatus().forwarding, false);
    let serialized = 0;
    const value = { toJSON() { serialized++; return 'payload'; } };
    f.console.log(value);
    assert.equal(serialized, 0);
    await f.handlers.get('console:eval')({ reqId: 'enable', code: 'window.te2DebugConsole.enable().then(() => true)' });
    assert.equal(f.emitted.find(e => e.name === 'console:evalResult').value.ok, true);
    assert.equal(f.counts().sockets, 1);
    assert.equal(f.window.te2DebugConsole.status().active, true);
    f.console.log(value);
    assert.equal(serialized, 1);
    assert.equal(f.emitted.filter(e => e.name === 'console:register').length, 1);
    assert.equal(f.emitted.filter(e => e.name === 'console:log').length, 1);
    const workerId = f.api.getConsoleBridgeStatus().workerId;
    f.handlers.get('disconnect')('transport close');
    f.handlers.get('connect')();
    assert.equal(f.api.getConsoleBridgeStatus().workerId, workerId);
    f.window.te2DebugConsole.disable();
    assert.equal(f.window.te2DebugConsole.status().active, true);
    assert.equal(f.window.te2DebugConsole.status().forwarding, false);
    assert.ok(f.handlers.has('console:eval'));
    assert.equal(f.listeners.size, 0);
    assert.ok(await f.api.initBuiltinConsoleBridge(f.options));
    assert.equal(f.api.getConsoleBridgeStatus().forwarding, false, 'setup cannot undo explicit disable');
    await f.handlers.get('console:eval')({ reqId: 'quiet-eval', code: '2 + 2' });
    assert.equal(f.emitted.find(e => e.value.reqId === 'quiet-eval').value.value, 4);
    f.console.log(value);
    assert.equal(serialized, 1);
    await f.window.te2DebugConsole.enable();
    assert.equal(f.counts().sockets, 1);
    f.window.te2DebugConsole.disable();
    const fresh = await fixture(path);
    assert.ok(await fresh.api.initBuiltinConsoleBridge(fresh.options));
    assert.equal(fresh.api.getConsoleBridgeStatus().forwarding, false, 'new page does not inherit override');
    f.api.destroyConsoleBridge();
    fresh.api.destroyConsoleBridge();
  });

  test(`${path.pathname}: boolean policy enables; generic callers remain ungated`, async () => {
    const f = await fixture(path, true);
    assert.ok(await f.api.initBuiltinConsoleBridge(f.options));
    f.window.te2DebugConsole.disable();
    const malformed = await fixture(path, 'true');
    assert.ok(await malformed.api.initBuiltinConsoleBridge(malformed.options));
    assert.equal(malformed.api.getConsoleBridgeStatus().forwarding, false);
    malformed.api.destroyConsoleBridge();
    assert.ok(malformed.api.initConsoleBridge({ workerId: 'user-app' }));
    assert.equal(malformed.api.getConsoleBridgeStatus().forwarding, true);
    malformed.api.destroyConsoleBridge();
    f.api.destroyConsoleBridge();
  });

  test(`${path.pathname}: disable during loading preserves quiet registration`, async () => {
    const f = await fixture(path, true);
    let finish;
    const pending = f.api.initBuiltinConsoleBridge({ ...f.options,
      prepare: () => new Promise(resolve => { finish = resolve; }) });
    await Promise.resolve();
    f.window.te2DebugConsole.disable();
    finish();
    assert.ok(await pending);
    assert.equal(f.counts().sockets, 1);
    assert.equal(f.api.getConsoleBridgeStatus().forwarding, false);
    await f.api.initBuiltinConsoleBridge(f.options);
    await f.window.te2DebugConsole.enable();
    assert.equal(f.counts().sockets, 1);
    f.window.te2DebugConsole.disable();
    f.api.destroyConsoleBridge();
  });

  test(`${path.pathname}: activation is single-flight and loader failure stays retryable`, async () => {
    const f = await fixture(path);
    let attempts = 0;
    await assert.rejects(f.api.initBuiltinConsoleBridge({ ...f.options, prepare: async () => {
      attempts++;
      if (attempts === 1) throw new Error('dependency unavailable');
    } }), /dependency unavailable/);
    assert.equal(f.api.getConsoleBridgeStatus().active, false);
    assert.equal(f.counts().sockets, 0);
    const first = f.window.te2DebugConsole.enable();
    const second = f.window.te2DebugConsole.enable();
    assert.equal(first, second);
    await first;
    assert.equal(attempts, 2);
    assert.equal(f.counts().sockets, 1);
    f.window.te2DebugConsole.disable();
    f.api.destroyConsoleBridge();
  });
}
