import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { Window } from 'happy-dom';

const script = fs.readFileSync(import.meta.dirname + '/../static/vendor/monaco-touch-selection/monaco-touch-selection.patched.umd.js', 'utf8');

function mount(options) {
  const win = new Window();
  win.eval(script);
  let element;
  const events = new Map();
  const emit = (name, value) => [...(events.get(name) ?? [])].forEach(callback => callback(value));
  const subscribe = (name, callback) => {
    if (!events.has(name)) events.set(name, new Set());
    events.get(name).add(callback);
    return { dispose: () => events.get(name).delete(callback) };
  };
  const replaceView = () => {
    element?.remove();
    element = win.document.createElement('div');
    element.innerHTML = '<div class="overflow-guard"></div>';
    win.document.body.append(element);
    emit('onDidChangeModel', {});
  };
  replaceView();
  let selection = null;
  const editor = new Proxy({
    getDomNode: () => element,
    getModel: () => null,
    getSelection: () => selection,
    getScrollLeft: () => 0,
    getScrollTop: () => 0,
    getScrolledVisiblePosition: () => null,
    getOption: () => 16,
    getLayoutInfo: () => ({ width: 500, height: 500 }),
  }, { get: (target, name) => target[name] ?? (String(name).startsWith('on')
    ? callback => subscribe(name, callback) : (() => ({ dispose() {} }))) });
  win['monaco-touch-selection'].editorTouchSelectionHelp(editor, options);
  return { win, editor, replaceView, dispose: () => emit('onDidDispose'),
    detachView: () => { element?.remove(); element = null; emit('onDidChangeModel', {}); },
    listeners: name => events.get(name)?.size ?? 0,
    hold: () => {
      selection = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4,
        isEmpty: () => false };
      emit('onContextMenu', { event: { browserEvent: { type: '-monaco-gesturehold' } } });
    },
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

test('model view replacement followed by long press opens only the current touch menu', async () => {
  const h = mount({ mobile: true });
  try {
    for (let i = 0; i < 3; i++) {
      h.replaceView();
      // Match the host open/prefs hook after Monaco has replaced its view DOM.
      if (!h.editor.getDomNode().querySelector('.monaco-editor-touch-selections')) {
        h.win['monaco-touch-selection'].editorTouchSelectionHelp(h.editor, { mobile: true });
      }
      h.hold();
      assert.equal(h.win.document.querySelectorAll('.monaco-editor-touch-selector-menu-stack.show').length, 1);
      assert.equal(h.listeners('onContextMenu'), 1);
      assert.equal(h.win['monaco-touch-selection'].touchSelectionDebug.status().instanceIds.length, 1);
    }
    h.dispose();
    assert.equal(h.win.document.querySelectorAll('.monaco-editor-touch-selector-menu-stack').length, 0);
    assert.equal(h.listeners('onContextMenu'), 0);
    assert.equal(h.listeners('onDidChangeModel'), 0);
    assert.equal(h.win['monaco-touch-selection'].touchSelectionDebug.status().instanceIds.length, 0);
  } finally { await h.win.happyDOM.close(); }
});

test('model-null transitions remove touch UI and restore the historical policy with the next view', async () => {
  const h = mount({ mobile: true, historicalReadOnly: true });
  try {
    h.detachView();
    h.hold();
    assert.equal(h.win.document.querySelectorAll('.monaco-editor-touch-selector-menu-stack').length, 0);
    assert.equal(h.listeners('onContextMenu'), 0);
    h.replaceView();
    h.hold();
    assert.deepEqual(h.names(), ['copy', 'select', 'select all', 'find', 'close']);
    assert.equal(h.win.document.querySelectorAll('.monaco-editor-touch-selector-menu-stack.show').length, 1);
    h.dispose();
  } finally { await h.win.happyDOM.close(); }
});

test('repeated helper installation on the same editor is idempotent', async () => {
  const h = mount({ mobile: true });
  try {
    h.win['monaco-touch-selection'].editorTouchSelectionHelp(h.editor, { mobile: true });
    h.hold();
    assert.equal(h.win.document.querySelectorAll('.monaco-editor-touch-selector-menu-stack.show').length, 1);
    assert.equal(h.listeners('onContextMenu'), 1);
    h.dispose();
  } finally { await h.win.happyDOM.close(); }
});
