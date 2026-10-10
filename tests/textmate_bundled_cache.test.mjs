import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { validateCache } from '../scripts/build_textmate_cache.mjs';
import { createBundledGrammarCache } from '../app/apps/code_te2/monaco_editor/editor_textmate_bundled_cache.ts';
import { createTextmateGrammarBodyLoader } from '../app/apps/code_te2/monaco_editor/editor_textmate_grammar_loader.ts';
const hash = raw => createHash('sha256').update(raw).digest('hex');

test('legacy grammar assets retain only the self-contained settings JSON grammar', () => {
  const root = new URL('../app/apps/code_te2/monaco_editor/textmate/grammars/', import.meta.url);
  assert.deepEqual(fs.readdirSync(root).sort(), ['json.JSON.tmLanguage.json']);
  const grammar = JSON.parse(fs.readFileSync(new URL('json.JSON.tmLanguage.json', root), 'utf8'));
  assert.equal(grammar.scopeName, 'source.json');
  function verifyIncludes(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.include === 'string') {
      assert.ok(value.include.startsWith('#') || ['$self', '$base'].includes(value.include),
        `Settings JSON grammar requires an external grammar: ${value.include}`);
      if (value.include.startsWith('#')) assert.ok(grammar.repository[value.include.slice(1)]);
    }
    for (const child of Object.values(value)) verifyIncludes(child);
  }
  verifyIncludes(grammar);
  const settings = fs.readFileSync(new URL('../app/apps/code_te2/main_page/frontend/ui/cm6-json-textmate-field.ts', import.meta.url), 'utf8');
  assert.ok(settings.includes('/grammars/json.JSON.tmLanguage.json'));
  const manifest = JSON.parse(fs.readFileSync(new URL('../app/android_editor_assets_bundle.json', import.meta.url), 'utf8'));
  assert.ok(manifest.entries.some(entry => entry.kind === 'tree'
    && entry.src === 'app/apps/code_te2/monaco_editor/textmate'));
});

test('packaged Markdown closure is hash-valid and available in the existing local asset tree', () => {
  const cache = JSON.parse(fs.readFileSync(new URL('../app/apps/code_te2/monaco_editor/textmate/markdown-cache.json', import.meta.url)));
  validateCache(cache);
  assert.equal(Object.keys(cache.bodies).length, 72);
  assert.ok(cache.bodies['vscode.markdown/./syntaxes/markdown.tmLanguage.json']);
});

test('local seeds are verified once; corrupt bodies are not admitted', async () => {
  let reads = 0;
  const cache = createBundledGrammarCache(async () => {
    reads++;
    return Response.json({schema:1, bodies:{good:{raw:'good',sha256:hash('good')},bad:{raw:'wrong',sha256:hash('expected')}}});
  });
  assert.deepEqual(Object.keys(await cache()), ['good']);
  await cache();
  assert.equal(reads,1);
});

test('plain HTTP without WebCrypto still verifies packaged seeds', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'crypto', descriptor) : delete globalThis.crypto);
  let reads = 0;
  const cache = createBundledGrammarCache(async () => {
    reads++;
    return Response.json({schema:1,bodies:{good:{raw:'😀body',sha256:hash('😀body')},bad:{raw:'evil',sha256:hash('body')}}});
  });
  assert.deepEqual(Object.keys(await cache()), ['good']);
  assert.deepEqual(Object.keys(await cache()), ['good']);
  assert.equal(reads, 1);
});

test('backend selection admits matching cache bodies and chunks only changed overrides', async () => {
  const calls = [];
  const loader = createTextmateGrammarBodyLoader(async (method, params) => {
    calls.push({method,params});
    if (method.endsWith('closure.get')) return {revision:'r1',rootScope:'root',complete:true,ids:['local','override'],bodies:{},fingerprints:{local:hash('seed'),override:hash('😀new')}};
    assert.equal(params.id,'override');
    const raw = params.offset === 0 ? '😀' : 'new';
    return {revision:'r1',id:'override',offset:params.offset,nextOffset:params.offset+Array.from(raw).length,raw,done:params.offset!==0,sha256:hash('😀new')};
  },async()=>({local:{raw:'seed',sha256:hash('seed')},override:{raw:'old',sha256:hash('old')}}));
  await loader.prepare('root','r1');
  assert.equal(await loader.load('local','r1'),'seed');
  assert.equal(await loader.load('override','r1'),'😀new');
  assert.equal(calls.length,3);
  assert.equal(calls[0].params.metadataOnly,true);
  await loader.prepare('root','r1');
  assert.equal(calls.length,3);
});

test('oversized closure prefixes retain bounded on-demand reads', async () => {
  const loader = createTextmateGrammarBodyLoader(async (method, params) => {
    if (method.endsWith('closure.get')) return {revision:'r',rootScope:'root',complete:false,ids:[],bodies:{},fingerprints:{}};
    assert.equal(method,'editor.textmate.chunk.get');
    return {revision:'r',id:params.id,offset:0,nextOffset:4,raw:'body',done:true,sha256:hash('body')};
  },async()=>({}));
  await loader.prepare('root','r');
  assert.equal(await loader.load('extra','r'),'body');
});

test('revision reset fences an in-flight chunk without admitting its body', async () => {
  let release;
  const blocked = new Promise(resolve => {release=resolve;});
  const loader = createTextmateGrammarBodyLoader(async (method,params) => {
    if (method.endsWith('closure.get')) return {revision:params.revision,rootScope:'root',complete:true,ids:['x'],bodies:{},fingerprints:{x:hash('body')}};
    await blocked;
    return {revision:params.revision,id:'x',offset:0,nextOffset:4,raw:'body',done:true,sha256:hash('body')};
  },async()=>({}));
  const prepared=loader.prepare('root','r1');
  await new Promise(resolve=>setTimeout(resolve,0));
  loader.reset();
  await assert.rejects(prepared,/superseded/);
  release();
  await loader.prepare('root','r2');
  assert.equal(await loader.load('x','r2'),'body');
});
