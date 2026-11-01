// Owned subprocess only; never contacts or changes an installed TE2 runtime.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PipeMessagePackDecoder, encodePipeMessage } from '../app/apps/code_te2/workbench_protocol_proxy/node_workbench_adapter/dist/protocol/pipe-codec.mjs';
import { encodeWbaRpcMessage, decodeWbaRpcMessage } from '../app/apps/code_te2/workbench_protocol_proxy/node_workbench_adapter/dist/protocol/messagepack-codec.mjs';

const [binaryArg, outputArg] = process.argv.slice(2);
if (!binaryArg || !outputArg) throw new Error('Usage: node scripts/probe_wba_aot.mjs /path/to/wba-aot /visible/output-directory');
const binary = resolve(binaryArg), output = resolve(outputArg);
await mkdir(join(output, 'state'), {recursive:true});
const state = await mkdtemp(join(output, 'state/probe-'));
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(done => reservation.close(done));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(TE2_|TE_|NODE_|BUN_)/.test(key)));
Object.assign(env, {
  TE2_ADAPTER_HOST:'127.0.0.1', TE2_ADAPTER_PORT:String(port), TE2_CODE_SERVER_HTTP:'http://127.0.0.1:1',
  TE2_EXTENSION_STORAGE_PATH:join(state,'extensions'), TE2_WEBVIEW_RECONSTRUCTION_STORAGE_PATH:join(state,'webviews'),
});
const started = performance.now();
const child = spawn(binary, [], {cwd:state, env, stdio:['pipe','pipe','pipe']});
const exit = once(child, 'exit');
let stderr = '';
child.stderr.on('data', bytes => { stderr = (stderr+bytes.toString()).slice(-65536); });
const decoder = new PipeMessagePackDecoder();
let readyResolve, readyReject;
const ready = new Promise((resolve,reject) => { readyResolve=resolve; readyReject=reject; });
const pending = new Map();
child.stdout.on('data', bytes => {
  try {
    decoder.feed(bytes, value => {
      if(value.kind==='startup') readyResolve(value.payload);
      if(value.kind==='reply') pending.get(value.payload.id)?.(value.payload);
    });
  } catch(error) { readyReject(error); }
});
child.on('error', readyReject);
child.on('exit', code => readyReject(new Error(`WBA exited ${code}: ${stderr}`)));
const watchdog = setTimeout(() => { readyReject(new Error('WBA probe timed out')); child.kill(); }, 20000);
const report = {binary, externalCodeServer:false};
let client;
try {
  const startup = await ready;
  report.startupMs = performance.now()-started;
  report.startup = startup;
  assert.equal(startup.socketEngine, '@socket.io/bun-engine');
  const pipeReply = new Promise(resolve => pending.set(1,resolve));
  child.stdin.write(encodePipeMessage({jsonrpc:'2.0',id:1,method:'te2.ping'}));
  assert.equal((await Promise.race([pipeReply, exit.then(([code])=>{throw new Error(`WBA exited before pipe reply: ${code}`);})])).result.ok,true);
  report.pipePing = true;
  const base = `http://127.0.0.1:${port}`;
  const health = await fetch(`${base}/health`);
  assert.equal(health.status,200);
  assert.equal((await health.json()).socketEngine,'@socket.io/bun-engine');
  report.httpAssets = {};
  for(const route of ['/webview/runtime/messagepack-codec.mjs','/webview/runtime/socket.io.min.js']) {
    const response = await fetch(base+route);
    assert.equal(response.status,200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.ok(bytes.length>1000);
    report.httpAssets[route] = bytes.length;
  }
  const {io} = createRequire(import.meta.url)('../app/apps/code_te2/vendor/node_socketio/node_modules/socket.io/client-dist/socket.io.js');
  client = io(`${base}/wba`, {path:'/wba_ws/socket.io', transports:['websocket'],reconnection:false,timeout:5000,
    auth:{rpcCodec:'msgpack-v1'},query:{client_instance_id:'client_abcdefghijkl'}});
  await Promise.race([once(client,'connect'),once(client,'connect_error').then(([error])=>{throw error;})]);
  const received = once(client,'rpc');
  client.emit('rpc',encodeWbaRpcMessage({jsonrpc:'2.0',id:2,method:'te2.ping'}));
  const reply = decodeWbaRpcMessage((await Promise.race([received, exit.then(([code])=>{throw new Error(`WBA exited before socket reply: ${code}`);})]))[0]);
  assert.equal(reply.id,2);
  assert.equal(reply.result.ok,true);
  report.socketBinaryPing = true;
  client.disconnect();
  child.stdin.end();
  report.exit = (await exit)[0];
  assert.equal(report.exit,0,stderr);
  decoder.finish();
} catch(error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  client?.disconnect();
  if(child.exitCode===null && child.signalCode===null) { child.kill(); await exit; }
  report.stderr = stderr;
  await writeFile(join(state,'result.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
