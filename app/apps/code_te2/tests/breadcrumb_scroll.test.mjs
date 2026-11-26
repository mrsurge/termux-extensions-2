import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { build } from 'esbuild';

test('initially hidden breadcrumb reveals target on layout; deliberate scroll survives until next file', async () => {
  const result = await build({ entryPoints:['monaco_editor/editor_breadcrumb_runtime.ts'], bundle:true, format:'esm', write:false });
  const {createEditorBreadcrumbRuntime} = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  const win = new Window(), doc = win.document, bar = doc.createElement('div');
  let resized, width = 0, content = 0, offset = 0;
  const old = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { constructor(cb){ resized = cb; } observe(){} disconnect(){} };
  Object.defineProperties(bar, {
    clientWidth:{get:()=>width}, scrollWidth:{get:()=>content},
    scrollLeft:{get:()=>offset,set:v=>{offset=Math.max(0, Math.min(v,content-width));}},
  });
  const runtime = createEditorBreadcrumbRuntime({ getDocument:()=>doc, getBreadcrumbElement:()=>bar, getEditor:()=>null });
  try {
    runtime.init();
    runtime.updatePath('/deep/nested/first.ts', true);
    width=120; content=500; resized();
    assert.equal(offset,380);
    bar.dispatchEvent(new win.WheelEvent('wheel',{deltaY:-90,cancelable:true}));
    runtime.updateCursor(2); resized(); assert.equal(offset,290);
    runtime.updatePath('/deep/nested/next.ts', true); assert.equal(offset,380);
  } finally { runtime.dispose(); globalThis.ResizeObserver=old; await win.happyDOM.abort(); }
});
