import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as browser from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/messagepack-codec.mjs';
import * as server from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/server-messagepack-codec.mjs';

const serverUrl = new URL('../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/server-messagepack-codec.mjs', import.meta.url);

test('server and browser codecs exchange ordinary maps, Unicode and binary values', () => {
  const value = {jsonrpc:'2.0', id:7, params:{message:'λ😀診断', binary:Uint8Array.of(0,128,255),
    values:[true,null,-17,1.25,Number.MAX_SAFE_INTEGER], nested:{text:'hello'}}};
  for (const [encode, decode] of [[server.encodeWbaRpcMessage, browser.decodeWbaRpcMessage],
                                 [browser.encodeWbaRpcMessage, server.decodeWbaRpcMessage]]) {
    const result = decode(encode(value));
    assert.equal(result.params.message, value.params.message);
    assert.deepEqual([...result.params.binary], [0,128,255]);
    assert.deepEqual(result.params.values, value.params.values);
    assert.deepEqual(result.params.nested, value.params.nested);
  }
});

test('server retains omitted undefined map properties and null array entries', () => {
  const value = {keep:null, omit:undefined, nested:{omit:undefined, keep:1}, array:[undefined,null]};
  const expected = browser.decodeWbaRpcMessage(browser.encodeWbaRpcMessage(value));
  assert.deepEqual(browser.decodeWbaRpcMessage(server.encodeWbaRpcMessage(value)), expected);
  assert.deepEqual(server.decodeWbaRpcMessage(browser.encodeWbaRpcMessage(value)), expected);
});

test('server decoder honors binary subviews and encoded frames remain stable', () => {
  const first = server.encodeWbaRpcMessage({value:'first', bytes:Uint8Array.of(0,255)});
  const saved = first.slice();
  for (let i=0;i<1000;i++) server.encodeWbaRpcMessage({text:'x'.repeat(2000), i});
  assert.deepEqual(first, saved);
  const backing = new Uint8Array(saved.length + 11);
  backing.set(saved, 7);
  const result = server.decodeWbaRpcMessage(new DataView(backing.buffer,7,saved.length));
  assert.equal(result.value,'first');
  assert.deepEqual([...result.bytes], [0,255]);
  assert.throws(() => server.decodeWbaRpcMessage({}), /binary WBA/);
});

function childProbe(url, extraEnv = {}) {
  const code = `const m=await import(${JSON.stringify(url)});
    const value=m.decodeWbaRpcMessage(m.encodeWbaRpcMessage({text:'λ😀',bytes:new Uint8Array([0,128,255])}));
    console.log(JSON.stringify({status:m.serverCodecStatus(),text:value.text,bytes:Array.from(value.bytes)}));`;
  const flags = process.versions.bun ? ['--no-install'] : [];
  const result = spawnSync(process.execPath, [...flags,'--input-type=module','-e',code],
    {env:{...process.env,...extraEnv},cwd:dirname(fileURLToPath(url)),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr || String(result.error));
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.text,'λ😀');
  assert.deepEqual(parsed.bytes,[0,128,255]);
  return parsed.status;
}

test('native mode is observable; forced JavaScript fallback remains functional', () => {
  assert.equal(server.serverCodecStatus().implementation,'msgpackr');
  assert.equal(typeof server.serverCodecStatus().nativeAcceleration,'boolean');
  const status = childProbe(serverUrl.href,{MSGPACKR_NATIVE_ACCELERATION_DISABLED:'true'});
  assert.deepEqual(status,{implementation:'msgpackr',nativeAcceleration:false});
});

test('bundled server codec runs without build node_modules or the native addon', async () => {
  const root = await mkdtemp(join(tmpdir(),'wba-codec-relocated-'));
  try {
    const target = join(root,'server-codec.mjs');
    await copyFile(serverUrl,target);
    const status = childProbe(pathToFileURL(target).href,{MSGPACKR_NATIVE_ACCELERATION_DISABLED:'false'});
    assert.deepEqual(status,{implementation:'msgpackr',nativeAcceleration:false});
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('browser bundle contains no native-loader or server-codec dependency', async () => {
  const source = await readFile(new URL('../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/messagepack-codec.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/msgpackr-extract|node:module|createRequire|serverCodecStatus/);
});
