import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('installer card requires a second explicit confirmation and exposes progress Cancel', async () => {
  const source = await readFile(new URL('../desktop_client/android_shell/extensions/local-framework.js', import.meta.url), 'utf8');
  const {localFrameworkExtension} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const previous = {document: globalThis.document, window: globalThis.window, CustomEvent: globalThis.CustomEvent};
  class Element {
    children = []; listeners = {}; dataset = {};
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(name, listener) { this.listeners[name] = listener; }
  }
  const descendants = element => [element, ...element.children.flatMap(descendants)];
  globalThis.document = {createElement: () => new Element()};
  globalThis.window = {dispatchEvent() {}}; globalThis.CustomEvent = class {};
  let installs = 0, cancels = 0;
  const initial = {supported: true, phase: 'unavailable', canInstall: true, commandDetected: false};
  const running = {...initial, canInstall: false, installation: {phase: 'running', output: 'Installing dependencies'}};
  try {
    const root = new Element();
    const mounted = localFrameworkExtension.mount(root, {
      getLocalFrameworkState: async () => initial, onLocalFrameworkState: () => () => {},
      installLocalFramework: async () => { installs++; return running; },
      cancelLocalFrameworkInstall: async () => { cancels++; return initial; },
      toast: error => assert.fail(error),
    });
    await Promise.resolve();
    descendants(root).find(el => el.textContent === 'Install TE2').listeners.click();
    assert.equal(installs, 0);
    assert.ok(descendants(root).some(el => el.textContent?.includes('partial changes')));
    descendants(root).find(el => el.textContent === 'Confirm Install').listeners.click();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(installs, 1);
    assert.ok(descendants(root).some(el => el.textContent === 'Installing dependencies'));
    descendants(root).find(el => el.textContent === 'Cancel').listeners.click();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(cancels, 1); mounted.dispose();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('mobile pending launch shows progress and allows Cancel while Start is busy', async () => {
  const source = await readFile(new URL('../desktop_client/android_shell/extensions/local-framework.js', import.meta.url), 'utf8');
  const {localFrameworkExtension} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const previous = {document: globalThis.document, window: globalThis.window, CustomEvent: globalThis.CustomEvent};
  class Element {
    children = []; listeners = {}; dataset = {};
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(name, listener) { this.listeners[name] = listener; }
  }
  const descendants = element => [element, ...element.children.flatMap(descendants)];
  let listener, stops = 0;
  const pending = {supported: true, phase: 'starting', ownership: 'electron',
    commandDetected: true, command: '/bin/te2', localOrigin: 'http://127.0.0.1:8089',
    operationPending: true, cancellableStartup: true, startupOutput: 'Compiling source'};
  globalThis.document = {createElement: () => new Element()};
  globalThis.window = {dispatchEvent() {}};
  globalThis.CustomEvent = class {};
  try {
    const root = new Element();
    const mounted = localFrameworkExtension.mount(root, {
      getLocalFrameworkState: async () => pending,
      onLocalFrameworkState: callback => { listener = callback; return () => {}; },
      stopLocalFramework: async () => { stops++; return {...pending, phase: 'exited', operationPending: false, cancellableStartup: false}; },
      toast: error => { throw new Error(error); },
    });
    await Promise.resolve();
    assert.ok(descendants(root).some(el => el.textContent === 'Compiling source'));
    const cancel = descendants(root).find(el => el.textContent === 'Cancel');
    assert.equal(cancel.disabled, false);
    assert.equal(descendants(root).find(el => el.textContent === 'Starting').disabled, true);
    cancel.listeners.click();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(stops, 1);
    listener({...pending, cancellableStartup: false, startupOutput: undefined});
    assert.ok(!descendants(root).some(el => el.textContent === 'Cancel'), 'Desktop state does not opt into mobile Cancel');
    mounted.dispose();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('failed state read keeps a visible reconnect card without replaying Start', async () => {
  const source = await readFile(new URL('../desktop_client/android_shell/extensions/local-framework.js', import.meta.url), 'utf8');
  const {localFrameworkExtension} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const previous = globalThis.document;
  class Element {
    children = []; listeners = {}; dataset = {};
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(name, listener) { this.listeners[name] = listener; }
  }
  const descendants = element => [element, ...element.children.flatMap(descendants)];
  let reads = 0, starts = 0;
  globalThis.document = {createElement: () => new Element()};
  try {
    const root = new Element();
    const mounted = localFrameworkExtension.mount(root, {
      getLocalFrameworkState: async () => { reads++; throw new Error('Connection refused'); },
      onLocalFrameworkState: () => () => {},
      startLocalFramework: async () => { starts++; },
    });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(root.hidden, false);
    assert.ok(descendants(root).some(el => el.textContent === 'Connection refused'));
    descendants(root).find(el => el.textContent === 'Reconnect').listeners.click();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(reads, 2); assert.equal(starts, 0);
    mounted.dispose();
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});
