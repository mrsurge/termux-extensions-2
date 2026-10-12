import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
import { Window } from '../app/apps/code_te2/node_modules/happy-dom/lib/index.js';
const built = await build({ entryPoints: ['app/libs/terminal_runtime/terminal_cursor.ts'], bundle: true, write: false, format: 'esm' });
const { bindTerminalCursor } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('RGB cursor repair survives DOM replacement without changing ordinary cells or inactive cursors', () => {
  const window = new Window(), surface = window.document.createElement('div');
  let render, disposed = false;
  const terminal = { onRender(callback) { render = callback; return { dispose() { disposed = true; } }; } };
  const markup = '<span class="xterm-cursor-block" style="background-color:#24292e;color:#c9d1d9;letter-spacing:1px">x</span><span style="background-color:#24292e">normal</span><span class="xterm-cursor-outline" style="background-color:#24292e">inactive</span>';
  surface.innerHTML = markup; const binding = bindTerminalCursor(surface, terminal);
  assert.equal(surface.children[0].style.backgroundColor, '');
  assert.equal(surface.children[0].style.letterSpacing, '1px');
  assert.equal(surface.children[1].style.backgroundColor, '#24292e');
  assert.equal(surface.children[2].style.backgroundColor, '#24292e');
  surface.innerHTML = markup; render(); assert.equal(surface.children[0].style.color, '');
  binding.dispose(); assert.equal(disposed, true); window.close();
});
