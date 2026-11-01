import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtemp, cp, mkdir, symlink, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PipeMessagePackDecoder } from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/pipe-codec.mjs';
import { encodeWbaRpcMessage, decodeWbaRpcMessage } from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/messagepack-codec.mjs';

const app = fileURLToPath(new URL('../', import.meta.url));
const { io } = createRequire(import.meta.url)('../vendor/node_socketio/node_modules/socket.io/client-dist/socket.io.js');
const scratch = process.env.TMPDIR || resolve(app, '../../../.codex-scratch');

for (const mode of ['auto', 'disabled', 'missing', 'broken']) {
  test(`WBA ${mode} engine: binary RPC, HTTP, identity and clean EOF`, { timeout: 20000 }, async () => {
    await mkdir(scratch, { recursive: true });
    const root = await mkdtemp(join(scratch, 'wba-engine-'));
    const reserved = createServer();
    reserved.listen(0, '127.0.0.1');
    await once(reserved, 'listening');
    const port = reserved.address().port;
    await new Promise(resolve => reserved.close(resolve));
    let entry = resolve(app, 'workbench_protocol_proxy/node_workbench_adapter/dist/server/server.mjs');
    if (mode === 'missing' || mode === 'broken') {
      const target = join(root, 'app/workbench_protocol_proxy/node_workbench_adapter/dist');
      await cp(resolve(app, 'workbench_protocol_proxy/node_workbench_adapter/dist'), target, {
        recursive: true, filter: file => mode !== 'missing' || !file.endsWith('/bun-engine.mjs'),
      });
      await symlink(resolve(app, 'vendor'), join(root, 'app/vendor'));
      await symlink(resolve(app, 'monaco_editor'), join(root, 'app/monaco_editor'));
      await symlink(resolve(app, 'workbench_protocol_proxy/node_workbench_adapter/vscode_oss_runtime'), join(target, '../vscode_oss_runtime'));
      entry = join(target, 'server/server.mjs');
      if (mode === 'broken') await writeFile(join(target, 'server/bun-engine.mjs'),
        `throw Object.assign(new Error("Cannot find package 'broken-dependency' imported from bun-engine.mjs"), {code:'ERR_MODULE_NOT_FOUND'});\n`);
    }
    const child = spawn(process.execPath, [entry], {
      cwd: root,
      env: { ...process.env, TE2_WBA_BUN_ENGINE: mode === 'disabled' ? '0' : '1',
        TE2_ADAPTER_HOST: '127.0.0.1', TE2_ADAPTER_PORT: String(port),
        TE2_CODE_SERVER_HTTP: 'http://127.0.0.1:1',
        TE2_EXTENSION_STORAGE_PATH: join(root, 'extensions'),
        TE2_WEBVIEW_RECONSTRUCTION_STORAGE_PATH: join(root, 'webviews') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let errors = '';
    child.stderr.on('data', data => { errors += data; });
    const decoder = new PipeMessagePackDecoder();
    const startup = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`startup timeout: ${errors}`)), 8000);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`startup exit ${code}: ${errors}`)); });
      child.stdout.on('data', chunk => {
        try {
          decoder.feed(chunk, value => { if (value.kind === 'startup') { clearTimeout(timer); resolve(value.payload); } });
        } catch (error) { clearTimeout(timer); reject(error); }
      });
    });
    let client;
    let phase = 'startup';
    const watchdog = setTimeout(() => { errors += `\nwatchdog phase=${phase}`; child.kill(); }, 12000);
    try {
      if (mode === 'broken' && process.versions.bun) {
        await assert.rejects(startup, /broken-dependency/);
        return;
      }
      const beacon = await startup;
      phase = 'http';
      assert.equal(beacon.socketEngine, process.versions.bun && mode === 'auto' ? '@socket.io/bun-engine' : 'engine.io');
      const base = `http://127.0.0.1:${port}`;
      const health = await fetch(`${base}/health`);
      assert.equal(health.status, 200);
      const healthState = await health.json();
      assert.equal(healthState.ok, true);
      assert.equal(healthState.socketEngine, beacon.socketEngine);
      const cmd = await fetch(`${base}/cmd`, { method: 'POST', body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'te2.ping' }) });
      assert.equal((await cmd.json()).result.ok, true);
      const forbidden = await fetch(`${base}/cmd`, { method:'POST', body:JSON.stringify({jsonrpc:'2.0',id:2,method:'runtime.debug.eval'}) });
      assert.equal((await forbidden.json()).error.message, 'runtimeDebug.pipeOnly');
      const asset = await fetch(`${base}/webview/runtime/messagepack-codec.mjs`);
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get('content-type'), /javascript/);
      assert.ok((await asset.text()).length > 1000);
      phase = 'socket connect';
      client = io(`${base}/wba`, { path:'/wba_ws/socket.io', transports:['websocket'], reconnection:false, timeout:3000,
        query:{client_instance_id:'client_abcdefghijkl'}, auth:{rpcCodec:'msgpack-v1'} });
      await Promise.race([once(client, 'connect'), once(client, 'connect_error').then(([error]) => { throw error; })]);
      phase = 'socket reply';
      const received = once(client, 'rpc');
      client.emit('rpc', encodeWbaRpcMessage({jsonrpc:'2.0',id:3,method:'te2.ping'}));
      const [binary] = await received;
      const reply = decodeWbaRpcMessage(binary);
      assert.equal(reply.id, 3);
      assert.equal(reply.result.ok, true);
      const invalid = io(`${base}/wba`, {path:'/wba_ws/socket.io',transports:['websocket'],reconnection:false,
        query:{client_instance_id:'invalid'},auth:{rpcCodec:'msgpack-v1'}});
      try {
        const [error] = await once(invalid, 'connect_error');
        assert.equal(error.message, 'invalid_client_presentation_identity');
      } finally { invalid.disconnect(); }
      client.disconnect();
      const connectedAgain = once(client, 'connect');
      client.connect();
      await connectedAgain;
      const receivedAgain = once(client, 'rpc');
      client.emit('rpc', encodeWbaRpcMessage({jsonrpc:'2.0',id:4,method:'te2.ping'}));
      assert.equal(decodeWbaRpcMessage((await receivedAgain)[0]).id, 4);
      client.disconnect();
      phase = 'EOF';
      const exited = once(child, 'exit');
      child.stdin.end();
      const [code] = await exited;
      assert.equal(code, 0, errors);
    } catch (error) {
      throw new Error(`${phase}: ${error.message}\n${errors}`, { cause: error });
    } finally {
      clearTimeout(watchdog);
      client?.disconnect();
      if (child.exitCode === null) {
        const stopped = once(child, 'exit');
        child.kill();
        await stopped;
      }
      await rm(root, { recursive:true, force:true });
    }
  });
}

test('Bun Fetch adapter preserves compression and ETags', {skip: !process.versions.bun}, async () => {
  const { handleBunHttp } = await import('../workbench_protocol_proxy/node_workbench_adapter/dist/server/bun-engine.mjs');
  const { sendWebviewResourceResponse } = await import('../workbench_protocol_proxy/node_workbench_adapter/dist/server/webview-resource-response.mjs');
  const { gunzipSync } = await import('node:zlib');
  const resource = {body:Buffer.from('let example = true;\n'.repeat(200)),contentType:'text/javascript',etag:'"one"',lastModified:'today'};
  const compressed = await handleBunHttp(new Request('http://localhost/resource', {headers:{'accept-encoding':'gzip'}}),
    (req,res) => sendWebviewResourceResponse(req,res,resource));
  assert.equal(compressed.headers.get('content-encoding'), 'gzip');
  assert.deepEqual(gunzipSync(new Uint8Array(await compressed.arrayBuffer())), resource.body);
  const cached = await handleBunHttp(new Request('http://localhost/resource', {headers:{'if-none-match':'"one"'}}),
    (req,res) => sendWebviewResourceResponse(req,res,resource));
  assert.equal(cached.status, 304);
  assert.equal((await cached.arrayBuffer()).byteLength, 0);
});

test('code-server UDS transport does not replace the native WebSocket global', async () => {
  const native = globalThis.WebSocket;
  await import('../workbench_protocol_proxy/node_workbench_adapter/vscode_oss_runtime/platform/remote/browser/browserSocketFactory.mjs');
  assert.equal(globalThis.WebSocket, native);
  assert.equal(globalThis.WebSocket.OPEN, 1);
});
