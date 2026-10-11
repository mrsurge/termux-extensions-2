import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TerminalOutputCursor, TerminalInputBatcher, createTerminalDrawer } from '../app/static/js/file_explorer_terminal.js';

test('mobile footer participates in layout below the exact two-row Terminal key dock', () => {
  const template = readFileSync(new URL('../app/apps/file_explorer/template.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../app/apps/file_explorer/terminal_drawer.ts', import.meta.url), 'utf8');
  const terminalTemplate = readFileSync(new URL('../app/apps/terminal/template.html', import.meta.url), 'utf8');
  const footerRule = template.match(/\.fx-mobile-footer \{([^}]+)\}/)[1];
  assert.match(footerRule, /flex: none/);
  assert.doesNotMatch(footerRule, /position: fixed/);
  assert.doesNotMatch(template, /padding-bottom: 90px/);
  assert.match(template, /\.fx-terminal-keys \{[^}]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
  // Footer is the final child of fx-app, not an overlay sibling.
  assert.match(template, /<div class="fx-mobile-footer"[\s\S]*<\/div>\s*<\/div>\s*$/);
  const reference = [...terminalTemplate.matchAll(/<button id="k-[^"]+"[^>]*>([^<]+)<\/button>/g)]
    .map(match => match[1].replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))));
  const names = source.match(/for \(const name of \[([^\]]+)\]\)/)[1].match(/'([^']+)'/g).map(name => name.slice(1, -1));
  assert.deepEqual(names, ['escape', 'minibar', 'dash', 'home', 'up', 'end', 'pageUp', 'tab', 'ctrl', 'alt', 'left', 'down', 'right', 'pageDown']);
  assert.equal(reference.length, names.length);
  assert.match(source, /bindPointerHoldRepeat\(button/);
  assert.match(source, /heldGeneration === generation/);
  assert.match(source, /shouldSuppressMinibarInteraction/);
  assert.match(source, /keyToggle.hidden = !mobileKeys/);
});

test('input batches pending keystrokes in order instead of one ACK per character', async () => {
  const sent = [], replies = [], errors = [];
  const batcher = new TerminalInputBatcher(data => {
    sent.push(data); return new Promise((resolve, reject) => replies.push({ resolve, reject }));
  }, error => errors.push(error));
  batcher.enqueue('a'); await new Promise(setImmediate);
  batcher.enqueue('b'); batcher.enqueue('c'); batcher.enqueue('d');
  await new Promise(setImmediate);
  assert.deepEqual(sent, ['a']);
  replies.shift().resolve(); await new Promise(setImmediate);
  assert.deepEqual(sent, ['a', 'bcd']);
  batcher.enqueue('discarded');
  replies.shift().reject(new Error('connection lost')); await new Promise(setImmediate);
  assert.deepEqual(sent, ['a', 'bcd']);
  assert.equal(errors.length, 1);
  batcher.enqueue('new'); await new Promise(setImmediate);
  batcher.enqueue('stale'); batcher.reset(); replies.shift().resolve(); await new Promise(setImmediate);
  assert.deepEqual(sent, ['a', 'bcd', 'new']);
});

test('input batches bound UTF-8 requests and queue admission without splitting characters', async () => {
  const sent = [], errors = [];
  const batcher = new TerminalInputBatcher(async data => { sent.push(data); }, error => errors.push(error));
  const text = '💚'.repeat(3000);
  batcher.enqueue(text); await new Promise(setImmediate);
  assert.equal(sent.join(''), text);
  assert.ok(sent.every(data => new TextEncoder().encode(data).length <= 4096));
  assert.ok(sent.every(data => !data.includes('\ufffd')));
  batcher.enqueue('x'.repeat(65537)); await new Promise(setImmediate);
  assert.equal(errors.length, 1);
  assert.equal(sent.join(''), text);
});

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
    '[data-directory-status]', '[data-terminal="directory-lock"]', '[data-action="terminal"]', '[data-terminal="minimize"]', '[data-terminal="maximize"]', '[data-terminal="close"]'].map(name => [name, new Element()]));
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
    const lock = elements.get('[data-terminal="directory-lock"]');
    const tracking = elements.get('[data-directory-status]');
    assert.equal(lock.checked, true, 'directory tracking defaults on');
    handlers.get('terminal_directory')({ tabId: 'other', shellId: 'shell', directoryTracking: { state: 'pending', path: '/other' } });
    assert.equal(tracking.textContent, '');
    handlers.get('terminal_directory')({ tabId: 'tab', shellId: 'shell', directoryTracking: { state: 'pending', path: '/next' } });
    assert.match(tracking.textContent, /Waiting for terminal directory change/);
    tabs.tab.directoryLocked = false; drawer.sync(tabs.tab);
    assert.equal(lock.checked, false, 'peer snapshots update the checkbox');
    assert.equal(tracking.textContent, '', 'unlock clears pending UI feedback');
    lock.checked = true; lock.handlers.get('change')(); await tick();
    assert.deepEqual(calls.at(-1), ['terminal.directoryLock', { locked: true }]);
    assert.equal(lock.disabled, false);
    assert.equal(lock.checked, false, 'confirmed snapshot wins over optimistic checkbox');
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
