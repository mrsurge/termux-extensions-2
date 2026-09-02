import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { decode, encode } from '@msgpack/msgpack';
import { build } from 'esbuild';


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
