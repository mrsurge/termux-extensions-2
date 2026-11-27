import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';

test('ligatures are off by default and update local and sibling views until disposal', async t => {
  const source = await readFile(new URL('../monaco_editor/font_ligatures.ts',import.meta.url),'utf8');
  const {code} = await transform(source,{loader:'ts',format:'esm'});
  const pref = await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  const win = new EventTarget(), values = new Map();
  win.localStorage = {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  globalThis.window = win;
  t.after(()=>delete globalThis.window);
  assert.equal(pref.fontLigaturesEnabled(),false);
  const seen=[], stop=pref.observeFontLigatures(value=>seen.push(value));
  pref.setFontLigatures(true);
  assert.equal(pref.fontLigaturesEnabled(),true);
  values.clear();
  win.dispatchEvent(Object.assign(new Event('storage'),{storageArea:win.localStorage,key:null}));
  stop();
  pref.setFontLigatures(true);
  assert.deepEqual(seen,[true,false]);
});
