import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

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
