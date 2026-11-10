import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// Real controller + secondary shell + mobile key routing; network and Monaco
// construction are boundary doubles so no shared running server is touched.
async function fixture({ waitSnapshot = false } = {}) {
  const result = await build({ stdin: { contents: `
    export * from './main_page/frontend/mobile-secondary-editor.ts';
    export * from './monaco_editor/inline_host.ts';
    export * from './src/mobile-input/editor-special-key-bridge.ts';
    export { testState, connections, gates } from './main_page/frontend/connections/ui-ipc-rpc.ts';
  `, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser', plugins: [{
    name: 'boundaries', setup(b) {
      b.onLoad({ filter: /client-identity\.ts$/ }, () => ({ loader: 'js', contents: `
        export async function resolveCodeTe2ClientIdentity() { return {
          clientInstanceId:'client_bbbbbbbbbbbb', mainPageClientInstanceId:'client_aaaaaaaaaaaa', windowId:'window_bbbbbbbbbbbbbbbbbbbb'
        }; }
      ` }));
      b.onLoad({ filter: /connections\/vendor-loaders\.ts$/ }, () => ({ loader: 'js', contents: 'export async function ensureSocketIoLoaded() {}' }));
      b.onLoad({ filter: /connections\/ui-ipc-rpc\.ts$/ }, () => ({ loader: 'js', contents: `
        export const connections = [];
        export const gates = {};
        export const testState = { activeProject:'/project', clientForeground:{path:null}, secondaryContent:null,
          openState:{projectPath:'/project',revision:1,projectGeneration:1} };
        export function createUiIpcRpcConnection(options) {
          const row = { options, disposed:false, calls:[] }; connections.push(row);
          return { connect:async()=>{}, dispose:()=>{row.disposed=true;},
            request:async(method,params)=>{
              row.calls.push([method,params]);
              if(row.disposed) throw Error('disposed connection used');
              if(method==='ui.host.bootSnapshot.get' && gates.snapshot) await gates.snapshot;
              if(method==='ui.host.file.open') {testState.clientForeground={path:params.path};testState.secondaryContent=null;}
              if(method==='ui.host.clientForeground.clear') testState.clientForeground={path:null};
              return method==='ui.host.bootSnapshot.get' ? {snapshot:{host_state:structuredClone(testState)}} : {ok:true};
            }
          };
        }
      ` }));
      b.onLoad({ filter: /monaco_editor\/inline_host\.ts$/ }, () => ({ loader: 'js', contents: `
        import {bindMobileEditorSpecialKeys} from './editor_mobile_special_keys_utils.ts';
        export const mounts = [], keys = [];
        const bindings = new Map();
        export async function bootInlineEditorHost(root, options) {
          const role=options.rendererIdentity?.clientRole||options.editorRole||'primary';
          root.setAttribute('data-te2-working-editor-host','');
          const input=document.createElement('textarea');input.className='inputarea';root.append(input);
          input.addEventListener('keydown',event=>keys.push([role,event.key,event.ctrlKey,event.shiftKey]));
          const editor={getDomNode:()=>root,focus:()=>input.focus(),getAction:()=>({run(){}})};
          bindings.set(root,bindMobileEditorSpecialKeys(editor,window,null,{role,host:root}));
          mounts.push({root,role,input});
        }
        export function disposeInlineEditorHost(root) {bindings.get(root)?.dispose();bindings.delete(root);root.replaceChildren();}
      ` }));
      b.onLoad({ filter: /historical_monaco_boot\.ts$/ }, () => ({ loader: 'js', contents: `
        export async function bootHistoricalDiff(){throw Error('history must not mount in the main document');}
      ` }));
    },
  }] });
  const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
  const win = new Window({ url:'http://localhost/app/code_te2' });
  // Keep the isolated frame's URL for assertions without loading a real server.
  const createElement = win.document.createElement.bind(win.document);
  win.document.createElement = (tag, options) => {
    const element = createElement(tag, options);
    if(tag.toLowerCase()==='iframe') {
      let src='';Object.defineProperty(element,'src',{get:()=>src,set:value=>{src=value;}});
    }
    return element;
  };
  Object.defineProperty(win.navigator,'userAgent',{value:'Android Mobile'});
  const saved = new Map();
  for(const key of ['window','document','navigator','CustomEvent','Event','MouseEvent','KeyboardEvent','InputEvent','HTMLElement','Element','Node','MutationObserver']) {
    saved.set(key,globalThis[key]);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='window'?win:win[key]});
  }
  win.document.body.innerHTML=`<div class="fe-root layout-mobile"><div class="fe-editor-container"><div id="editor-frame"></div></div>
    <div class="drawer-tabs"><button class="drawer-tab active" data-tab="terminal"></button><button id="second"></button></div>
    <div id="second-container"></div></div>`;
  const root=win.document.querySelector('.fe-root'),container=win.document.getElementById('second-container'),tab=win.document.getElementById('second');
  tab.addEventListener('click',()=>tab.classList.add('active'));
  const primary=win.document.getElementById('editor-frame');
  await api.bootInlineEditorHost(primary,{rendererIdentity:{clientRole:'primary'}});
  let finishSnapshot;
  if(waitSnapshot) api.gates.snapshot=new Promise(resolve=>{finishSnapshot=resolve;});
  const toasts=[],controller=api.createMobileSecondaryEditorController({root,container,tab,toast:message=>toasts.push(message)});
  controller.attachDrawer({open(){},close(){}});
  const settle=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('presentation did not settle');};
  return {api,win,root,container,tab,primary,controller,toasts,settle,finishSnapshot,
    async close(){controller.destroy();api.disposeInlineEditorHost(primary);win.happyDOM.abort();
      for(const[key,value]of saved){if(value===undefined)delete globalThis[key];else Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
    }};
}

test('working secondary is a direct element; keys return to primary and teardown is scoped',async()=>{
  const f=await fixture();try{
    await f.controller.open('/project','/project/file.ts');
    assert.equal(f.container.querySelector('iframe'),null);
    assert.ok(f.container.querySelector('.te2-secondary-editor'));
    assert.equal(f.container.querySelector('.te2-secondary-editor-menu-button').hidden,true);
    assert.equal(f.win.document.querySelectorAll('#editor-frame').length,1);
    assert.equal(f.api.connections[0].options.query.client_role,'secondary');
    assert.equal(f.api.connections[0].options.query.main_page_client_instance_id,'client_aaaaaaaaaaaa');
    const panel=f.win.document.querySelector('.te2-mobile-special-key-panel');
    const right=[...panel.querySelectorAll('button')].find(button=>button.title==='Right');
    const tap=()=>{for(const type of ['pointerdown','pointerup']){const event=new f.win.Event(type,{bubbles:true,cancelable:true});
      Object.defineProperties(event,{pointerId:{value:1},button:{value:0},isPrimary:{value:true}});right.dispatchEvent(event);}};
    f.container.querySelector('textarea').focus();tap();
    assert.deepEqual(f.api.keys.at(-1).slice(0,2),['secondary','ArrowRight']);
    f.primary.querySelector('textarea').focus();tap();
    assert.deepEqual(f.api.keys.at(-1).slice(0,2),['primary','ArrowRight']);
    const old=f.api.connections[0];f.container.querySelector('.te2-secondary-editor-close').click();
    await f.settle(()=>old.disposed);
    assert.equal(f.api.currentMobileEditorOwner(f.win),'primary');assert.ok(f.primary.querySelector('textarea'));
    await f.controller.open('/project','/project/reopened.ts');
    assert.equal(f.container.querySelector('iframe'),null);assert.equal(f.api.connections.length,2);
    assert.deepEqual(f.toasts,[]);
  }finally{await f.close();}
});

test('destroy during a slow boot cannot attach a late secondary or disturb primary input',async()=>{
  const f=await fixture({waitSnapshot:true});try{
    await f.settle(()=>f.api.connections.length===1);
    f.controller.destroy();f.controller.destroy();
    f.finishSnapshot();await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(f.api.connections[0].disposed,true);
    assert.equal(f.api.mounts.length,1);assert.ok(f.primary.querySelector('textarea'));
    assert.equal(f.container.children.length,0);assert.deepEqual(f.toasts,[]);
  }finally{await f.close();}
});

test('historical transition uses an isolated frame, then returns working content to a fresh direct mount',async()=>{
  const f=await fixture();try{
    await f.controller.open('/project','/project/file.ts');
    const old=f.api.connections[0];
    const history={kind:'historicalDiff',revision:1,projectPath:'/project',projectGeneration:1,snapshotId:'a'.repeat(64),commitId:'b'.repeat(40),parentId:null,fileIndex:0,
      original:{state:'absent',path:null,id:null,text:null},modified:{state:'text',path:'file.ts',id:'c'.repeat(40),text:'hello'}};
    f.api.testState.secondaryContent=history;
    old.options.onNotification('ui.host.activeFile.changed',{path:'',secondaryContent:history,clientForeground:{path:null}});
    await f.settle(()=>f.container.querySelector('iframe'));
    const frame=f.container.querySelector('iframe');assert.equal(old.disposed,true);
    assert.equal(new URL(frame.src).searchParams.get('te2_secondary_isolated'),'1');
    f.api.testState.secondaryContent=null;f.api.testState.clientForeground={path:'/project/new.ts'};
    f.win.dispatchEvent(new f.win.MessageEvent('message',{origin:f.win.location.origin,source:frame.contentWindow,
      data:{channel:'te2.secondaryEditor.presentation',type:'content',content:{kind:'workingFile',label:'new.ts'}}}));
    await f.settle(()=>f.api.connections.length===2&&f.container.querySelector('textarea'));
    assert.equal(f.container.querySelector('iframe'),null);assert.deepEqual(f.toasts,[]);
    old.options.onNotification('ui.host.activeFile.changed',{path:'/stale'});
    assert.ok(f.container.querySelector('textarea'));
  }finally{await f.close();}
});
