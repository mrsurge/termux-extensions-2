import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

async function load(file) {
  const output = await build({entryPoints:[new URL('../monaco_editor/' + file, import.meta.url).pathname],
    bundle:true,write:false,format:'esm',platform:'browser'});
  return import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
}
const {createPersistentGrammarCache} = await load('editor_textmate_persistent_cache.ts');
const {createTextmateGrammarBodyLoader} = await load('editor_textmate_grammar_loader.ts');
const sha = raw => createHash('sha256').update(raw).digest('hex');
const identity = raw => ({id:'extension/root.json',sha256:sha(raw)});
const record = raw => ({...identity(raw),raw,bytes:Buffer.byteLength(raw),touched:1});
const key = value => JSON.stringify([value.id,value.sha256]);
const settle = async () => { for(let i=0;i<20;i++) await new Promise(resolve=>setTimeout(resolve,1)); };
class Storage {
  rows = new Map(); reads = 0; writes = 0;
  async read(keys) {this.reads++;return keys.map(k=>this.rows.get(k));}
  async write(records) {this.writes++;for(const row of records)this.rows.set(key(row),row);}
}

// Event-driven IndexedDB test double: exercises adapter request scheduling and
// transaction completion, not browser durability or quota implementation.
function indexedFixture(t) {
  const stores=new Map();const bodyGets=[];
  const db={createObjectStore:name=>stores.set(name,new Map()),close:()=>{},
    transaction:()=>{
      let pending=0;let finished=false;
      const tx={abort:()=>{finished=true;tx.onabort?.();},objectStore:name=>{
        const rows=stores.get(name);
        function request(action){const req={};pending++;queueMicrotask(()=>{
          if(finished)return;
          action(req);pending--;
          queueMicrotask(()=>{if(!pending&&!finished){finished=true;tx.oncomplete?.();}});
        });return req;}
        return {get:k=>request(req=>{if(name==='bodies')bodyGets.push(k);req.result=rows.get(k);req.onsuccess?.();}),
          put:(value,k)=>rows.set(k,value),delete:k=>rows.delete(k),clear:()=>rows.clear(),
          openCursor:()=>{
            const entries=Array.from(rows);let index=0;const req={};
            const next=()=>request(()=>{const entry=entries[index++];req.result=entry
              ? {key:entry[0],value:entry[1],continue:next}:null;req.onsuccess?.();});
            next();return req;
          }};
      }};return tx;
    }};
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open:()=>{
    const req={result:db};queueMicrotask(()=>{if(!stores.size)req.onupgradeneeded?.();req.onsuccess?.();});return req;
  }}});
  t.after(()=>descriptor?Object.defineProperty(globalThis,'indexedDB',descriptor):delete globalThis.indexedDB);
  return {stores,bodyGets};
}

test('IndexedDB adapter schedules complete records and reuses a new connection', async t => {
  const {stores}=indexedFixture(t);const raw='database body';
  createPersistentGrammarCache().write(identity(raw),raw);await settle();
  assert.equal(stores.get('bodies').size,1);assert.equal(stores.get('metadata').size,1);
  assert.equal((await createPersistentGrammarCache().read([identity(raw)])).get(identity(raw).id),raw);
});

test('IndexedDB metadata bounds body reads and evicts excess entries', async t => {
  const {stores,bodyGets}=indexedFixture(t);const cache=createPersistentGrammarCache();
  await cache.read([identity('missing')]); // Open schema without storing a grammar.
  const bodies=stores.get('bodies'),metadata=stores.get('metadata');
  for(let i=0;i<512;i++){
    const row={...record('x'),id:'id'+i};bodies.set(key(row),row);
    metadata.set(key(row),{bytes:1,touched:i});
  }
  cache.write(identity('new'),'new');await settle();
  assert.equal(bodies.size,512);assert.equal(metadata.size,512);
  assert.equal(bodies.has(key({...identity('x'),id:'id0'})),false);
  bodies.clear();metadata.clear();bodyGets.length=0;
  const identities=[];
  for(let i=0;i<3;i++){
    const row={...record('x'),id:'large'+i};identities.push(row);
    bodies.set(key(row),row);metadata.set(key(row),{bytes:4*1024*1024,touched:1});
  }
  await cache.read(identities);assert.equal(bodyGets.length,2,'read admission capped before body clones');
});

test('IndexedDB blocked open becomes a cache miss and closes a late connection', async t => {
  let req;let closes=0;
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open:()=>{
    req={result:{close:()=>closes++}};queueMicrotask(()=>req.onblocked?.());return req;
  }}});
  t.after(()=>descriptor?Object.defineProperty(globalThis,'indexedDB',descriptor):delete globalThis.indexedDB);
  assert.equal((await createPersistentGrammarCache().read([identity('x')])).size,0);
  req.onsuccess();assert.equal(closes,1);
});

test('cache survives new instances and verifies exact content identity', async () => {
  const storage = new Storage();const raw = '{"patterns":[]}';
  const first = createPersistentGrammarCache(storage);
  first.write(identity(raw),raw);await settle();
  const second = createPersistentGrammarCache(storage);
  assert.equal((await second.read([identity(raw)])).get(identity(raw).id),raw);
  assert.equal((await second.read([identity('changed')])).size,0);
  storage.rows.set(key(identity(raw)), {...record(raw),raw:'corrupt'});
  assert.equal((await second.read([identity(raw)])).size,0);
  first.write(identity(raw),'wrong hash');await settle();
  assert.equal(storage.writes,1,'unverified bodies never persist');
});

test('write failures and storage absence are optional, not grammar failures', async () => {
  const storage = new Storage();storage.write = async () => {throw Error('quota');};
  const cache = createPersistentGrammarCache(storage);
  cache.write(identity('body'),'body');await settle();
  assert.equal((await cache.read([identity('body')])).size,0);
  assert.equal(storage.reads,0,'failed storage is disabled for this page');
  assert.equal((await createPersistentGrammarCache().read([identity('body')])).size,0);
});

test('oversized rows and write queues are bounded', async () => {
  const storage = new Storage();const cache = createPersistentGrammarCache(storage);
  const raw = 'x'.repeat(4*1024*1024+1);
  cache.write(identity(raw),raw);await settle();assert.equal(storage.writes,0);
  storage.rows.set(key(identity('valid')), {...record('valid'),raw,bytes:5});
  assert.equal((await cache.read([identity('valid')])).size,0);
  for(let i=0;i<300;i++)cache.write({id:'id'+i,sha256:sha('body')},'body');
  await settle();assert.ok(storage.rows.size<=257);
});

test('slow reads have a deadline and cannot return late hits', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let release;
  const cache = createPersistentGrammarCache({read:()=>new Promise(resolve=>{release=resolve;}),write:async()=>{}});
  const pending = cache.read([identity('body')]);
  t.mock.timers.tick(250);
  const result = await pending;assert.equal(result.size,0);
  release([record('body')]);await Promise.resolve();assert.equal(result.size,0);
});

function loader(storage, bundle={}, revision='v1') {
  const cache = createPersistentGrammarCache(storage);const calls=[];
  const raw='{"scopeName":"source.test","patterns":[]}';const id=identity(raw);
  return {calls,raw,id,body:createTextmateGrammarBodyLoader(async(method,params)=>{
    calls.push(method);
    if(method==='editor.textmate.closure.get')return {revision:params.revision,rootScope:params.scope,
      complete:true,ids:[id.id],fingerprints:{[id.id]:id.sha256},bodies:{}};
    assert.equal(method,'editor.textmate.chunk.get');
    return {...id,revision:params.revision,offset:0,raw,nextOffset:Array.from(raw).length,done:true};
  },async()=>bundle,undefined,cache),revision};
}

test('reload reuses disk bodies after metadata; packaged hits do not read disk', async () => {
  const storage=new Storage();const first=loader(storage);
  await first.body.prepare('source.test','v1');await settle();
  assert.deepEqual(first.calls,['editor.textmate.closure.get','editor.textmate.chunk.get']);
  const second=loader(storage);
  await second.body.prepare('source.test','v2');
  assert.equal(await second.body.load(second.id.id,'v2'),second.raw);
  assert.deepEqual(second.calls,['editor.textmate.closure.get']);
  const reads=storage.reads;
  const third=loader(storage,{[second.id.id]:{raw:second.raw,sha256:second.id.sha256}});
  await third.body.prepare('source.test','v3');assert.equal(storage.reads,reads);
});

test('stale hash fetches current body and storage error keeps the selected transport', async () => {
  const storage=new Storage();storage.rows.set(key(identity('old')),record('old'));
  let instance=loader(storage);await instance.body.prepare('source.test','v1');
  assert.ok(instance.calls.includes('editor.textmate.chunk.get'));
  storage.read=async()=>{throw Error('denied');};
  instance=loader(storage);await instance.body.prepare('source.test','v1');
  assert.equal(await instance.body.load(instance.id.id,'v1'),instance.raw);
});

test('revision reset fences in-flight persistent reads', async () => {
  let release;let started;
  const entered=new Promise(resolve=>{started=resolve;});
  const instance=loader({read:()=>{started();return new Promise(resolve=>{release=resolve;});},write:async()=>{}});
  const pending=instance.body.prepare('source.test','v1');
  const rejected=assert.rejects(pending,/superseded/);
  await entered;instance.body.reset();release([record(instance.raw)]);await rejected;
  assert.deepEqual(instance.calls,['editor.textmate.closure.get']);
});

test('unavailable WebCrypto uses SHA-256 for persistent writes and reuse', async t => {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
  t.after(()=>Object.defineProperty(globalThis,'crypto',descriptor));
  const storage=new Storage();const cache=createPersistentGrammarCache(storage);
  cache.write(identity('body'),'body');await settle();
  assert.equal(storage.writes,1);
  assert.equal((await createPersistentGrammarCache(storage).read([identity('body')])).get(identity('body').id),'body');
  storage.rows.set(key(identity('body')),{...record('body'),raw:'evil'});
  assert.equal((await cache.read([identity('body')])).size,0,'same-size corruption is rejected');
});
