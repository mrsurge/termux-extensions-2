import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');
let moduleSequence = 0;

async function importFileTabs() {
  const result = await build({
    entryPoints: [path.join(appRoot, 'main_page/frontend/ui/file-tabs.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
    plugins: [{
      name: 'seti-icons-test-double',
      setup(buildApi) {
        buildApi.onResolve(
          { filter: /^\/static\/vendor\/seti-icons\/seti-icons\.js$/ },
          () => ({ path: 'seti-icons', namespace: 'test-double' }),
        );
        buildApi.onLoad(
          { filter: /.*/, namespace: 'test-double' },
          () => ({
            contents: 'export async function getIcon(name) { return { svg: `<svg data-file="${name}"></svg>`, color: "#abc" }; }',
            loader: 'js',
          }),
        );
      },
    }],
  });
  const source = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleSequence++}`;
  return import(url);
}

class FakeClassList {
  values = new Set();

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}

class FakeElement extends EventTarget {
  attributes = new Map();
  children = [];
  classList = new FakeClassList();
  className = '';
  dataset = {};
  disabled = false;
  innerHTML = '';
  isConnected = true;
  parentElement = null;
  scrollLeft = 0;
  style = {};
  tabIndex = 0;
  textContent = '';
  title = '';

  append(...children) {
    children.forEach((child) => {
      child.parentElement = this;
      this.children.push(child);
    });
  }

  appendChild(child) {
    this.append(child);
    return child;
  }

  closest(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : '';
    let current = this;
    while (current) {
      const declaredClasses = String(current.className || '').split(/\s+/);
      if (
        className
        && (
          declaredClasses.includes(className)
          || current.classList.values.has(className)
        )
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  querySelectorAll(selector) {
    if (selector !== '.fe-file-tab[data-path]') return [];
    return this.children.filter((child) => child.dataset?.path);
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  click() {
    this.dispatchEvent(new Event('click'));
  }
}

class FakeDocument extends EventTarget {
  createElement() {
    return new FakeElement();
  }

  elementFromPoint() {
    return null;
  }
}

class FakeCustomEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.detail = init.detail;
  }
}

function installDom() {
  const previous = {
    CustomEvent: globalThis.CustomEvent,
    document: globalThis.document,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    localStorage: globalThis.localStorage,
    window: globalThis.window,
  };
  const values = new Map();
  const document = new FakeDocument();
  const window = new EventTarget();
  window.document = document;
  window.CustomEvent = FakeCustomEvent;
  globalThis.CustomEvent = FakeCustomEvent;
  globalThis.document = document;
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  globalThis.window = window;
  return {
    restore() {
      Object.assign(globalThis, previous);
    },
    values,
  };
}

test('file tab order retains local members and appends new backend entries', async () => {
  const { mergeFileTabOrder, chooseFileTabCloseSuccessor } = await importFileTabs();
  assert.deepEqual(
    mergeFileTabOrder(['/a', '/b', '/c'], ['/c', '/missing', '/a']),
    ['/c', '/a', '/b'],
  );
  assert.equal(chooseFileTabCloseSuccessor(['/a', '/b', '/c'], '/b'), '/c');
  assert.equal(chooseFileTabCloseSuccessor(['/a', '/b'], '/b'), '/a');
  assert.equal(chooseFileTabCloseSuccessor(['/a'], '/a'), null);
});

test('file tabs render bounded decorations and active close opens its successor', async () => {
  const dom = installDom();
  try {
    const { createFileTabsController, fileTabOrderStorageKey } = await importFileTabs();
    const viewport = new FakeElement();
    const track = new FakeElement();
    const opened = [];
    const closed = [];
    let resets = 0;
    const controller = createFileTabsController({
      viewport,
      track,
      formatFileNameDisplay: (value) => value,
      openFile: async (filePath) => opened.push(filePath),
      closeRecentFile: async (filePath) => closed.push(filePath),
      resetToNewFile: () => { resets += 1; },
    });

    controller.broadcastOpenState({
      projectPath: '/workspace',
      openFile: '/workspace/a.rs',
      recents: [
        { path: '/workspace/a.rs', label: 'a.rs', exists: true },
        { path: '/workspace/b.go', label: 'b.go', exists: true },
      ],
    });
    controller.refreshDecorations({
      projectPath: '/workspace',
      items: [{
        path: '/workspace/a.rs',
        gitStatus: 'modified',
        hasDraft: true,
        diagnostics: { errors: 1, warnings: 0 },
      }],
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(track.children.length, 2);
    assert.equal(track.children[0].attributes.get('aria-selected'), 'true');
    assert.equal(track.children[0].classList.values.has('fe-git-modified'), true);
    assert.equal(track.children[0].classList.values.has('fe-draft'), true);
    assert.match(track.children[0].children[0].innerHTML, /data-file="a\.rs"/);
    assert.deepEqual(
      JSON.parse(dom.values.get(fileTabOrderStorageKey('/workspace'))),
      ['/workspace/a.rs', '/workspace/b.go'],
    );

    track.children[0].children[3].click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(opened, ['/workspace/b.go']);
    assert.deepEqual(closed, ['/workspace/a.rs']);
    assert.equal(resets, 0);
  } finally {
    dom.restore();
  }
});

test('wheel input scrolls the file tab viewport horizontally', async () => {
  const dom = installDom();
  try {
    const { createFileTabsController } = await importFileTabs();
    const viewport = new FakeElement();
    const controller = createFileTabsController({
      viewport,
      track: new FakeElement(),
      formatFileNameDisplay: (value) => value,
      openFile: async () => {},
      closeRecentFile: async () => {},
      resetToNewFile: () => {},
    });
    controller.installWindowHooks();
    const wheel = new Event('wheel', { cancelable: true });
    Object.defineProperties(wheel, {
      deltaX: { value: 0 },
      deltaY: { value: 48 },
    });
    viewport.dispatchEvent(wheel);
    assert.equal(viewport.scrollLeft, 48);
    assert.equal(wheel.defaultPrevented, true);
  } finally {
    dom.restore();
  }
});

test('stationary desktop pointer gesture opens a file tab instead of starting reorder', async () => {
  const dom = installDom();
  try {
    const { createFileTabsController } = await importFileTabs();
    const viewport = new FakeElement();
    const track = new FakeElement();
    const opened = [];
    const controller = createFileTabsController({
      viewport,
      track,
      formatFileNameDisplay: (value) => value,
      openFile: async (filePath) => opened.push(filePath),
      closeRecentFile: async () => {},
      resetToNewFile: () => {},
    });
    controller.broadcastOpenState({
      projectPath: '/workspace',
      openFile: '/workspace/a.rs',
      recents: [
        { path: '/workspace/a.rs', label: 'a.rs', exists: true },
        { path: '/workspace/b.go', label: 'b.go', exists: true },
      ],
    });
    controller.installWindowHooks();

    const tab = track.children[1];
    const pointerDown = new Event('pointerdown');
    Object.defineProperties(pointerDown, {
      target: { configurable: true, get: () => tab },
      pointerId: { value: 7 },
      pointerType: { value: 'mouse' },
      clientX: { value: 50 },
      clientY: { value: 12 },
    });
    track.dispatchEvent(pointerDown);

    const pointerUp = new Event('pointerup');
    Object.defineProperties(pointerUp, {
      pointerId: { value: 7 },
      pointerType: { value: 'mouse' },
      clientX: { value: 50 },
      clientY: { value: 12 },
    });
    globalThis.document.dispatchEvent(pointerUp);
    tab.click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(opened, ['/workspace/b.go']);

    const draggedTab = track.children[0];
    const dragDown = new Event('pointerdown');
    Object.defineProperties(dragDown, {
      target: { configurable: true, get: () => draggedTab },
      pointerId: { value: 8 },
      pointerType: { value: 'mouse' },
      clientX: { value: 20 },
      clientY: { value: 12 },
    });
    track.dispatchEvent(dragDown);

    const dragMove = new Event('pointermove', { cancelable: true });
    Object.defineProperties(dragMove, {
      pointerId: { value: 8 },
      pointerType: { value: 'mouse' },
      clientX: { value: 30 },
      clientY: { value: 12 },
    });
    globalThis.document.dispatchEvent(dragMove);

    const dragUp = new Event('pointerup');
    Object.defineProperties(dragUp, {
      pointerId: { value: 8 },
      pointerType: { value: 'mouse' },
      clientX: { value: 30 },
      clientY: { value: 12 },
    });
    globalThis.document.dispatchEvent(dragUp);
    draggedTab.click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(opened, ['/workspace/b.go']);
  } finally {
    dom.restore();
  }
});
