import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {Window} from 'happy-dom';

const built=await build({entryPoints:['main_page/frontend/host-resize-manager.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const {initResizeManager}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=resize-manager-test.js').toString('base64')}`);

function fixture(mobile=false){
  const win=new Window(),doc=win.document,saved=new Map();
  for(const key of ['window','document','HTMLElement','Event','CustomEvent','localStorage','getComputedStyle']){
    saved.set(key,globalThis[key]);
    globalThis[key]=key==='window'?win:key==='document'?doc:key==='getComputedStyle'?win.getComputedStyle.bind(win):win[key];
  }
  doc.body.innerHTML=`<div class="fe-root ${mobile?'layout-mobile':'layout-desktop'} te2-secondary-editor-docked">
    <div id="fe-drawer"></div><div id="agent-drawer" class="open"></div>
    <div id="secondary-editor-host"></div><div id="terminal-drawer" class="open"></div>
    <div id="editor-tile"></div>
    ${['terminal','explorer','agent','secondary','invalid'].map(panel=>`<div class="resize-handle" data-panel="${panel}"></div>`).join('')}
    <iframe id="real-frame"></iframe></div>`;
  const root=doc.querySelector('.fe-root');
  root.getBoundingClientRect=()=>({width:1600});
  doc.documentElement.style.setProperty('--terminal-height','340px');
  doc.documentElement.style.setProperty('--explorer-width','430px');
  doc.documentElement.style.setProperty('--agent-width','400px');
  root.style.setProperty('--secondary-editor-dock-size','320px');
  doc.documentElement.style.setProperty('user-select','text','important');
  doc.documentElement.style.setProperty('cursor','crosshair');
  const frame=doc.getElementById('real-frame');
  frame.style.setProperty('pointer-events','auto','important');
  const captures=[],captured=new Set();
  for(const handle of doc.querySelectorAll('.resize-handle')){
    handle.setPointerCapture=id=>{captures.push(['set',handle.dataset.panel,id]);captured.add(id);};
    handle.hasPointerCapture=id=>captured.has(id);
    handle.releasePointerCapture=id=>{captures.push(['release',handle.dataset.panel,id]);captured.delete(id);};
  }
  const handle=panel=>doc.querySelector(`[data-panel="${panel}"]`);
  const pointer=(target,type,props={})=>{
    const event=new win.Event(type,{bubbles:true,cancelable:true});
    Object.defineProperties(event,Object.fromEntries(Object.entries({pointerId:1,button:0,isPrimary:true,clientX:800,clientY:500,...props}).map(([key,value])=>[key,{value}])));
    target.dispatchEvent(event);return event;
  };
  let dispose=initResizeManager();
  const restored=()=>{
    assert.equal(frame.style.getPropertyValue('pointer-events'),'auto');
    assert.equal(frame.style.getPropertyPriority('pointer-events'),'important');
    assert.equal(doc.documentElement.style.getPropertyValue('user-select'),'text');
    assert.equal(doc.documentElement.style.getPropertyPriority('user-select'),'important');
    assert.equal(doc.documentElement.style.cursor,'crosshair');
    assert.equal(doc.querySelector('.dragging'),null);
    assert.equal(doc.getElementById('fe-resize-drag-shield'),null);
  };
  return {win,doc,root,frame,handle,pointer,captures,restored,
    restart(){const old=dispose;dispose=initResizeManager();return old;},
    dispose:()=>dispose(),close(){dispose();win.happyDOM.abort();for(const[key,value]of saved){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}};
}

test('drawer drag uses one captured pointer over tiled Monaco, without a fullscreen shield',()=>{
  const f=fixture();try{
    let resizes=0;f.win.addEventListener('resize',()=>resizes++);
    const tile=f.doc.getElementById('editor-tile');
    tile.addEventListener('pointermove',event=>event.stopImmediatePropagation(),true);
    f.pointer(f.handle('terminal'),'pointerdown');
    assert.deepEqual(f.captures,[['set','terminal',1]]);
    assert.equal(f.doc.getElementById('fe-resize-drag-shield'),null);
    assert.equal(f.frame.style.pointerEvents,'none');
    f.pointer(tile,'pointermove',{pointerId:2,clientY:200});
    assert.equal(resizes,0);
    f.pointer(tile,'pointermove',{clientY:400});
    assert.equal(f.doc.documentElement.style.getPropertyValue('--terminal-height'),'440px');
    assert.equal(resizes,1);
    f.pointer(f.handle('agent'),'pointerdown',{pointerId:2});
    assert.equal(f.captures.length,1);
    f.pointer(tile,'pointerup',{pointerId:2});
    assert.equal(f.frame.style.pointerEvents,'none');
    f.pointer(tile,'pointerup');f.restored();
    assert.deepEqual(f.captures.at(-1),['release','terminal',1]);
    assert.equal(JSON.parse(f.win.localStorage.getItem('code_te2_layout_prefs')).terminalHeight,'440px');
    f.pointer(tile,'pointermove',{clientY:250});assert.equal(resizes,1);
  }finally{f.close();}
});

for(const ending of ['pointercancel','lostpointercapture','window-up','blur','hidden','pagehide','dispose']){
  test(`resize ${ending} restores iframe/page interaction and releases the drag`,()=>{
    const f=fixture();try{
      const events=[];
      for(const type of ['start','end'])f.win.addEventListener(`code-te2:secondary-editor-resize-${type}`,()=>events.push(type));
      f.pointer(f.handle('secondary'),'pointerdown');
      if(ending==='blur'||ending==='pagehide')f.win.dispatchEvent(new f.win.Event(ending));
      else if(ending==='window-up')f.pointer(f.win,'pointerup');
      else if(ending==='hidden'){Object.defineProperty(f.doc,'hidden',{value:true});f.doc.dispatchEvent(new f.win.Event('visibilitychange'));}
      else if(ending==='dispose')f.dispose();
      else f.pointer(f.handle('secondary'),ending);
      f.restored();assert.deepEqual(events,['start','end']);
    }finally{f.close();}
  });
}

test('touch/mouse legacy streams cannot double-start; invalid and collapsed handles do not capture',()=>{
  const f=fixture();try{
    f.pointer(f.handle('invalid'),'pointerdown');
    f.pointer(f.handle('terminal'),'pointerdown',{button:2});
    f.pointer(f.handle('terminal'),'pointerdown',{isPrimary:false});
    f.doc.getElementById('terminal-drawer').classList.add('terminal-drawer--collapsed');
    f.pointer(f.handle('terminal'),'pointerdown');
    assert.equal(f.captures.length,0);f.restored();
    f.doc.getElementById('terminal-drawer').classList.remove('terminal-drawer--collapsed');
    f.handle('terminal').dispatchEvent(new f.win.Event('mousedown',{bubbles:true}));
    f.handle('terminal').dispatchEvent(new f.win.Event('touchstart',{bubbles:true}));
    assert.equal(f.captures.length,0);
  }finally{f.close();}
});

test('mobile/desktop height clamps and side-panel/native resize signals remain intact',()=>{
  for(const mobile of [false,true]){
    const f=fixture(mobile);try{
      f.pointer(f.handle('terminal'),'pointerdown');f.pointer(f.doc,'pointermove',{clientY:-1000});
      assert.equal(f.doc.documentElement.style.getPropertyValue('--terminal-height'),mobile?'397px':'800px');
      f.pointer(f.doc,'pointermove',{clientY:2000});assert.equal(f.doc.documentElement.style.getPropertyValue('--terminal-height'),'150px');
      f.pointer(f.doc,'pointerup');
      for(const panel of ['explorer','agent','secondary']){
        f.pointer(f.handle(panel),'pointerdown');f.pointer(f.doc,'pointermove',{clientX:790});f.pointer(f.doc,'pointerup');
      }
      assert.equal(f.doc.documentElement.style.getPropertyValue('--explorer-width'),'420px');
      assert.equal(f.doc.documentElement.style.getPropertyValue('--agent-width'),'410px');
      assert.equal(f.root.style.getPropertyValue('--secondary-editor-dock-size'),'330px');
      f.restored();
    }finally{f.close();}
  }
});

test('reinitialization disposes the old manager; unavailable capture/storage cannot strand input',()=>{
  const f=fixture();try{
    f.pointer(f.handle('terminal'),'pointerdown');
    const old=f.restart();f.restored();old();
    f.handle('terminal').setPointerCapture=()=>{throw Error('unsupported');};
    const storage=globalThis.localStorage;
    globalThis.localStorage={setItem(){throw Error('denied');},getItem:key=>storage.getItem(key)};
    f.pointer(f.handle('terminal'),'pointerdown');f.pointer(f.doc,'pointermove',{clientY:450});f.pointer(f.doc,'pointerup');
    f.restored();assert.equal(f.doc.documentElement.style.getPropertyValue('--terminal-height'),'390px');
    f.dispose();f.pointer(f.handle('terminal'),'pointerdown');f.restored();
  }finally{f.close();}
});
