import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { Window } from 'happy-dom';

const script = fs.readFileSync(import.meta.dirname + '/../static/vendor/monaco-touch-selection/monaco-touch-selection.patched.umd.js', 'utf8');

function mount(options) {
  const win = new Window();
  win.eval(script);
  const element = win.document.createElement('div');
  element.innerHTML = '<div class="overflow-guard"></div>';
  win.document.body.append(element);
  const disposal = [];
  const editor = new Proxy({
    getDomNode: () => element,
    getModel: () => null,
    getSelection: () => null,
    getOption: () => 16,
    getLayoutInfo: () => ({ width: 500, height: 500 }),
    onDidDispose: callback => { disposal.push(callback); return { dispose() {} }; },
  }, { get: (target, name) => target[name] ?? (() => ({ dispose() {} })) });
  win['monaco-touch-selection'].editorTouchSelectionHelp(editor, options);
  return { win, dispose: () => disposal.forEach(callback => callback()),
    names: () => [...win.document.querySelectorAll('.menu-item')].map(el => el.title) };
}

test('deployed historical touch helper limits all islands and disposes its UI', async () => {
  const rejectCustom = () => { throw new Error('Custom editing tools must not run'); };
  const h = mount({ mobile: true, historicalReadOnly: true,
    tools: rejectCustom, leadingTools: rejectCustom, navigationTools: rejectCustom });
  try {
    assert.deepEqual(h.names(), ['copy', 'select', 'select all', 'find', 'close']);
    assert.equal(h.win.document.querySelectorAll('.monaco-editor-touch-selections').length, 1);
    h.dispose();
    assert.equal(h.names().length, 0);
    assert.equal(h.win.document.querySelectorAll('.monaco-editor-touch-selections').length, 0);
  } finally { await h.win.happyDOM.close(); }
});

test('working editor retains its default editing menu', async () => {
  const h = mount({ mobile: true });
  try {
    assert.ok(h.names().includes('cut'));
    assert.ok(h.names().includes('paste'));
    assert.ok(h.names().includes('undo'));
    h.dispose();
  } finally { await h.win.happyDOM.close(); }
});
