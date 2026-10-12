import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TerminalOutputCursor, TerminalInputBatcher, TerminalFontSizePreference, createTerminalDrawer, bindTerminalDrawerResize } from '../app/static/js/file_explorer_terminal.js';

test('terminal font preference persists, clamps and tolerates unavailable storage', () => {
  const data = new Map();
  const storage = () => ({ getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) });
  const preference = new TerminalFontSizePreference(storage);
  assert.equal(preference.value, 13);
  assert.equal(preference.adjust(1), 14);
  assert.equal(new TerminalFontSizePreference(storage).value, 14);
  assert.equal(preference.adjust(100), 28);
  assert.equal(preference.adjust(-100), 10);
  assert.equal(preference.adjust(NaN), 10);
  data.set('te2_file_explorer_terminal_font_size', 'bad');
  assert.equal(new TerminalFontSizePreference(storage).value, 13);
  const unavailable = new TerminalFontSizePreference(() => { throw new Error('blocked'); });
  assert.equal(unavailable.adjust(1), 14);
});

test('File Explorer terminal shares the Nerd font faces and fallback stack with other terminals', () => {
  const template = readFileSync(new URL('../app/apps/file_explorer/src/styles.css', import.meta.url), 'utf8');
  const codeTemplate = readFileSync(new URL('../app/apps/code_te2/template.html', import.meta.url), 'utf8');
  const terminalTemplate = readFileSync(new URL('../app/apps/terminal/template.html', import.meta.url), 'utf8');
  for (const face of ['Regular', 'Italic', 'Bold', 'BoldItalic']) {
    const asset = `/static/fonts/jetbrains/webfonts/JetBrainsMono-${face}.woff2`;
    assert.ok(template.includes(asset));
    assert.ok(codeTemplate.includes(asset));
    assert.ok(terminalTemplate.includes(asset));
  }
  const source = readFileSync(new URL('../app/apps/file_explorer/terminal_drawer.ts', import.meta.url), 'utf8');
  assert.match(source, /TERMINAL_WEB_FONT_FAMILY = 'JetBrains Mono Nerd'/);
  assert.match(source, /fontFamily: TERMINAL_FONT_FAMILY/);
  assert.match(source, /loadFonts\(\[TERMINAL_WEB_FONT_FAMILY\]\)/);
  assert.match(source, /ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas/);
  assert.equal((template.match(/font-family: 'JetBrains Mono Nerd'/g) || []).length, 4);
});

test('terminal resize handle bounds touch/mouse drags and disposes gesture ownership', () => {
  const originals = Object.fromEntries(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const documentTarget = new EventTarget(), windowTarget = new EventTarget(), handle = new EventTarget();
  const classes = new Set(), properties = new Map(), attributes = new Map();
  let captured, available = 600;
  const drawer = { hidden: false,
    style: { setProperty(key, value) { properties.set(key, value); } },
    classList: { contains: key => classes.has(key), remove: key => classes.delete(key) },
    getBoundingClientRect: () => ({ height: parseFloat(properties.get('--fx-terminal-height') || '200') }),
    querySelector: () => handle,
  };
  handle.classList = { add: key => classes.add(key), remove: key => classes.delete(key) };
  handle.setAttribute = (key, value) => attributes.set(key, value);
  handle.setPointerCapture = id => { captured = id; };
  handle.hasPointerCapture = id => captured === id;
  handle.releasePointerCapture = () => { captured = undefined; };
  const root = { querySelector: () => ({ getBoundingClientRect: () => ({ height: available - drawer.getBoundingClientRect().height }) }) };
  globalThis.document = documentTarget; globalThis.window = windowTarget;
  const fire = (target, type, params = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, button: 0, clientY: 300, ...params });
    target.dispatchEvent(event);
    return event;
  };
  const binding = bindTerminalDrawerResize(root, drawer);
  try {
    classes.add('is-maximized');
    assert.equal(fire(handle, 'pointerdown').defaultPrevented, true);
    assert.equal(classes.has('is-maximized'), false);
    assert.equal(captured, 1);
    fire(documentTarget, 'pointermove', { clientY: 200 });
    assert.equal(properties.get('--fx-terminal-height'), '300px');
    fire(documentTarget, 'pointermove', { clientY: -1000 });
    assert.equal(properties.get('--fx-terminal-height'), '552px', 'reserve browser area and exclude fixed chrome');
    fire(documentTarget, 'pointermove', { pointerId: 2, clientY: 2000 });
    assert.equal(properties.get('--fx-terminal-height'), '552px', 'unrelated pointer cannot resize');
    fire(documentTarget, 'pointerup');
    assert.equal(captured, undefined);
    fire(handle, 'pointerdown', { pointerId: 5, pointerType: 'touch' });
    fire(documentTarget, 'pointermove', { pointerId: 5, clientY: 2000 });
    assert.equal(properties.get('--fx-terminal-height'), '160px');
    fire(documentTarget, 'pointercancel', { pointerId: 5 });
    assert.equal(classes.has('dragging'), false);
    fire(handle, 'keydown', { key: 'ArrowUp' });
    assert.equal(properties.get('--fx-terminal-height'), '176px');
    assert.equal(attributes.get('aria-valuenow'), '176');
    classes.add('is-minimized');
    assert.equal(fire(handle, 'pointerdown').defaultPrevented, false);
    classes.delete('is-minimized');
    fire(handle, 'pointerdown');
    binding.cancel(); // Tab switch/disconnect cancels a live gesture.
    fire(documentTarget, 'pointermove', { clientY: 0 });
    assert.equal(properties.get('--fx-terminal-height'), '176px');
    available = 120;
    fire(handle, 'keydown', { key: 'End' });
    assert.equal(properties.get('--fx-terminal-height'), '72px', 'small viewport does not force a 160px overflow');
    binding.dispose();
    assert.equal(fire(handle, 'pointerdown').defaultPrevented, false);
  } finally {
    binding.dispose();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test('mobile footer participates in layout below the exact two-row Terminal key dock', () => {
  const template = readFileSync(new URL('../app/apps/file_explorer/src/styles.css', import.meta.url), 'utf8');
  const markup = readFileSync(new URL('../app/apps/file_explorer/src/template.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../app/apps/file_explorer/terminal_drawer.ts', import.meta.url), 'utf8');
  const terminalTemplate = readFileSync(new URL('../app/apps/terminal/template.html', import.meta.url), 'utf8');
  const footerRule = template.match(/\.fx-mobile-footer \{([^}]+)\}/)[1];
  assert.match(footerRule, /flex: none/);
  assert.doesNotMatch(footerRule, /position: fixed/);
  assert.doesNotMatch(template, /padding-bottom: 90px/);
  assert.match(template, /\.fx-terminal-keys \{[^}]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
  // Footer is the final child of fx-app, not an overlay sibling.
  assert.match(markup, /<div class="fx-mobile-footer"[\s\S]*<\/div>\s*<\/div>\s*$/);
  const reference = [...terminalTemplate.matchAll(/<button id="k-[^"]+"[^>]*>([^<]+)<\/button>/g)]
    .map(match => match[1].replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))));
  const names = source.match(/for \(const name of \[([^\]]+)\]\)/)[1].match(/'([^']+)'/g).map(name => name.slice(1, -1));
  assert.deepEqual(names, ['escape', 'shift', 'dash', 'home', 'up', 'end', 'pageUp', 'tab', 'ctrl', 'alt', 'left', 'down', 'right', 'pageDown']);
  assert.equal(reference.length, names.length);
  assert.match(source, /bindPointerHoldRepeat\(button/);
  assert.match(source, /heldGeneration === generation/);
  assert.match(source, /bindTerminalShiftButton\(button, modifiers/);
  assert.match(template, /\.fx-app:has\(\.fx-terminal-drawer:not\(\[hidden\]\):not\(\.is-minimized\)\) \.fx-mobile-footer \{ display: none; \}/);
  assert.match(source, /keyToggle.hidden = !mobileKeys/);
});

test('input sends synchronously without ACK pacing or retained replay', () => {
  const sent = [], errors = [];
  let connected = true;
  const batcher = new TerminalInputBatcher(data => {
    if (!connected) throw new Error('disconnected');
    sent.push(data);
  }, error => errors.push(error));
  for (const key of ['a', 'b', '\\x1b[A', '\\x1b[A']) batcher.enqueue(key);
  assert.deepEqual(sent, ['a', 'b', '\\x1b[A', '\\x1b[A']);
  connected = false; batcher.enqueue('discard'); batcher.reset();
  connected = true; batcher.enqueue('fresh');
  assert.equal(errors.length, 1);
  assert.equal(sent.at(-1), 'fresh');
  assert.equal(sent.length, 5);
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
  const { packObject, unpackObject } = await import('../app/static/js/file_explorer_codec.js');
  class Element {
    hidden = false; textContent = ''; dataset = {}; handlers = new Map(); children = [];
    classList = { remove() {}, toggle() {} };
    addEventListener(name, handler) { this.handlers.set(name, handler); }
    removeEventListener(name) { this.handlers.delete(name); }
    get ownerDocument() { return globalThis.document; }
    setAttribute() {}
    append(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    querySelector(selector) { return elements.get(selector) || null; }
    querySelectorAll() { return []; }
  }
  const elements = new Map(['.fx-terminal-drawer', '.fx-terminal-viewport', '.fx-terminal-keys', '[data-terminal-status]',
    '[data-directory-status]', '[data-terminal="directory-lock"]', '[data-terminal="zoom-out"]', '[data-terminal="zoom-in"]', '[data-action="terminal"]', '[data-terminal="minimize"]', '[data-terminal="maximize"]', '[data-terminal="close"]'].map(name => [name, new Element()]));
  const views = [], calls = [], checkpoints = [], handlers = new Map(), errors = [];
  class View {
    cols = 80; rows = 24; writes = []; disposed = false;
    constructor(options) { this.options = options; views.push(this); }
    loadAddon() {} open() {} reset() { this.writes = []; } focus() {}
    write(data, done) { this.writes.push(data); if (done) queueMicrotask(done); }
    dispose() { this.disposed = true; }
    onData(callback) { this.input = callback; return { dispose() {} }; }
    onRender() { return { dispose() {} }; }
    attachCustomKeyEventHandler() {}
  }
  const originals = Object.fromEntries(['window', 'document', 'navigator', 'ResizeObserver', 'WebSocket', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const streams = [];
  globalThis.location = new URL('http://localhost/app/file_explorer');
  globalThis.WebSocket = class {
    static OPEN = 1;
    readyState = 1; bufferedAmount = 0; inputs = [];
    constructor(url) { assert.match(String(url), /\/ws\/app\/file_explorer\/terminal\?codec=msgpack-v1/); streams.push(this); queueMicrotask(() => this.onopen?.()); }
    send(raw) {
      assert.ok(raw instanceof Uint8Array);
      const frame = unpackObject(raw);
      if (frame.type === 'input') { this.inputs.push(frame); return; }
      checkpoints.push(value => this.frame({ type: 'checkpoint', tabId: 'tab', ...value }));
    }
    frame(value) { this.onmessage?.({ data: packObject(value).slice().buffer }); }
    close() { queueMicrotask(() => this.onclose?.()); }
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Desktop' } });
  globalThis.document = { addEventListener() {}, removeEventListener() {}, createElement: () => new Element(), head: { append(node) { if (node.onload === null) return; queueMicrotask(() => node.onload?.()); } } };
  globalThis.window = { Terminal: View, FitAddon: { FitAddon: class { fit() {} } },
    WebFontsAddon: { WebFontsAddon: class { async loadFonts() {} } },
    te2TerminalTouchSelection: { attach() { return { dispose() {} }; } },
    teUI: { dialog: { async confirm() { return true; } } } };
  let notifyResize;
  globalThis.ResizeObserver = class { constructor(callback) { notifyResize = callback; } observe() {} disconnect() {} };
  const tabs = { tab: { id: 'tab', shellId: 'shell' }, terminal(method, params) {
    calls.push([method, params]);
    if (method === 'terminal.stream') return Promise.resolve({ token: 'grant', shellId: 'shell' });
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
    checkpoints.shift()({ shellId: 'shell', ansi: 'A', outputOffset: 1, pendingBytes: new Uint8Array() });
    streams[0].frame({ type: 'output', ...chunk(0, [65]) }); // covered by checkpoint
    streams[0].frame({ type: 'output', ...chunk(1, [66]) }); // arrives during async xterm handoff
    await tick();
    assert.deepEqual(views[0].writes, ['A', new Uint8Array([66])]);
    let prevented = false;
    elements.get('[data-terminal="zoom-in"]').handlers.get('pointerdown')({ button: 0, preventDefault() { prevented = true; }, stopPropagation() {} });
    assert.equal(prevented, true);
    assert.equal(views[0].options.fontSize, 14);
    elements.get('[data-terminal="zoom-in"]').handlers.get('click')({ detail: 1 });
    assert.equal(views[0].options.fontSize, 14, 'pointer click must not apply twice');
    elements.get('[data-terminal="zoom-out"]').handlers.get('click')({ detail: 0 });
    assert.equal(views[0].options.fontSize, 13, 'keyboard activation is supported');
    for (let i = 0; i < 20; i++) notifyResize();
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.equal(streams.length, 1, 'identical layout observations must not reconnect');
    assert.deepEqual(views[0].writes, ['A', new Uint8Array([66])], 'zoom preserves the current screen');
    assert.equal(calls.filter(([method]) => method === 'terminal.resize').length, 1, 'unchanged dimensions need no resize request');
    views[0].cols = 90;
    notifyResize();
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.deepEqual(calls.at(-1), ['terminal.resize', { columns: 90, rows: 24 }]);
    assert.equal(streams.length, 1, 'real resize uses the existing control/output connection');
    assert.deepEqual(views[0].writes, ['A', new Uint8Array([66])], 'resize must not reset xterm or its checkpoint');
    await elements.get('[data-terminal="maximize"]').handlers.get('click')();
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.equal(streams.length, 1, 'maximize keeps the healthy stream');
    const lock = elements.get('[data-terminal="directory-lock"]');
    const tracking = elements.get('[data-directory-status]');
    assert.equal(lock.checked, true, 'directory tracking defaults on');
    handlers.get('terminal_directory')(packObject({ tabId: 'other', shellId: 'shell', directoryTracking: { state: 'pending', path: '/other' } }));
    assert.equal(tracking.textContent, '');
    handlers.get('terminal_directory')(packObject({ tabId: 'tab', shellId: 'shell', directoryTracking: { state: 'pending', path: '/next' } }));
    assert.match(tracking.textContent, /Waiting for terminal directory change/);
    tabs.tab.directoryLocked = false; drawer.sync(tabs.tab);
    assert.equal(lock.checked, false, 'peer snapshots update the checkbox');
    assert.equal(tracking.textContent, '', 'unlock clears pending UI feedback');
    lock.checked = true; lock.handlers.get('change')(); await tick();
    assert.deepEqual(calls.at(-1), ['terminal.directoryLock', { locked: true }]);
    assert.equal(lock.disabled, false);
    assert.equal(lock.checked, false, 'confirmed snapshot wins over optimistic checkbox');
    views[0].input('x');
    assert.equal(new TextDecoder().decode(streams[0].inputs[0].data), 'x');
    assert.equal(calls.some(([method]) => method === 'terminal.input'), false);
    handlers.get('disconnect')();
    assert.equal(views[0].disposed, true);
    drawer.sync(tabs.tab); await tick();
    assert.equal(views.length, 2, 'unchanged tab IDs still remount after disconnect');
    checkpoints.shift()({ shellId: 'shell', ansi: 'reconnected', outputOffset: 2 }); await tick();
    assert.deepEqual(views[1].writes, ['reconnected']);
    await elements.get('[data-terminal="minimize"]').handlers.get('click')();
    assert.equal(calls.some(([method]) => method === 'terminal.close'), false);
    await elements.get('[data-terminal="minimize"]').handlers.get('click')(); await tick();
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.equal(checkpoints.length, 0, 'restore keeps the healthy stream');
    assert.equal(streams.length, 2);
    handlers.get('terminal_reset')(packObject({ shellId: 'shell' })); await tick();
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
