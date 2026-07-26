import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');
let moduleSequence = 0;

async function importTypeScript(relativePath) {
  const result = await build({
    entryPoints: [path.join(appRoot, relativePath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
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
}

class FakeElement extends EventTarget {
  children = [];
  classList = new FakeClassList();
  className = '';
  disabled = false;
  textContent = '';
  title = '';

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  set innerHTML(value) {
    if (value === '') this.children.length = 0;
  }

  get innerHTML() {
    return '';
  }

  click() {
    this.dispatchEvent(new Event('click'));
  }
}

class FakeDocument {
  createElement() {
    return new FakeElement();
  }
}

class FakeCustomEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.detail = init.detail;
  }
}

class FakeWindow extends EventTarget {
  document = new FakeDocument();
  CustomEvent = FakeCustomEvent;
}

test('recents follows backend open-state projections and opens the selected file', async () => {
  const window = new FakeWindow();
  const previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    CustomEvent: globalThis.CustomEvent,
  };
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.CustomEvent = window.CustomEvent;

  try {
    const { createRecentsController } = await importTypeScript(
      'main_page/frontend/ui/recents.ts',
    );
    const button = window.document.createElement('button');
    const dropdown = window.document.createElement('div');
    const opened = [];
    const controller = createRecentsController({
      recentFilesBtn: button,
      recentFilesDD: dropdown,
      formatFileNameDisplay: (value) => value,
      openFile: async (filePath) => {
        opened.push(filePath);
      },
    });
    controller.installWindowHook();

    window.dispatchEvent(new window.CustomEvent('cm6:open-state-changed', {
      detail: {
        recents: [
          {
            path: '/workspace/new.ts',
            label: 'new.ts',
            opened_at: 'now',
            exists: true,
            scroll_line: null,
          },
          {
            path: '/workspace/old.ts',
            label: 'old.ts',
            opened_at: 'before',
            exists: true,
            scroll_line: 12,
          },
        ],
      },
    }));

    assert.equal(button.disabled, false);
    assert.deepEqual(
      Array.from(dropdown.children, (element) => element.title),
      ['/workspace/new.ts', '/workspace/old.ts'],
    );
    dropdown.children[0].click();
    await Promise.resolve();
    assert.deepEqual(opened, ['/workspace/new.ts']);

    window.dispatchEvent(new window.CustomEvent('cm6:open-state-changed', {
      detail: {
        recents: [
          {
            path: '/workspace/explorer.rs',
            label: 'explorer.rs',
            opened_at: 'later',
            exists: true,
            scroll_line: null,
          },
        ],
      },
    }));
    assert.equal(dropdown.children.length, 1);
    assert.equal(dropdown.children[0].title, '/workspace/explorer.rs');
  } finally {
    globalThis.window = previousGlobals.window;
    globalThis.document = previousGlobals.document;
    globalThis.CustomEvent = previousGlobals.CustomEvent;
  }
});
