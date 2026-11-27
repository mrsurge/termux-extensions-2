import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { preserveMinimapCanvas } from '../../../../scripts/monaco_minimap_canvas.mjs';

test('minimap keeps old text through drag layouts and commits a full bitmap on resize', () => {
  const path = new URL('../../../static/vendor/monaco-editor-core/esm/vs/editor/browser/viewParts/minimap/minimap.js', import.meta.url);
  const patched = preserveMinimapCanvas(readFileSync(path, 'utf8'));
  const body = patched.split('    _applyLayout() {')[1].split('\n    }')[0];
  const layout = new Function(body);
  const node = {setLeft(){},setWidth(){},setHeight(){}};
  const options = {canvasInnerWidth: 40,canvasInnerHeight: 886};
  const writes = [];
  const canvas = name => ({...node,domNode:new Proxy({width:40,height:886},{
    set(target,key,value){writes.push([name,key,value]);return Reflect.set(target,key,value);}
  })});
  const view = {_model:{options},_canvas:canvas('text'),_decorationsCanvas:canvas('decorations'),
    _slider:node,_domNode:node,_shadow:node};
  layout.call(view);
  assert.deepEqual(writes,[]);
  options.canvasInnerWidth++;
  layout.call(view); layout.call(view);
  options.canvasInnerHeight--;
  layout.call(view); layout.call(view);
  assert.deepEqual(writes,[['decorations','width',41],['decorations','height',885]]);
  const paint = new Function('ctx','imageData','dirtyY1','dirtyHeight',
    patched.split('// Finally, paint to the canvas')[1].split('// Save rendered data')[0]
      .split("getContext('2d');")[1]);
  const ctx = {canvas:view._canvas.domNode,putImageData:(image,...rect)=>writes.push(['paint',...rect])};
  writes.length = 0;
  const image = {width:41,height:885};
  paint(ctx,image,20,4);
  paint(ctx,image,20,4);
  assert.deepEqual(writes,[['text','width',41],['text','height',885],['paint',0,0],['paint',0,0,0,20,41,4]]);
});
