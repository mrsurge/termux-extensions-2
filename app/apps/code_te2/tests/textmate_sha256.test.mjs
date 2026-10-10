import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
const result = await build({entryPoints:[new URL('../monaco_editor/editor_textmate_sha256.ts',import.meta.url).pathname],
  bundle:true,write:false,format:'esm',platform:'browser',minify:true});
const {grammarSha256} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const bytes = value => new TextEncoder().encode(value);
const expected = value => createHash('sha256').update(value).digest('hex');

test('JavaScript fallback matches standard empty/ASCII/UTF-8 and block-boundary vectors', async t => {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:undefined});
  t.after(()=>descriptor?Object.defineProperty(globalThis,'crypto',descriptor):delete globalThis.crypto);
  for (const value of ['', 'abc', '😀 é 中文', ...[55,56,63,64,65,1000000].map(n=>'a'.repeat(n))]) {
    assert.equal(await grammarSha256(bytes(value)),expected(value));
  }
  assert.equal(await grammarSha256(bytes('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('WebCrypto remains preferred when available', async t => {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  let calls=0;
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{subtle:{digest:(...args)=>{
    calls++;return webcrypto.subtle.digest(...args);
  }}}});
  t.after(()=>descriptor?Object.defineProperty(globalThis,'crypto',descriptor):delete globalThis.crypto);
  assert.equal(await grammarSha256(bytes('native')),expected('native'));
  assert.equal(calls,1);
});

test('large fallback hashing yields to the event loop', async t => {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:undefined});
  t.after(()=>descriptor?Object.defineProperty(globalThis,'crypto',descriptor):delete globalThis.crypto);
  let ticked=false;
  const timer=setTimeout(()=>{ticked=true;},0);
  const value='x'.repeat(1024*1024);
  assert.equal(await grammarSha256(bytes(value)),expected(value));
  clearTimeout(timer);
  assert.equal(ticked,true);
});
