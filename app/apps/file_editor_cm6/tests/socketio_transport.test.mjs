import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');
let moduleSequence = 0;

async function importTypeScript(relativePath) {
  const result = await build({
    entryPoints: [path.join(appRoot, relativePath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleSequence++}`;
  return import(url);
}

class FakeSocket {
  connected = false;
  connectCalls = 0;
  rawEmits = [];
  volatileEmits = [];
  handlers = new Map();
  ackResponse = null;

  volatile = {
    emit: (event, payload, ack) => {
      this.volatileEmits.push({ event, payload });
      if (ack && this.ackResponse) ack(this.ackResponse);
    },
  };

  emit(event, payload, ack) {
    this.rawEmits.push({ event, payload });
    if (ack && this.ackResponse) ack(this.ackResponse);
  }

  on(event, handler) {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  connect() {
    this.connectCalls += 1;
  }

  disconnect() {
    this.trigger('disconnect', 'client disconnect');
  }

  trigger(event, payload) {
    if (event === 'connect') this.connected = true;
    if (event === 'disconnect') this.connected = false;
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

async function settlePromises() {
  await Promise.resolve();
  await Promise.resolve();
}

test('all app-worker namespaces use one canonical path while WBA stays direct', async () => {
  const topology = await importTypeScript('src/rpc/socketio-topology.ts');
  const appPath = '/api/app/file_editor_cm6/socket.io';

  assert.equal(topology.SOCKET_IO_PATHS.editor, appPath);
  assert.equal(topology.SOCKET_IO_PATHS.explorer, appPath);
  assert.equal(topology.SOCKET_IO_PATHS.terminal, appPath);
  assert.equal(topology.SOCKET_IO_PATHS.uiIpc, appPath);
  assert.equal(
    topology.SOCKET_IO_PATHS.wba,
    '/api/app/file_editor_cm6/services/wba/socket.io',
  );
  assert.equal(topology.SOCKET_IO_PATHS.te2Console, '/te2_console_ws/socket.io');
});

test('shared RPC transport uses volatile emits and never replays reconnect-era work', async () => {
  const { createSocketIoJsonRpcClient } = await importTypeScript('src/rpc/transport.ts');
  const socket = new FakeSocket();
  socket.ackResponse = { jsonrpc: '2.0', id: 'ignored-by-client', result: { ok: true } };
  const client = createSocketIoJsonRpcClient({
    namespace: '/rpc/test',
    path: '/api/app/file_editor_cm6/socket.io',
    ensureSocketIoLoaded: async () => () => socket,
  });

  const initialRequest = client.request('initial.get', {});
  await settlePromises();
  assert.equal(socket.volatileEmits.length, 0);
  socket.trigger('connect');
  assert.deepEqual(await initialRequest, { ok: true });
  assert.equal(socket.rawEmits.length, 0);
  assert.equal(socket.volatileEmits.length, 1);

  socket.ackResponse = null;
  const inFlight = client.request('active.get', {}, 5000);
  assert.equal(socket.volatileEmits.length, 2);
  socket.trigger('disconnect', 'transport close');
  await assert.rejects(inFlight, /RPC socket disconnected/);

  client.notify('state.changed', {});
  await assert.rejects(client.request('reconnect.get', {}), /RPC socket disconnected/);
  assert.equal(socket.volatileEmits.length, 2);
  assert.equal(socket.connectCalls, 2);

  socket.trigger('connect');
  assert.equal(socket.volatileEmits.length, 2);
  assert.equal(socket.rawEmits.length, 0);
});

test('WBA waits only for its first connection and never queues reconnect calls', async () => {
  const { createEditorWbaRpcTransport } = await importTypeScript(
    'monaco_editor/editor_wba_rpc_transport.ts',
  );
  const socket = new FakeSocket();
  const transport = createEditorWbaRpcTransport({
    getSocket: () => socket,
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
  });
  transport.attachSocket(socket);

  const initialCall = transport.call('vscode.openFile', {}, { timeoutMs: 5000 });
  await settlePromises();
  assert.equal(socket.volatileEmits.length, 0);
  socket.trigger('connect');
  await settlePromises();
  assert.equal(socket.volatileEmits.length, 1);

  socket.trigger('disconnect', 'transport close');
  await assert.rejects(initialCall, /wba rpc socket disconnected/);
  await assert.rejects(
    transport.call('vscode.hover', {}, { timeoutMs: 5000 }),
    /wba rpc socket disconnected/,
  );
  assert.equal(socket.volatileEmits.length, 1);

  socket.trigger('connect');
  assert.equal(socket.volatileEmits.length, 1);
  assert.equal(socket.rawEmits.length, 0);
});
