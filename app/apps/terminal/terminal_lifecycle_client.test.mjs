import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { decode, encode } from '@msgpack/msgpack';
import { build, transformSync } from 'esbuild';

function inputHarness() {
  const source = fs.readFileSync('src/main.ts', 'utf8');
  const start = source.indexOf('  function sendMessage(');
  const end = source.indexOf('  function clearSocket()', start);
  assert.ok(start >= 0 && end > start);
  const frames = [];
  const state = { encoder: new TextEncoder(), ws: { readyState: 1, send: data => frames.push(decode(data)) } };
  const context = vm.createContext({ state, WebSocket: { OPEN: 1 }, encodeMessagePack: encode });
  vm.runInContext(transformSync(source.slice(start, end) + '\nglobalThis.input = queueInput;', { loader: 'ts' }).code, context);
  return { state, frames, input: context.input };
}

function presentationHarness(query = {}, shells = []) {
  const source = fs.readFileSync('src/main.ts', 'utf8');
  const section = (startText, endText) => {
    const start = source.indexOf(startText), end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
  };
  const modes = [], selected = [], resets = [], requests = [], statuses = [];
  const ui = { title: { textContent: 'No shell selected' } };
  const context = vm.createContext({
    sidebarState: { initialShellId: '', initialNewSession: '', initialCwd: '', ...query },
    initialSidebarStateApplied: false, state: { shellsReady: false, shells }, ui,
    setMode: mode => modes.push(mode), setStatus: status => statuses.push(status),
    selectShell: async id => selected.push(id), resetSidebarShellState: id => resets.push(id),
    isShellAlive: rec => rec.status === 'running', applyShellSnapshot() {},
    requireLifecycleClient: () => ({ request: async (method, params) => {
      requests.push({ method, params });
      if (query.failCreate) throw new Error('launch failed');
      return { shell_id: 'created', snapshot: {} };
    } }),
    window: { location: { href: 'http://localhost/app/terminal?new_session=seed' }, history: { replaceState() {} } },
    URL, console: { error() {} },
  });
  const functions = section('  function initializePresentation()', '  function openDrawer()')
    + section('  async function applyInitialSidebarShellState()', '  async function listShells(');
  vm.runInContext(transformSync(functions + '\nglobalThis.presentation = { initializePresentation, applyInitialSidebarShellState };', { loader: 'ts' }).code, context);
  return { context, modes, selected, resets, requests, statuses, ui, ...context.presentation };
}

test('restoration has no drawer transition until a deliberate menu interaction', () => {
  const source = fs.readFileSync('src/main.ts', 'utf8');
  const start = source.indexOf('  function setMode(');
  const end = source.indexOf('  function refocusTerm()', start);
  const classes = new Set();
  const root = { classList: {
    add: (...names) => names.forEach(name => classes.add(name)),
    remove: (...names) => names.forEach(name => classes.delete(name)),
  } };
  const context = vm.createContext({ root, state: {},
    sidebarState: { initialShellId: 'existing' }, ui: { title: {} } });
  vm.runInContext(transformSync(source.slice(start, end)
    + '\nglobalThis.drawer = { initializePresentation, setMode, openDrawer, closeDrawer };', { loader: 'ts' }).code, context);
  const { drawer } = context;
  drawer.initializePresentation();
  assert.deepEqual([...classes], ['mode-terminal']);
  drawer.openDrawer();
  assert.equal(classes.has('drawer-motion-enabled'), true);
  assert.equal(classes.has('drawer-open'), true);
  drawer.closeDrawer();
  assert.equal(classes.has('drawer-open'), false);
  assert.equal(classes.has('drawer-motion-enabled'), true, 'manual closing still animates');
  drawer.setMode('list'); drawer.setMode('terminal');
  assert.equal(classes.has('drawer-motion-enabled'), false, 'mode/session handoff is not a gesture');
  const template = fs.readFileSync('template.html', 'utf8');
  const baseRule = template.match(/\.mode-terminal #ta-list-container\s*\{([^}]+)\}/)[1];
  assert.match(baseRule, /transition:\s*none;/);
  assert.match(template, /\.mode-terminal\.drawer-motion-enabled #ta-list-container\s*\{\s*transition: transform 160ms ease;/);
});

test('query state chooses terminal layout before lifecycle readiness without opening a shell', async () => {
  for (const query of [{ initialShellId: 'existing' }, { initialNewSession: 'seed' }]) {
    const f = presentationHarness(query);
    f.initializePresentation();
    assert.deepEqual(f.modes, ['terminal']);
    assert.equal(f.ui.title.textContent, 'Loading terminal…');
    await f.applyInitialSidebarShellState();
    assert.deepEqual(f.requests, []); assert.deepEqual(f.selected, []);
  }
  const f = presentationHarness(); f.initializePresentation();
  assert.deepEqual(f.modes, ['list']);
  assert.equal(f.ui.title.textContent, 'No shell selected');
});

test('restoration validates the shell snapshot; missing or exited identities return to list', async () => {
  for (const status of ['running', 'exited', 'missing']) {
    const f = presentationHarness({ initialShellId: 'existing' }, status === 'missing' ? [] : [{ id: 'existing', status }]);
    f.initializePresentation(); f.context.state.shellsReady = true;
    await f.applyInitialSidebarShellState(); await f.applyInitialSidebarShellState();
    assert.deepEqual(f.requests, []);
    if (status === 'running') {
      assert.deepEqual(f.selected, ['existing']); assert.deepEqual(f.modes, ['terminal']);
    } else {
      assert.deepEqual(f.selected, []); assert.deepEqual(f.modes, ['terminal', 'list']);
      assert.deepEqual(f.resets, ['existing']);
    }
  }
});

test('explicit fresh launch submits once after readiness and failure leaves a usable list', async () => {
  for (const failCreate of [false, true]) {
    const f = presentationHarness({ initialNewSession: 'seed', initialCwd: '/project', failCreate });
    f.initializePresentation(); f.context.state.shellsReady = true;
    await f.applyInitialSidebarShellState(); await f.applyInitialSidebarShellState();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].method, 'shell.create');
    assert.equal(f.requests[0].params.launch_id, 'seed');
    assert.equal(f.requests[0].params.cwd, '/project');
    assert.deepEqual(f.selected, failCreate ? [] : ['created']);
    assert.deepEqual(f.modes, failCreate ? ['terminal', 'list'] : ['terminal']);
    if (failCreate) assert.match(f.statuses[0], /Session launch failed/);
  }
});

test('terminal input sends synchronously in event order, including held arrows and UTF-8 paste', () => {
  const { input, frames } = inputHarness();
  const chunks = ['a', 'b', ...Array(20).fill('\u001b[A'), '\u0003', '\r', 'hello 🌍\n'.repeat(2048)];
  for (const [index, chunk] of chunks.entries()) {
    input(chunk);
    assert.equal(frames.length, index + 1, 'no timer or ACK may delay input');
    assert.equal(frames[index].type, 'input');
    assert.equal(new TextDecoder().decode(frames[index].data), chunk);
  }
  input('');
  assert.equal(frames.length, chunks.length);
});

test('terminal disconnected input is dropped and never replays into a replacement socket', () => {
  const { input, frames, state } = inputHarness();
  const socket = state.ws;
  for (const readyState of [0, 2, 3]) {
    socket.readyState = readyState;
    input('discard');
  }
  state.ws = null;
  input('also discard');
  state.ws = { readyState: 1, send: socket.send };
  input('fresh');
  assert.equal(frames.length, 1);
  assert.equal(new TextDecoder().decode(frames[0].data), 'fresh');
});


let clientModulePromise;

function loadClientModule() {
  if (!clientModulePromise) {
    clientModulePromise = build({
      entryPoints: ['src/terminal-lifecycle-client.ts'],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      write: false,
    }).then((result) => {
      const source = result.outputFiles[0].text;
      return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    });
  }
  return clientModulePromise;
}

class FakeSocket {
  connected = false;
  connectCalls = 0;
  sendBuffer = [];
  handlers = new Map();
  requests = [];

  connect() {
    this.connectCalls += 1;
  }

  disconnect() {
    this.trigger('disconnect', 'client disconnect');
  }

  on(event, handler) {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  off(event, handler) {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((item) => item !== handler));
  }

  emit(event, payload, ack) {
    this.requests.push({ event, request: decode(payload), ack });
  }

  trigger(event, payload) {
    if (event === 'connect') this.connected = true;
    if (event === 'disconnect') this.connected = false;
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

function installWindowTimers() {
  const prior = globalThis.window;
  globalThis.window = globalThis;
  return () => { globalThis.window = prior; };
}

test('Terminal frontend has no application-control HTTP calls', () => {
  const source = fs.readFileSync('src/main.ts', 'utf8');
  assert.doesNotMatch(source, /\bapi\.(?:get|post|put|delete)\s*\(/);
  assert.match(source, /path:\s*TERMINAL_LIFECYCLE_PATH/);
  assert.match(source, /transports:\s*\['websocket'\]/);
});

test('accepts binary revisioned snapshots and never connects before handlers exist', async () => {
  const restore = installWindowTimers();
  try {
    const { TerminalLifecycleClient } = await loadClientModule();
    const socket = new FakeSocket();
    const snapshots = [];
    const client = new TerminalLifecycleClient(socket, value => snapshots.push(value), () => {}, error => { throw error; });
    client.start();
    assert.equal(socket.connectCalls, 1);

    socket.trigger('terminal_snapshot', encode({
      type: 'shells.snapshot',
      generation: 'generation-a',
      revision: 4,
      ready: true,
      shells: [{ id: 'shell-a', status: 'running' }],
    }));
    assert.deepEqual(snapshots, [{
      type: 'shells.snapshot',
      generation: 'generation-a',
      revision: 4,
      ready: true,
      shells: [{ id: 'shell-a', status: 'running' }],
    }]);
    client.dispose();
  } finally {
    restore();
  }
});

test('sends strict MessagePack requests and resolves matching binary acknowledgements', async () => {
  const restore = installWindowTimers();
  try {
    const module = await loadClientModule();
    const socket = new FakeSocket();
    const client = new module.TerminalLifecycleClient(
      socket,
      () => {},
      () => {},
      error => { throw error; },
    );
    client.start();
    socket.trigger('connect');

    const resultPromise = client.request('shell.create', { cwd: '/workspace' });
    assert.equal(socket.requests.length, 1);
    assert.equal(socket.requests[0].event, module.TERMINAL_LIFECYCLE_REQUEST_EVENT);
    assert.equal(socket.requests[0].request.method, 'shell.create');
    assert.deepEqual(socket.requests[0].request.params, { cwd: '/workspace' });
    socket.requests[0].ack(encode({
      id: socket.requests[0].request.id,
      ok: true,
      result: { shell_id: 'shell-a' },
    }));
    assert.deepEqual(await resultPromise, { shell_id: 'shell-a' });
    client.dispose();
  } finally {
    restore();
  }
});

test('disconnect rejects in-flight requests and clears Socket.IO replay state', async () => {
  const restore = installWindowTimers();
  try {
    const { TerminalLifecycleClient } = await loadClientModule();
    const socket = new FakeSocket();
    const connections = [];
    const client = new TerminalLifecycleClient(
      socket,
      () => {},
      connected => connections.push(connected),
      () => {},
    );
    client.start();
    socket.trigger('connect');
    socket.sendBuffer.push({ stale: true });
    const request = client.request('shells.get');
    socket.trigger('disconnect', 'transport close');

    await assert.rejects(request, /disconnected: transport close/);
    assert.deepEqual(socket.sendBuffer, []);
    assert.deepEqual(connections, [true, false]);
  } finally {
    restore();
  }
});
