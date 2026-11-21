// Run with Electron, an isolated --user-data-dir, and a display. Actual key
// events and the painted cursor (not model-to-screen estimates) are required.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const dir = path.resolve(__dirname, '../app/static/vendor/monaco-editor-core/te2-lang/bootstrap');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const html = `<link rel="stylesheet" href="/monaco.bootstrap.bundle.css">
<link rel="stylesheet" href="/touch.css"><script src="/touch.js"></script>
<div id="editor" style="width:720px;height:250px"></div>
<script type="module">
import {loadMonaco} from '/monaco.bootstrap.bundle.js';
const m = await loadMonaco();
m.languages.register({id:'probe'});
m.languages.registerInlayHintsProvider('probe', {provideInlayHints(){return {
  hints:[{position:{lineNumber:1,column:2}, label:[{label:'HI'},{label:'NT'}],
          kind:2,paddingLeft:true,paddingRight:true}], dispose(){}
}}});
const e = m.editor.create(document.querySelector('#editor'), {
  value:'abc', language:'probe', cursorStyle:'block',cursorBlinking:'solid',fontSize:18,inlayHints:{enabled:'on'}
});
e.focus();
window.touchTest=async()=>{
  window['monaco-touch-selection'].editorTouchSelectionHelp(e,{mobile:true,getHandleFeedback:()=>({magnifier:true,vibrationMs:0})});
  const handle=document.querySelector('.selector.right .bottom-cursor');
  const rect=n=>n.getBoundingClientRect();
  const glyph=rect(document.querySelector('.cursors-layer .cursor'));
  const y=glyph.top+glyph.height/2;
  const spans=[...document.querySelectorAll('.view-line .te2-inlay-cursor-stop')].map(rect);
  const lo=Math.min(...spans.map(r=>r.left)),hi=Math.max(...spans.map(r=>r.right));
  const fire=(type,x)=>{const t=new Touch({identifier:1,target:handle,clientX:x,clientY:y});
    handle.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[t],changedTouches:[t]}));};
  fire('touchstart',glyph.left);const results=[];
  for(const x of [lo+2,hi-2,hi+glyph.width,hi-2,lo+2]){
    fire('touchmove',x);await new Promise(r=>setTimeout(r,150));
    const lens=document.querySelector('.monaco-touch-lens-caret');
    results.push({col:e.getPosition().column,width:rect(lens).width,cell:glyph.width*1.65});
  }
  fire('touchend',lo+2);await new Promise(r=>setTimeout(r,200));
  const bar=e.getDomNode().querySelector('.monaco-editor-touch-selections > .right');
  return {results,bar:new DOMMatrix(bar.style.transform).m41+rect(e.getDomNode()).left,hi};
};
window.read = () => ({
  col:e.getPosition().column, selected:e.getModel().getValueInRange(e.getSelection()),
  x:document.querySelector('.cursors-layer .cursor')?.getBoundingClientRect().left,
  right:document.querySelector('.cursors-layer .cursor')?.getBoundingClientRect().right,
  glyph:document.querySelector('.cursors-layer .cursor')?.textContent,
  hintRects:[...document.querySelectorAll('.view-line .te2-inlay-cursor-stop')].map(el=>{
    const r=el.getBoundingClientRect();return [r.left,r.right];
  }),value:e.getValue(),
  ready:document.querySelector('.view-line')?.textContent.includes('HINT') && e.hasTextFocus()
});
window.paintTest=async()=>{
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  e.setValue(['abcdef','xy','abcdefgh'].join(String.fromCharCode(10)));
  e.updateOptions({inlayHints:{enabled:'on',padding:true},roundedSelection:true});
  e.setSelection({startLineNumber:1,startColumn:3,endLineNumber:3,endColumn:6});
  await delay(500);
  const h=document.querySelector('.selector.left .bottom-cursor'),r=h.getBoundingClientRect();
  const t=new Touch({identifier:2,target:h,clientX:r.left+r.width/2,clientY:r.top+r.height/2});
  const fire=type=>h.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[t],changedTouches:[t]}));
  fire('touchstart');fire('touchmove');await delay(180);
  const paint=n=>{const s=getComputedStyle(n);return [s.backgroundColor,s.borderRadius]};
  const lens=document.querySelector('.monaco-touch-selection-lens');
  const sample=lens.querySelector('.monaco-touch-lens-caret').previousElementSibling;
  const hints=n=>[...n.querySelectorAll('.te2-inlay-cursor-stop')].map(paint);
  const marks=[...lens.querySelectorAll('.monaco-touch-lens-selection')].map(paint);
  const masks=[...document.querySelectorAll('.view-overlays .selected-text + .cslr.monaco-editor-background')].map(paint);
  const outer=[...document.querySelectorAll('.view-overlays .selected-text')].map(paint);
  const result={source:hints(document.querySelector('.view-line')),copy:hints(sample),marks,masks,outer};
  fire('touchend');return result;
};
</script>`;
const server = createServer((req,res) => {
  if(req.url === '/') {res.setHeader('Content-Type','text/html');res.end(html);return;}
  const name=req.url.slice(1);
  if(name==='touch.js'||name==='touch.css'){
    res.setHeader('Content-Type',name.endsWith('js')?'text/javascript':'text/css');
    createReadStream(path.resolve(__dirname,'../app/apps/code_te2/static/vendor/monaco-touch-selection',
      name.endsWith('js')?'monaco-touch-selection.patched.umd.js':'monaco-touch-selection.css')).pipe(res);return;
  }
  if(!['monaco.bootstrap.bundle.css','monaco.bootstrap.bundle.js'].includes(name)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/css');
  createReadStream(path.join(dir,name)).pipe(res);
});
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const win = new BrowserWindow({width:800,height:400});
  try {
    const wc = win.webContents;
    await win.loadURL('http://127.0.0.1:'+server.address().port);
    win.focus(); wc.focus();
    for(let i=0;i<100 && !await wc.executeJavaScript('window.read?.().ready');i++) await wait(50);
    assert.equal(await wc.executeJavaScript('window.read?.().ready'),true);
    for(const modifiers of [[],['shift']]) {
      const samples=[await wc.executeJavaScript('read()')];
      for(const keyCode of ['Right','Right','Right','Left','Left','Left']){
        wc.sendInputEvent({type:'keyDown',keyCode,modifiers});
        wc.sendInputEvent({type:'keyUp',keyCode,modifiers});
        samples.push(await wc.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(read()))))'));
      }
      assert.deepEqual(samples.map(s=>s.col),[1,2,3,4,3,2,1]);
      const xs=samples.map(s=>s.x);
      assert.deepEqual(xs,xs.slice().reverse());
      for(const s of samples.filter(s=>s.col===2)){
        assert.ok(s.right>s.x && s.hintRects.length>=2);
        for(const [left,right] of s.hintRects) assert.ok(Math.min(right,s.right)-Math.max(left,s.x)<1,JSON.stringify(s));
        assert.equal(s.glyph,'b');
      }
      assert.deepEqual(samples.map(s=>s.selected),modifiers.length
        ? ['','a','ab','abc','ab','a',''] : Array(7).fill(''));
    }
    const drag=await wc.executeJavaScript('touchTest()');
    assert.deepEqual(drag.results.map(s=>s.col),[2,2,3,2,2]);
    for(const s of drag.results)assert.ok(Math.abs(s.width-s.cell)<3,JSON.stringify(drag));
    assert.ok(Math.abs(drag.bar-drag.hi)<2,JSON.stringify(drag));
    await wc.insertText('X');
    assert.equal((await wc.executeJavaScript('read()')).value,'aXbc');
    const paint=await wc.executeJavaScript('paintTest()');
    assert.deepEqual(paint.copy,paint.source);
    assert.ok(paint.copy.some(([bg,r])=>bg!=='rgba(0, 0, 0, 0)' && r!=='0px'));
    for(const group of [paint.masks,paint.outer])assert.ok(group.some(([c,r])=>r!=='0px'&&paint.marks.some(([mc,mr])=>mc===c&&mr===r)),JSON.stringify(paint));
    console.log('PASS: arrows, touch snapping, handle anchor, lens cell width and insertion across a padded hint.');
  } finally {win.destroy(); server.close();}
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
