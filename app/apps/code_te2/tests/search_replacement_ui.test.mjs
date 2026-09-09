import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function moduleAt(path) {
  const bundle = await build({entryPoints:[path], bundle:true, platform:'node', format:'esm', write:false});
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}
const {createContentReplacementController} = await moduleAt('src/explorer/search/replacement-controller.ts');
const {renderContentResults} = await moduleAt('src/explorer/search/results-renderer.ts');
const hit = (start) => ({line:1,column:start,text:'cat cat',snippet:'cat cat',matchText:'cat',
  editTarget:{sourceSha256:'a'.repeat(64),startByte:start,endByte:start+3}});
const files = [{rel:'a.py',matches:[hit(0),hit(4)],fileMatchCount:2}, {rel:'b.py',matches:[hit(0)],fileMatchCount:1}];

function harness({mobile=false, width=1280, confirm=async()=>true, requestHook, allFiles=files}={}) {
  const win = new Window();
  Object.defineProperty(win, 'innerWidth', {value:width, configurable:true});
  Object.assign(globalThis, {window:win, document:win.document, HTMLElement:win.HTMLElement});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:mobile?'Android Mobile':'Desktop'}});
  const root=document.createElement('div'); document.body.append(root);
  const id={searchId:'s',jobId:'j',projectGeneration:1,root:'/p',correlationId:'c'};
  const data={results:[{...allFiles[0],matches:allFiles[0].matches.slice(0,1)}],complete:true,totalMatchCount:3};
  const requests=[], messages=[], confirmations=[];
  let opens=0;
  const controller=createContentReplacementController({data:()=>data, identity:()=>id,ready:()=>true,
    refresh:()=>{},
    render:()=>render(), toast:message=>messages.push(message),
    confirm:async message=>{confirmations.push(message);return confirm(message);},
    request:async(method,params)=>{
      requests.push({method,...params});
      if(requestHook) { const response=await requestHook(method,params,id); if(response!==undefined)return response; }
      if(method==='explorer.search.more')return {result:{results:allFiles,complete:true}};
      return params.phase==='prepare'?{token:params.relativePath,hasDraft:false}:{ok:true,changed:true};
    }});
  function render(){root.replaceChildren();renderContentResults(root,data,{replacement:controller,toast:()=>{},openFileAndMaybeJump:async()=>{opens++;}});}
  render(); controller.setReplacement(true,'');
  const click=label=>{const el=[...root.querySelectorAll('button')].find(e=>e.textContent===label); assert.ok(el,label); assert.equal(el.disabled,false,label);el.click();};
  async function settle(){for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,0));}
  return {root,id,controller,requests,messages,confirmations,click,settle,win,opens:()=>opens};
}

test('Replace all includes hidden retained hits, warns, and uses empty deletion', async()=>{
  const h=harness(); h.click('Replace all'); await h.settle();
  assert.equal(h.confirmations.length,1);
  assert.match(h.confirmations[0],/not shown/);
  assert.deepEqual(h.requests.filter(r=>r.phase==='prepare').map(r=>[r.relativePath,r.matchIndexes,r.replacement]),[['a.py',[0,1],''],['b.py',[0],'']]);
  assert.deepEqual(h.requests.filter(r=>r.phase).map(r=>r.phase),['prepare','apply','prepare','apply']);
  assert.equal(h.root.querySelectorAll('.fe-search-file-group').length,0);
  h.win.happyDOM.abort();
});

test('Show all suppresses hidden warning; dismissed files are excluded',async()=>{
  const h=harness();h.click('Show all');await h.settle();
  assert.equal(h.root.querySelectorAll('.fe-search-match').length,3);
  h.root.querySelector('[aria-label="Dismiss b.py"]').click();
  h.click('Replace all');await h.settle();
  assert.equal(h.confirmations.length,0);
  assert.deepEqual(h.requests.filter(r=>r.phase==='prepare').map(r=>r.relativePath),['a.py']);
  h.win.happyDOM.abort();
});

test('selecting a later hit replaces only its original retained index',async()=>{
  const h=harness();h.click('Show all in file');await h.settle();
  h.root.querySelector('[aria-label="Select match 2 in a.py"]').click();
  h.click('Replace selected');await h.settle();
  assert.deepEqual(h.requests.find(r=>r.phase==='prepare').matchIndexes,[1]);
  h.win.happyDOM.abort();
});

test('draft cancellation preserves that file; failures stop without retrying',async()=>{
  const h=harness({confirm:async()=>false,requestHook:async(_method,p)=>p.phase==='prepare'?{token:'t',hasDraft:true}:undefined});
  h.click('Show all');await h.settle();h.click('Replace all');await h.settle();
  assert.equal(h.requests.filter(r=>r.phase==='apply').length,0);
  assert.match(h.root.textContent,/draft kept/);h.win.happyDOM.abort();
  const fail=harness({requestHook:async(_method,p)=>{if(p.phase==='apply')throw Error('timeout');}});
  fail.click('Show all');await fail.settle();fail.click('Replace all');await fail.settle();
  assert.equal(fail.requests.filter(r=>r.phase==='apply').length,1);
  assert.match(fail.root.textContent,/Remaining files were not attempted/);fail.win.happyDOM.abort();
});

test('identity changes during preparation prevent apply',async()=>{
  const h=harness({requestHook:async(_method,p,id)=>{if(p.phase==='prepare')id.searchId='new';}});
  h.click('Replace');await h.settle();
  assert.equal(h.requests.filter(r=>r.phase==='apply').length,0);h.win.happyDOM.abort();
});

test('mobile long press selects without navigating or toggling back on release',async()=>{
  const h=harness({mobile:true});
  const row=h.root.querySelector('.fe-search-match');
  row.dispatchEvent(new h.win.PointerEvent('pointerdown',{bubbles:true,clientX:30,clientY:30}));
  await new Promise(resolve=>setTimeout(resolve,480));
  h.root.querySelector('.fe-search-match').click();
  assert.equal(h.root.querySelectorAll('input[type="checkbox"]').length,0);
  assert.equal(h.root.querySelector('.fe-search-match').classList.contains('fe-search-selected'),true);
  assert.equal(h.opens(),0);h.win.happyDOM.abort();
});

test('Select all reveals retained hits and avoids hidden-hit confirmation',async()=>{
  const h=harness();h.click('Select all');await h.settle();
  assert.equal(h.root.querySelectorAll('.fe-search-match').length,3);
  assert.equal(h.root.querySelectorAll('.fe-search-match input:checked').length,3);
  h.click('Replace selected');await h.settle();
  assert.equal(h.confirmations.length,0);
  assert.deepEqual(h.requests[0].limit,{maxMatchesPerFile:700,maxMatchesTotal:700});
  h.win.happyDOM.abort();
});

test('more than 64 files are prepared and applied sequentially',async()=>{
  const allFiles=Array.from({length:70},(_,i)=>({rel:`file${i}.py`,matches:[hit(0)],fileMatchCount:1}));
  const h=harness({allFiles});h.click('Select all');await h.settle();h.click('Replace all');await h.settle();
  const calls=h.requests.filter(r=>r.phase);
  assert.equal(calls.length,140);
  for(let i=0;i<calls.length;i+=2){assert.equal(calls[i].phase,'prepare');assert.equal(calls[i+1].phase,'apply');assert.equal(calls[i].relativePath,calls[i+1].relativePath);}
  h.win.happyDOM.abort();
});

test('mobile scrolling cancels pending selection',async()=>{
  const h=harness({mobile:true});const row=h.root.querySelector('.fe-search-match');
  row.dispatchEvent(new h.win.PointerEvent('pointerdown',{bubbles:true,clientX:30,clientY:30}));
  row.dispatchEvent(new h.win.PointerEvent('pointermove',{bubbles:true,clientX:30,clientY:60}));
  await new Promise(resolve=>setTimeout(resolve,480));
  assert.equal(h.root.querySelectorAll('input[type="checkbox"]').length,0);
  assert.equal(h.root.querySelector('.fe-search-match').classList.contains('fe-search-selected'),false);h.win.happyDOM.abort();
});

test('Show all renders the full 700-hit bounded set',async()=>{
  const allFiles=[{rel:'file.py',matches:Array.from({length:700},(_,i)=>hit(i*4)),fileMatchCount:700}];
  const h=harness({allFiles});h.click('Show all');await h.settle();
  assert.equal(h.root.querySelectorAll('.fe-search-match').length,700);
  assert.equal(h.requests.length,1);h.win.happyDOM.abort();
});

test('mobile UA omits all checkboxes even at desktop width; taps still select',async()=>{
  const h=harness({mobile:true,width:1280});h.click('Select all');await h.settle();
  assert.equal(h.root.querySelectorAll('input[type="checkbox"]').length,0);
  h.root.querySelector('.fe-search-match').click();
  assert.equal(h.root.querySelector('.fe-search-match').classList.contains('fe-search-selected'),false);
  h.root.querySelector('.fe-search-file-header').click();await h.settle();
  assert.equal(h.root.querySelectorAll('.fe-search-match.fe-search-selected').length,3);
  assert.equal(h.root.querySelectorAll('input[type="checkbox"]').length,0);
  assert.equal(h.opens(),0);h.win.happyDOM.abort();
});

test('desktop UA keeps checkboxes even at mobile width',()=>{
  const h=harness({width:360});
  assert.equal(h.root.querySelectorAll('input[type="checkbox"]').length,2);
  h.win.happyDOM.abort();
});

test('mobile header long press starts selection; taps toggle full and partial groups',async()=>{
  const h=harness({mobile:true});
  const header=h.root.querySelector('.fe-search-file-header');
  header.dispatchEvent(new h.win.PointerEvent('pointerdown',{bubbles:true,clientX:30,clientY:30}));
  await new Promise(resolve=>setTimeout(resolve,480));await h.settle();
  h.root.querySelector('.fe-search-file-header').click();await h.settle();
  assert.equal(h.root.querySelectorAll('.fe-search-match.fe-search-selected').length,2);
  assert.equal(h.root.querySelectorAll('input[type="checkbox"]').length,0);
  await new Promise(resolve=>setTimeout(resolve,810));
  h.root.querySelector('.fe-search-file-header').click();await h.settle();
  assert.equal(h.root.querySelectorAll('.fe-search-match.fe-search-selected').length,0);
  h.root.querySelector('.fe-search-file-header').click();await h.settle();
  assert.equal(h.root.querySelectorAll('.fe-search-match.fe-search-selected').length,2);
  h.root.querySelector('.fe-search-match').click();
  assert.equal(h.root.querySelectorAll('.fe-search-match.fe-search-selected').length,1);
  h.root.querySelector('.fe-search-file-header').click();await h.settle();
  assert.equal(h.root.querySelectorAll('.fe-search-match.fe-search-selected').length,2);
  assert.equal(h.opens(),0);h.win.happyDOM.abort();
});

test('mobile header scrolling cancels group selection',async()=>{
  const h=harness({mobile:true});const header=h.root.querySelector('.fe-search-file-header');
  header.dispatchEvent(new h.win.PointerEvent('pointerdown',{bubbles:true,clientX:30,clientY:30}));
  header.dispatchEvent(new h.win.PointerEvent('pointermove',{bubbles:true,clientX:30,clientY:60}));
  await new Promise(resolve=>setTimeout(resolve,480));
  assert.equal(h.root.querySelectorAll('.fe-search-selected').length,0);
  assert.equal(h.requests.length,0);h.win.happyDOM.abort();
});
