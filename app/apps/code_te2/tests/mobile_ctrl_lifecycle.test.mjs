import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function fixture() {
  const result = await build({
    entryPoints: ['monaco_editor/editor_mobile_ctrl_helper_utils.ts'],
    bundle: true, write: false, format: 'esm', platform: 'browser',
  });
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document, KeyboardEvent: win.KeyboardEvent, CustomEvent: win.CustomEvent });
  let loads = 0;
  const scripts = [];
  const append = document.head.appendChild.bind(document.head);
  document.head.appendChild = element => {
    if (element.tagName !== 'SCRIPT') return append(element);
    loads += 1;
    scripts.push(element);
    return element;
  };
  const bindings = [];
  function createEditor() {
    const dom = document.createElement('div');
    document.body.append(dom);
    let input;
    const listeners = new Map();
    const emit = name => [...(listeners.get(name) ?? [])].forEach(fn => fn());
    const subscribe = name => fn => {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set); set.add(fn);
      return { dispose: () => set.delete(fn) };
    };
    function replaceInput() {
      input = document.createElement('textarea');
      input.className = 'inputarea'; dom.replaceChildren(input);
    }
    replaceInput();
    const editor = {
      getDomNode: () => dom, hasTextFocus: () => document.activeElement === input,
      onDidFocusEditorWidget: subscribe('widget'), onDidFocusEditorText: subscribe('text'),
      onDidBlurEditorWidget: subscribe('blur'), onWillChangeModel: subscribe('before'),
      onDidChangeModel: subscribe('model'), onDidDispose: subscribe('dispose'),
      focus() { input.focus(); },
    };
    return {
      editor, emit, input: () => input, listeners,
      bind() { const binding = runtime.bindVendoredCtrlHelperFocus(editor, {}); bindings.push(binding); return binding; },
      switchModel(focused = false) { emit('before'); replaceInput(); if (focused) input.focus(); emit('model'); },
    };
  }
  function key(input) {
    const event = new win.KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
    input.dispatchEvent(event); return event.defaultPrevented;
  }
  return { win, runtime, createEditor, key, loads: () => loads,
    finishLoads() { scripts.splice(0).forEach(s => s.onload(new win.Event('load'))); },
    cleanup() { bindings.forEach(b => b?.dispose()); win.happyDOM.abort(); },
  };
}

test('focused model switches move interception and control replay to the new textarea', async () => {
  const f = await fixture();
  try {
    const e = f.createEditor(); e.editor.focus(); e.bind();
    f.win.term.attachCustomKeyEventHandler(() => false);
    const old = e.input();
    assert.equal(f.key(old), true);
    e.switchModel(true);
    assert.equal(f.key(old), false, 'detached input has no adapter');
    assert.equal(f.key(e.input()), true, 'same widget, new input is bound');
    const replay = [];
    e.input().addEventListener('keydown', event => { if (event.ctrlKey) replay.push(event.key); });
    f.win.term.input('\u0007');
    assert.deepEqual(replay, ['g']);
    f.finishLoads();
  } finally { f.cleanup(); }
});

test('unfocused switch waits for text focus even without a widget-focus transition', async () => {
  const f = await fixture();
  try {
    const e = f.createEditor(); e.editor.focus(); e.bind();
    f.win.term.attachCustomKeyEventHandler(() => false);
    const palette = document.createElement('input'); document.body.append(palette); palette.focus();
    e.emit('blur'); e.switchModel();
    assert.equal(document.activeElement, palette);
    assert.equal(f.key(e.input()), false);
    e.editor.focus(); e.emit('text');
    assert.equal(f.key(e.input()), true);
    const count = f.loads();
    e.emit('widget'); e.emit('text');
    assert.equal(f.loads(), count, 'duplicate focus events do not reload/rebind');
    f.finishLoads();
  } finally { f.cleanup(); }
});

test('late old-editor cleanup cannot clear a replacement owner', async () => {
  const f = await fixture();
  try {
    const old = f.createEditor(); old.editor.focus(); const binding = old.bind();
    f.win.term.attachCustomKeyEventHandler(() => false);
    const next = f.createEditor(); next.editor.focus(); next.bind();
    old.emit('model'); old.emit('blur'); binding.dispose();
    assert.equal(f.key(next.input()), true);
    next.emit('dispose');
    assert.equal(f.key(next.input()), false);
    assert.ok([...next.listeners.values()].every(set => set.size === 0));
    f.finishLoads(); await Promise.resolve();
    assert.equal(f.key(next.input()), false, 'late script completion cannot restore disposed binding');
  } finally { f.cleanup(); }
});
