import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

test('settings submodal offers no project-specific presets and saves user-entered rules', async () => {
  const source = await build({stdin:{contents:`
    export * from './main_page/frontend/ui/watcher-exclusions.ts';
    export * from './src/explorer/rpc/client.ts';`, resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
  const api = await import('data:text/javascript;base64,' + Buffer.from(source.outputFiles[0].contents).toString('base64'));
  const win = new Window(), doc = win.document, anchor = doc.createElement('button'), writes = [];
  doc.body.append(anchor);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  api.installExplorerRpcClient({isConnected:()=>true,request:async(method,payload)=>{
    if(method.endsWith('.get')) return {projectPath:'/project',generation:4,exclusions:{},workspace:{'**/target/**':true}};
    writes.push(payload);return {changed:true};
  }});
  try {
    for (const cancel of [true,false]) {
      const done=api.editWatcherExclusions(anchor,()=>{});await tick();
      const dialog=doc.querySelector('dialog');
      assert.match(dialog.querySelector('[data-inherited]').textContent,/target/);
      assert.equal(dialog.querySelectorAll('[data-rows] input').length,0);
      assert.equal(dialog.querySelector('[data-suggest]'),null);
      dialog.querySelector('[data-add]').click();
      dialog.querySelector('[data-rows] input:not([type="checkbox"])').value='**/sample-output/**';
      dialog.querySelector(cancel?'[data-cancel]':'[data-save]').click();
      await done;
      assert.equal(writes.length,cancel?0:1);
    }
    assert.deepEqual(writes[0],{projectPath:'/project',generation:4,previous:{},exclusions:{'**/sample-output/**':true}});
  } finally {win.happyDOM.abort();}
});
