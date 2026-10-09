import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHttpGrammarLoader, usesHttpGrammarResources } from '../app/apps/code_te2/monaco_editor/editor_textmate_http.ts';
import { createTextmateGrammarBodyLoader } from '../app/apps/code_te2/monaco_editor/editor_textmate_grammar_loader.ts';
const hash = raw => createHash('sha256').update(raw).digest('hex');

test('HTTP resources are browser-only, including secondary Electron frames', () => {
  const browser = {location:{search:''},parent:{}};
  assert.equal(usesHttpGrammarResources(browser), true);
  assert.equal(usesHttpGrammarResources({...browser,location:{search:'?gv_native=1'}}), false);
  assert.equal(usesHttpGrammarResources({...browser,te2Electron:{}}), false);
  assert.equal(usesHttpGrammarResources({...browser,parent:{te2Electron:{}}}), false);
});

test('HTTP query encodes logical ids and checks response status without retry', async () => {
  let calls = 0;
  const load = createHttpGrammarLoader(async (url, init) => {
    calls++;
    assert.equal(new URL(url,'http://test').searchParams.get('id'),'ext/./syntax/a+b.json');
    assert.equal(init.cache,'no-store');
    assert.ok(init.signal);
    return Response.json({raw:'body'});
  },'/api/app/code_te2/textmate/grammar');
  assert.deepEqual(await load('ext/./syntax/a+b.json','r'),{raw:'body'});
  assert.equal(calls,1);
  const failed = createHttpGrammarLoader(async()=>new Response('',{status:409}),'/grammar');
  await assert.rejects(failed('id','r'),/409/);
});

test('local seeds win; browser misses use HTTP and never chunk RPC', async () => {
  const calls=[];
  const loader=createTextmateGrammarBodyLoader(async(method)=>{
    assert.equal(method,'editor.textmate.closure.get');
    return {revision:'r',rootScope:'root',complete:true,ids:['local','remote'],bodies:{},fingerprints:{local:hash('seed'),remote:hash('body')}};
  },async()=>({local:{raw:'seed',sha256:hash('seed')}}),async(id,revision,fingerprint)=>{
    calls.push(id); assert.equal(fingerprint,hash('body'));
    return {id,revision,sha256:fingerprint,raw:'body'};
  });
  await loader.prepare('root','r');
  assert.equal(await loader.load('local','r'),'seed');
  assert.equal(await loader.load('remote','r'),'body');
  assert.deepEqual(calls,['remote']);
});

test('HTTP mismatches fail closed; resetting fences an in-flight body', async () => {
  let release;
  const loader=createTextmateGrammarBodyLoader(async()=>{throw Error('no RPC');},async()=>({}),
    async(id,revision)=>{await new Promise(resolve=>{release=resolve;});return {id,revision,sha256:hash('body'),raw:'body'};});
  const pending=loader.load('id','r');
  const rejected=assert.rejects(pending,/superseded/);
  await new Promise(resolve=>setTimeout(resolve,10));
  loader.reset(); release(); await rejected;
  const bad=createTextmateGrammarBodyLoader(async()=>{throw Error('no RPC');},async()=>({}),async()=>({id:'wrong',revision:'r',sha256:hash('body'),raw:'body'}));
  await assert.rejects(bad.load('id','r'),/Invalid HTTP/);
});
