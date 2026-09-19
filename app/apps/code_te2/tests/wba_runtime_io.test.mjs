import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PipeOutputWriter, createStaticAssetLoader, runtimeIo } from '../workbench_protocol_proxy/node_workbench_adapter/dist/server/runtime-io.mjs';
import { PipeMessagePackDecoder, encodePipeMessage } from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/pipe-codec.mjs';
import { attachEditorWbaSocket } from '../workbench_protocol_proxy/node_workbench_adapter/dist/server/editor-socket.mjs';
import { encodeWbaRpcMessage, decodeWbaRpcMessage } from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/messagepack-codec.mjs';

test('runtime identity and bounded static asset loads preserve bytes and retry errors', async () => {
  assert.equal(runtimeIo.runtime, process.versions.bun ? 'bun' : 'node');
  assert.equal(runtimeIo.fileReader, process.versions.bun ? 'bun.file' : 'node:fs');
  const dir = await mkdtemp(join(tmpdir(), 'te2-wba-io-'));
  try {
    const file = join(dir, 'asset');
    const load = createStaticAssetLoader(pathToFileURL(file));
    await assert.rejects(load());
    await writeFile(file, Uint8Array.of(0, 255, 13, 10));
    const first = load();
    assert.equal(load(), first);
    assert.deepEqual([...await first], [0, 255, 13, 10]);
    assert.equal(await load(), await first);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('fragmented decoding does not mutate previously delivered binary data', () => {
  const d = new PipeMessagePackDecoder();
  const values = [];
  const input = Buffer.concat([
    encodePipeMessage({ data: new Uint8Array(200000).fill(17) }),
    encodePipeMessage({ data: new Uint8Array(300000).fill(99) }),
  ]);
  for (let i = 0; i < input.length; i += 4096) d.feed(input.subarray(i, i + 4096), v => values.push(v));
  d.finish();
  assert.equal(values.length, 2);
  assert.equal(values[0].data.length, 200000);
  assert.ok(values[0].data.every(v => v === 17));
  assert.ok(values[1].data.every(v => v === 99));
});

test('stdout obeys drain, preserves frame order, and flush waits for callbacks', async () => {
  const writes = [], callbacks = [], errors = [];
  const output = new Writable({ highWaterMark: 1, write(chunk, _encoding, done) {
    writes.push(Buffer.from(chunk)); callbacks.push(done);
  } });
  const writer = new PipeOutputWriter(output, e => errors.push(e));
  writer.write(Uint8Array.of(1));
  writer.write(Uint8Array.of(2));
  writer.write(Uint8Array.of(3));
  assert.equal(writes.length, 1);
  let flushed = false;
  const flush = writer.flush().then(() => { flushed = true; });
  await Promise.resolve();
  assert.equal(flushed, false);
  callbacks.shift()();
  assert.equal(writes.length, 2);
  callbacks.shift()();
  callbacks.shift()();
  await flush;
  assert.deepEqual(writes.map(b => [...b]), [[1], [2], [3]]);
  assert.equal(errors.length, 0);
});

test('backlog overflow fails explicitly including bytes owned by the stream', async () => {
  const failures = [];
  const output = new Writable({ highWaterMark: 1, write() {} });
  const writer = new PipeOutputWriter(output, e => failures.push(e), 4);
  writer.write(new Uint8Array(4));
  const pending = assert.rejects(writer.flush(), /backlog/);
  assert.throws(() => writer.write(Uint8Array.of(1)), /backlog/);
  await pending;
  assert.equal(failures.length, 1);
});

test('closed output rejects pending flush rather than reporting success', async () => {
  const output = new Writable({ highWaterMark: 1, write() {} });
  const writer = new PipeOutputWriter(output, () => {});
  writer.write(Uint8Array.of(1));
  const pending = assert.rejects(writer.flush(), /closed/);
  output.destroy();
  await pending;
});

// Exercise the unchanged real Engine.IO/Socket.IO protocol on each interpreter.
test('Socket.IO binary RPC and client-room notifications retain their contract', { timeout: 10000 }, async () => {
  const require = createRequire(import.meta.url);
  const { io } = require('../vendor/node_socketio/node_modules/socket.io/client-dist/socket.io.js');
  const server = createServer();
  const adapter = attachEditorWbaSocket(server, {
    handleJsonRpc: async (request, context) => ({ jsonrpc: '2.0', id: request.id, result: { value: request.params, client: context.clientInstanceId } }),
    nowMs: Date.now, log() {},
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const socket = io(`http://127.0.0.1:${server.address().port}/wba`, {
    path: '/wba_ws/socket.io', transports: ['websocket'], reconnection: false,
    query: { client_instance_id: 'client_abcdefghijkl' }, auth: { rpcCodec: 'msgpack-v1' },
  });
  try {
    await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([e]) => { throw e; })]);
    const reply = once(socket, 'rpc');
    socket.emit('rpc', encodeWbaRpcMessage({ jsonrpc: '2.0', id: 1, method: 'test', params: 'hello' }));
    assert.deepEqual(decodeWbaRpcMessage((await reply)[0]).result, { value: 'hello', client: 'client_abcdefghijkl' });
    const push = once(socket, 'rpc');
    adapter.broadcastNotification('test.push', { clientInstanceId: 'client_abcdefghijkl', value: 42 });
    assert.equal(decodeWbaRpcMessage((await push)[0]).params.value, 42);
  } finally { socket.disconnect(); adapter.close(); }
});

test('real adapter drains accepted pipe RPCs before exiting at EOF', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'te2-wba-pipe-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../workbench_protocol_proxy/node_workbench_adapter/dist/server/server.mjs', import.meta.url))], {
    env: { ...process.env, TE2_ADAPTER_HOST: '127.0.0.1', TE2_ADAPTER_PORT: '0', TE2_RUNTIME_DEBUG: '0',
      TE2_EXTENSION_STORAGE_PATH: join(dir, 'extensions'),
      TE2_WEBVIEW_RECONSTRUCTION_STORAGE_PATH: join(dir, 'webviews'), TE2_RPC_CONFIG_PATH: '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const records = [], decoder = new PipeMessagePackDecoder();
  let stderr = '';
  child.stdout.on('data', chunk => decoder.feed(chunk, value => records.push(value)));
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
  const exited = once(child, 'close');
  const deadline = setTimeout(() => child.kill(), 12000);
  try {
    for (let id = 1; id <= 100; id++) child.stdin.write(encodePipeMessage({ jsonrpc: '2.0', id, method: 'te2.ping' }));
    child.stdin.end();
    const [code] = await exited;
    assert.equal(code, 0, stderr);
    decoder.finish();
    const ids = records.filter(r => r.kind === 'reply').map(r => r.payload.id).sort((a, b) => a - b);
    assert.deepEqual(ids, Array.from({ length: 100 }, (_, i) => i + 1));
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null) { child.kill(); await exited; }
    await rm(dir, { recursive: true, force: true });
  }
});
