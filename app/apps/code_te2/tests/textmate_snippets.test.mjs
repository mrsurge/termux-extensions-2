import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

async function fixture() {
  const result = await build({ stdin: { contents: `
    export * from './monaco_editor/editor_textmate_snippets.ts';
    export * from './monaco_editor/editor_textmate_runtime.ts';
    export * from './src/explorer/search/render-styling.ts';
    export * from './src/explorer/extensions/readme-renderer.ts';`,
    resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser' });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64') + '#' + Math.random());
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('TextMate decoration preserves hit/diff wrappers, text and inert markup', async () => {
  const api = await fixture();
  const win = new Window();
  const target = win.document.createElement('div');
  target.innerHTML = '<span class="is-added">const <span class="fe-search-hit">value</span> = &lt;script&gt;;</span>';
  const hit = target.querySelector('.fe-search-hit');
  const text = target.textContent;
  api.applySnippetSyntax(target, [{start:0,end:text.length,color:'#123456',background:'#ffffff',fontStyle:3}]);
  assert.equal(target.style.backgroundColor, '');
  assert.equal(target.textContent, text);
  assert.equal(target.querySelector('.fe-search-hit'), hit);
  assert.ok(hit.querySelector('.te-textmate-token'));
  assert.equal(target.querySelector('script'), null);
  api.applySnippetSyntax(target, [{start:0,end:5,color:'#abcdef',fontStyle:0}]);
  assert.equal(target.querySelector('.te-textmate-token .te-textmate-token'), null);
  assert.equal(target.textContent, text);
  win.close();
});

test('late readiness paints retained rows; recycled/detached rows reject stale results', async () => {
  const api = await fixture();
  const win = new Window();
  const target = win.document.createElement('div');
  target.textContent = 'old'; win.document.body.append(target);
  api.highlightTextmateElement(target, {filePath:'old.js'});
  await tick();
  assert.equal(target.querySelector('.te-textmate-token'), null);
  let resolveOld;
  api.setSnippetSyntaxProvider(request => request.text === 'old'
    ? new Promise(resolve => { resolveOld = resolve; })
    : Promise.resolve([{start:0,end:request.text.length,color:'#112233',fontStyle:0}]));
  await tick();
  target.textContent = 'new'; api.highlightTextmateElement(target, {filePath:'new.py'});
  await tick();
  resolveOld([{start:0,end:3,color:'#ff0000',fontStyle:0}]);
  await tick();
  assert.equal(target.textContent, 'new');
  assert.equal(target.querySelector('.te-textmate-token').style.color, '#112233');
  api.refreshSnippetSyntax(); await tick();
  assert.equal(target.querySelectorAll('.te-textmate-token').length, 1);
  target.remove(); api.refreshSnippetSyntax(); api.setSnippetSyntaxProvider(null);
  win.close();
});

test('real shared grammar preserves multiline state and reuses closure across snippets', async t => {
  t.mock.method(console, 'log', () => {});
  const api = await fixture();
  const grammar = {id:'probe/root.json',scopeName:'source.probe',language:'probe'};
  const raw = JSON.stringify({scopeName:'source.probe',patterns:[{begin:'/\\*',end:'\\*/',name:'comment.block.probe'}]});
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const calls = [];
  let providers = 0;
  let paletteWrites = 0;
  const runtime = api.createEditorTextmateRuntime({
    getWindow: () => ({location:{search:'?gv_native=1'},parent:{},monaco:{languages:{
      getLanguages:()=>[{id:'probe'}],getEncodedLanguageId:()=>1,setTokensProvider:()=>{ providers++; return {dispose(){}}; },
      setColorMap:()=>{paletteWrites++;},
    }}}), normalizeLanguage:value=>String(value||''),
    fetchFn: async url => url.endsWith('markdown-cache.json')
      ? Response.json({schema:1,bodies:{[grammar.id]:{raw,sha256}}})
      : new Response(await fs.readFile(new URL('../monaco_editor/textmate/onig.wasm',import.meta.url))),
    buildUiUrl:value=>value,
    editorRpcCall: async (method,params) => {
      calls.push(method);
      if (method==='editor.textmate.catalog.get') return {revision:'v1',grammars:[grammar],languages:[]};
      return {revision:'v1',rootScope:params.scope,complete:true,ids:[grammar.id],fingerprints:{[grammar.id]:sha256},bodies:{}};
    },
  });
  runtime.applyThemeToRegistry({name:'test',tokenColors:[{scope:'comment',settings:{foreground:'#123456',fontStyle:'italic'}}]},false);
  const text = '/* start\nstill comment\n*/ plain';
  const tokens = await runtime.tokenizeSnippet({text,language:'probe'});
  assert.ok(tokens.some(token=>token.start===9 && token.color==='#123456' && token.fontStyle===1));
  await runtime.tokenizeSnippet({text:'another',language:'probe'});
  assert.equal(calls.filter(method=>method==='editor.textmate.closure.get').length,1);
  assert.equal(providers,0, 'snippet-only preparation must not replace editor language providers');
  assert.equal(paletteWrites,0, 'snippet theme must not replace the browser worker color map');
  await runtime.prepareTextmateForDocument('file.probe','probe');
  assert.equal(providers,1, 'later editor consumer still installs its provider');
  assert.equal(await runtime.tokenizeSnippet({text:'x'.repeat(65537),language:'probe'}),null);
});

test('no Highlight.js imports remain in production snippet rendering', async () => {
  const source = await fs.readFile(new URL('../src/explorer/search/render-styling.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/hljs|highlightjs|HIGHLIGHT_LANGUAGE_FACTORIES/);
});

test('diff and README callers asynchronously decorate without losing emphasis or code text', async () => {
  const api = await fixture();
  const win = new Window();
  const previous = {document:globalThis.document,window:globalThis.window};
  globalThis.document=win.document; globalThis.window=win;
  try {
    api.setSnippetSyntaxProvider(async request => [{start:0,end:request.text.length,color:'#abcdef',fontStyle:0}]);
    const diff=win.document.createElement('div'); win.document.body.append(diff);
    api.renderHighlightedDiffText(diff,'const newName = 1;','file.js',{mode:'added',compareAgainst:'const oldName = 1;'});
    api.highlightFilterMatches(diff,'newName');
    const changed=diff.querySelector('.is-added');
    const hit=diff.querySelector('.fe-search-hit');
    const readme=win.document.createElement('div'); win.document.body.append(readme);
    api.renderExtensionReadme(readme,'```js\nconst value = 1;\n```');
    await tick();
    assert.equal(diff.textContent,'const newName = 1;');
    assert.equal(diff.querySelector('.is-added'),changed);
    assert.equal(diff.querySelector('.fe-search-hit'),hit);
    assert.ok(hit.querySelector('.te-textmate-token'));
    assert.ok(readme.querySelector('pre > code .te-textmate-token'));
  } finally {
    api.setSnippetSyntaxProvider(null);
    Object.assign(globalThis,previous); win.close();
  }
});

test('theme invalidation fences in-flight colors and bounds concurrent preparation', async () => {
  const api=await fixture(); const win=new Window();
  const pending=[];
  let active=0,maxActive=0;
  api.setSnippetSyntaxProvider(request=>new Promise(resolve=>{
    active++; maxActive=Math.max(active,maxActive);
    pending.push(()=>{active--;resolve([{start:0,end:request.text.length,color:'#abcdef',fontStyle:0}]);});
  }));
  const rows=[];
  for(let i=0;i<8;i++){
    const row=win.document.createElement('div'); row.textContent='row'+i; win.document.body.append(row); rows.push(row);
    api.highlightTextmateElement(row,{filePath:'file.js'});
  }
  await tick(); assert.equal(pending.length,4);
  api.refreshSnippetSyntax();
  for(const resolve of pending.splice(0))resolve();
  await tick();
  assert.equal(rows[0].querySelector('.te-textmate-token'),null,'invalidated completion cannot paint');
  while(pending.length){for(const resolve of pending.splice(0))resolve();await tick();}
  assert.equal(maxActive,4);
  assert.ok(rows.every(row=>row.querySelector('.te-textmate-token')));
  api.setSnippetSyntaxProvider(null); win.close();
});
