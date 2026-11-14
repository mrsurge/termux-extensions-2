import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// Real controller + secondary shell + mobile key routing; network and Monaco
// construction are boundary doubles so no shared running server is touched.
async function fixture({ waitSnapshot = false, native = false } = {}) {
  const result = await build({ stdin: { contents: `
    export * from './main_page/frontend/mobile-secondary-editor.ts';
    export { bootSecondaryEditorRuntime } from './main_page/frontend/secondary-editor-runtime.ts';
    export * from './monaco_editor/inline_host.ts';
    export * from './src/mobile-input/editor-special-key-bridge.ts';
    export { testState, connections, gates } from './main_page/frontend/connections/ui-ipc-rpc.ts';
  `, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser', plugins: [{
    name: 'boundaries', setup(b) {
      b.onResolve({filter:/^\/static\/js\/file_icons\.js$/},()=>({path:'file-icons',namespace:'test'}));
      b.onLoad({filter:/.*/,namespace:'test'},()=>({loader:'js',contents:'export async function getIcon(){return null;} export function renderIcon(){}'}));
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
          openState:{projectPath:'/project',revision:1,projectGeneration:1,recents:[],
            editorPlacement:{area:'secondary',revision:1,paths:[]}} };
        export function createUiIpcRpcConnection(options) {
          const row = { options, disposed:false, calls:[] }; connections.push(row);
          return { connect:async()=>{}, dispose:()=>{row.disposed=true;},
            request:async(method,params)=>{
              row.calls.push([method,params]);
              if(row.disposed) throw Error('disposed connection used');
              if(method==='ui.host.bootSnapshot.get' && gates.snapshot) await gates.snapshot;
              if(method==='ui.host.file.open') {
                testState.clientForeground={path:params.path};testState.secondaryContent=null;
                const open=testState.openState;
                if(!open.recents.some(entry=>entry.path===params.path))open.recents.push({path:params.path,label:params.path.split('/').pop(),exists:true});
                if(!open.editorPlacement.paths.includes(params.path))open.editorPlacement.paths.push(params.path);
                open.editorPlacement.revision=++open.revision;
              }
              if(method==='ui.host.recentFile.close') {
                if(gates.closeError)throw Error(gates.closeError);
                const open=testState.openState;
                if(params.projectPath!==testState.activeProject||params.revision!==open.editorPlacement.revision||params.projectGeneration!==open.projectGeneration)throw Error('stale close');
                open.editorPlacement.paths=open.editorPlacement.paths.filter(path=>path!==params.path);
                open.editorPlacement.revision=++open.revision;
                const successor=open.editorPlacement.paths[0]||null;
                if(testState.clientForeground.path===params.path)testState.clientForeground={path:successor};
                return {removed:true,successor,openState:structuredClone(open)};
              }
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
  const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text+'\n//# sourceURL=direct-secondary-fixture.js').toString('base64')}#${Math.random()}`);
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
  Object.defineProperty(win.navigator,'userAgent',{value:native?'Linux Desktop':'Android Mobile'});
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
  const settle=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('presentation did not settle');};
  const toasts=[],nativeListeners=new Set(),nativeModes=[];
  let controller;
  if(native){
    win.te2Electron={secondEditorReady:async()=>({ok:true}),
      setSecondEditorMode:async mode=>{nativeModes.push(mode);return {ok:true,presentation:{mode,dockSize:400,detachedBounds:{x:0,y:0,width:400,height:700},maximized:false}};},
      onSecondEditorCommand:listener=>{nativeListeners.add(listener);return()=>nativeListeners.delete(listener);}};
    const runtime=await api.bootSecondaryEditorRuntime(container,{toast:message=>toasts.push(message)},
      {rendererIdentity:{clientInstanceId:'client_bbbbbbbbbbbb',mainPageClientInstanceId:'client_aaaaaaaaaaaa',clientRole:'secondary'}});
    controller={destroy:()=>runtime.dispose(),open:async(projectPath,path)=>{
      for(const listener of nativeListeners)listener({type:'open',projectPath,path});
      await settle(()=>container.querySelector('.fe-file-tab.active')?.dataset.path===path);
    }};
  }else{
    controller=api.createMobileSecondaryEditorController({root,container,tab,toast:message=>toasts.push(message)});
    controller.attachDrawer({open(){},close(){}});
  }
  return {api,win,root,container,tab,primary,controller,toasts,settle,finishSnapshot,nativeListeners,nativeModes,
    async close(){controller.destroy();api.disposeInlineEditorHost(primary);win.happyDOM.abort();
      for(const[key,value]of saved){if(value===undefined)delete globalThis[key];else Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
    }};
}

test('secondary working tabs select through their own lane and close with backend fences',async t=>{
  const expectedErrors=t.mock.method(console,'error',()=>{});
  const f=await fixture();try{
    await f.controller.open('/project','/project/a.ts');
    await f.controller.open('/project','/project/b.ts');
    const track=()=>f.container.querySelector('.fe-file-tabs-track');
    const paths=()=>[...track().querySelectorAll('.fe-file-tab')].map(tab=>tab.dataset.path);
    assert.deepEqual(paths(),['/project/a.ts','/project/b.ts']);
    await f.controller.open('/project','/project/b.ts');
    assert.equal(paths().length,2,'opening an existing tab must not duplicate it');
    track().querySelector('[data-path="/project/a.ts"]').click();
    await f.settle(()=>track().querySelector('.active')?.dataset.path==='/project/a.ts');
    const row=f.api.connections.at(-1);
    assert.ok(row.calls.some(([method,p])=>method==='ui.host.file.open'&&p.path==='/project/a.ts'&&p.source==='secondary_editor_tab'&&p.focus===true));
    const revision=f.api.testState.openState.editorPlacement.revision;
    f.api.gates.closeError='close cancelled';
    track().querySelector('[data-path="/project/a.ts"] .fe-file-tab-close').click();
    await f.settle(()=>f.toasts.includes('close cancelled'));
    assert.equal(expectedErrors.mock.callCount(),1);
    assert.deepEqual(paths(),['/project/a.ts','/project/b.ts']);
    assert.equal(f.api.mounts.filter(m=>m.role==='secondary').length,1,'tab switches retain one working runtime');
    f.api.gates.closeError=null;
    track().querySelector('[data-path="/project/a.ts"] .fe-file-tab-close').click();
    await f.settle(()=>paths().length===1);
    assert.deepEqual(paths(),['/project/b.ts']);
    const close=row.calls.filter(([method])=>method==='ui.host.recentFile.close').at(-1);
    assert.deepEqual(close[1],{path:'/project/a.ts',revision,projectPath:'/project',projectGeneration:1});
    assert.equal(track().querySelector('.active')?.dataset.path,'/project/b.ts');
    assert.ok(f.primary.isConnected);
    assert.equal(f.api.testState.openState.recents.length,2,'common recents are filtered by secondary placement');
    track().querySelector('.fe-file-tab-close').click();
    await f.settle(()=>!f.container.querySelector('.te2-secondary-editor'));
    assert.equal(row.disposed,true);
    assert.ok(f.primary.isConnected,'last secondary tab close must retain primary runtime');
    assert.equal(row.calls.filter(([method])=>method==='ui.host.clientForeground.clear').length,0,
      'the final tab close already committed membership; hiding the presentation must not close the area again');
  }finally{await f.close();}
});

test('secondary tabs reconcile only their notifications and reconnect snapshot',async()=>{
  const f=await fixture();try{
    await f.controller.open('/project','/project/a.ts');
    const row=f.api.connections.at(-1);
    const paths=()=>[...f.container.querySelectorAll('.fe-file-tab')].map(tab=>tab.dataset.path);
    const open=f.api.testState.openState;
    open.recents.push({path:'/project/remote.ts',exists:true},{path:'/project/primary.ts',exists:true});
    open.editorPlacement.paths.push('/project/remote.ts');
    open.editorPlacement.revision=++open.revision;
    row.options.onNotification('ui.openState.changed',structuredClone(open));
    assert.deepEqual(paths(),['/project/a.ts','/project/remote.ts']);
    f.win.dispatchEvent(new f.win.CustomEvent('code-te2:open-state-changed',{detail:{...open,editorPlacement:{paths:['/project/primary.ts'],revision:100}}}));
    assert.deepEqual(paths(),['/project/a.ts','/project/remote.ts']);
    row.options.onNotification('ui.openState.changed',{...open,revision:1,editorPlacement:{paths:['/project/primary.ts'],revision:1}});
    assert.deepEqual(paths(),['/project/a.ts','/project/remote.ts']);
    row.options.onNotification('ui.openState.changed',{...open,projectPath:'/wrong',editorPlacement:{paths:['/project/primary.ts'],revision:100}});
    assert.deepEqual(paths(),['/project/a.ts','/project/remote.ts']);
    open.editorPlacement.paths=['/project/remote.ts'];open.editorPlacement.revision=++open.revision;
    f.api.testState.clientForeground={path:'/project/remote.ts'};
    row.options.onConnect();
    await f.settle(()=>paths().length===1);
    assert.deepEqual(paths(),['/project/remote.ts']);
    const snapshot=JSON.stringify(f.win.__codeTe2EditorState);
    assert.equal(snapshot,undefined,'secondary does not overwrite primary window state');
    f.controller.destroy();
    row.options.onNotification('ui.openState.changed',structuredClone(open));
    assert.equal(f.container.querySelector('.fe-file-tab'),null);
  }finally{await f.close();}
});

test('native Electron presentation uses the same tabs and disposes its command subscription',async()=>{
  const f=await fixture({native:true});try{
    await f.controller.open('/project','/project/a.ts');
    await f.controller.open('/project','/project/b.ts');
    assert.equal(f.container.querySelector('.te2-secondary-editor').dataset.presentation,'electron');
    assert.equal(f.container.querySelectorAll('.fe-file-tab').length,2);
    assert.equal(f.api.connections[0].options.query.client_role,'secondary');
    f.container.querySelector('.te2-secondary-editor-detach').click();
    await f.settle(()=>f.nativeModes.includes('detached'));
    assert.equal(f.container.querySelectorAll('.fe-file-tab').length,2);
    f.controller.destroy();
    assert.equal(f.nativeListeners.size,0);
    assert.equal(f.api.connections[0].disposed,true);
  }finally{await f.close();}
});

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
