import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalOutputCursor, createTerminalDrawer } from '../app/static/js/file_explorer_terminal.js';

test('checkpoint cursor drops covered deltas and accepts only exact raw offsets', () => {
  const cursor = new TerminalOutputCursor(); cursor.offset = 20;
  assert.equal(cursor.accept(0, 20, 20), 'old');
  assert.equal(cursor.accept(20, 24, 4), 'next');
  assert.equal(cursor.offset, 24);
  assert.equal(cursor.accept(20, 24, 4), 'old');
  assert.equal(cursor.accept(23, 28, 5), 'gap');
  assert.equal(cursor.accept(25, 28, 3), 'gap');
  assert.equal(cursor.offset, 24);
  assert.equal(cursor.accept(24, 28, 3), 'gap');
  assert.equal(cursor.accept(-1, 0, 1), 'gap');
  assert.equal(cursor.accept(NaN, 0, 0), 'gap');
});

test('drawer fences checkpoint handoff, preserves shell on minimize/dispose and hides desktop keys', async () => {
  class Element {
    hidden = false; textContent = ''; dataset = {}; handlers = new Map(); children = [];
    classList = { remove() {}, toggle() {} };
    addEventListener(name, handler) { this.handlers.set(name, handler); }
    setAttribute() {}
    append(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    querySelector(selector) { return elements.get(selector) || null; }
  }
  const elements = new Map(['.fx-terminal-drawer', '.fx-terminal-viewport', '.fx-terminal-keys', '[data-terminal-status]',
    '[data-action="terminal"]', '[data-terminal="minimize"]', '[data-terminal="maximize"]', '[data-terminal="close"]'].map(name => [name, new Element()]));
  const views = [], calls = [], checkpoints = [], handlers = new Map(), errors = [];
  class View {
    cols = 80; rows = 24; writes = []; disposed = false;
    constructor() { views.push(this); }
    loadAddon() {} open() {} reset() { this.writes = []; } focus() {}
    write(data, done) { this.writes.push(data); if (done) queueMicrotask(done); }
    dispose() { this.disposed = true; }
    onData(callback) { this.input = callback; return { dispose() {} }; }
    attachCustomKeyEventHandler() {}
  }
  const originals = Object.fromEntries(['window', 'document', 'navigator', 'ResizeObserver'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Desktop' } });
  globalThis.document = { createElement: () => new Element(), head: { append(node) { if (node.onload === null) return; queueMicrotask(() => node.onload?.()); } } };
  globalThis.window = { Terminal: View, FitAddon: { FitAddon: class { fit() {} } },
    WebFontsAddon: { WebFontsAddon: class { async loadFonts() {} } },
    te2TerminalTouchSelection: { attach() { return { dispose() {} }; } },
    teUI: { dialog: { async confirm() { return true; } } } };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const tabs = { tab: { id: 'tab', shellId: 'shell' }, terminal(method, params) {
    calls.push([method, params]);
    if (method === 'terminal.checkpoint') return new Promise(resolve => checkpoints.push(resolve));
    return Promise.resolve({});
  } };
  const socket = { connected: true, on(name, callback) { handlers.set(name, callback); }, off(name) { handlers.delete(name); } };
  const tick = () => new Promise(setImmediate);
  const drawer = createTerminalDrawer(new Element(), tabs, socket, error => errors.push(error));
  try {
    drawer.sync(tabs.tab); await tick();
    assert.equal(checkpoints.length, 1);
    assert.equal(elements.get('.fx-terminal-keys').hidden, true);
    const chunk = (start, data) => ({ tabId: 'tab', shellId: 'shell', startOffset: start, endOffset: start + data.length, data: new Uint8Array(data) });
    handlers.get('terminal_output')(chunk(0, [65])); // covered by checkpoint
    handlers.get('terminal_output')(chunk(1, [66])); // arrived before ACK
    checkpoints.shift()({ shellId: 'shell', ansi: 'A', outputOffset: 1, pendingBytes: new Uint8Array() }); await tick();
    assert.deepEqual(views[0].writes, ['A', new Uint8Array([66])]);
    views[0].input('x'); await tick();
    assert.equal(calls.at(-1)[0], 'terminal.input');
    handlers.get('disconnect')();
    assert.equal(views[0].disposed, true);
    drawer.sync(tabs.tab); await tick();
    assert.equal(views.length, 2, 'unchanged tab IDs still remount after disconnect');
    checkpoints.shift()({ shellId: 'shell', ansi: 'reconnected', outputOffset: 2 }); await tick();
    assert.deepEqual(views[1].writes, ['reconnected']);
    await elements.get('[data-terminal="minimize"]').handlers.get('click')();
    assert.equal(calls.some(([method]) => method === 'terminal.close'), false);
    await elements.get('[data-terminal="minimize"]').handlers.get('click')(); await tick();
    assert.equal(checkpoints.length, 1);
    drawer.sync(null);
    checkpoints.shift()({ shellId: 'shell', ansi: 'obsolete', outputOffset: 2 }); await tick();
    assert.equal(views[1].disposed, true);
    assert.equal(views[1].writes.includes('obsolete'), false);
    assert.equal(errors.length, 0);
  } finally {
    drawer.dispose();
    assert.equal(calls.some(([method]) => method === 'terminal.close'), false);
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
