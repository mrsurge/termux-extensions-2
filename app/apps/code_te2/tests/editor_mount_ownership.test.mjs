import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const result = await build({ stdin: { contents: `
  export * from './monaco_editor/editor_mount.ts';
  export * from './monaco_editor/editor_ui_editor_runtime.ts';
  export * from './monaco_editor/editor_debug_runtime.ts';
  export * from './monaco_editor/editor_breadcrumb_runtime.ts';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'test-icons', setup(b) {
    b.onResolve({ filter: /^\/static\/js\/file_icons\.js$/ }, () => ({ path: 'icons', namespace: 'test-icons' }));
    b.onLoad({ filter: /.*/, namespace: 'test-icons' }, () => ({ contents: 'export function renderIcon() { return ""; }', loader: 'js' }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

function host(win) {
  const root = win.document.createElement('section');
  root.setAttribute('data-te2-working-editor-host', '');
  root.innerHTML = '<div data-te2-editor-part="breadcrumbs"></div><div data-te2-editor-part="editor"></div><pre data-te2-editor-part="debug"></pre>';
  win.document.body.append(root);
  return root;
}

function installGlobals(win) {
  const previous = new Map(['window', 'HTMLElement'].map(key => [key, globalThis[key]]));
  globalThis.window = win; globalThis.HTMLElement = win.HTMLElement;
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  };
}

test('mounts resolve their own parts and reject missing parts instead of borrowing nested editors', () => {
  const win = new Window();
  try {
    const first = host(win), second = host(win);
    const a = api.resolveWorkingEditorMount(first), b = api.resolveWorkingEditorMount(second);
    assert.notEqual(a.editor, b.editor); assert.notEqual(a.breadcrumbs, b.breadcrumbs);
    assert.equal(a.editor.parentElement, first); assert.equal(b.editor.parentElement, second);
    first.querySelector('[data-te2-editor-part="editor"]').remove();
    first.append(second);
    assert.throws(() => api.resolveWorkingEditorMount(first), /requires its own/);
    assert.equal(api.resolveWorkingEditorMount(second).editor, b.editor);
    const unmarked = win.document.createElement('div');
    assert.throws(() => api.resolveWorkingEditorMount(unmarked), /host marker/);
  } finally { win.happyDOM.abort(); }
});

test('layout observes only its explicit mount and debug updates never target the other editor', () => {
  const win = new Window();
  const restore = installGlobals(win);
  try {
    const a = api.resolveWorkingEditorMount(host(win)), b = api.resolveWorkingEditorMount(host(win));
    const observed = [];
    win.ResizeObserver = class { observe(element) { observed.push(element); } disconnect() {} };
    const ui = mount => api.createEditorUiEditorRuntime({
      getWindow: () => win, getDocument: () => win.document,
      getEditorContainer: () => mount.editor, getEditor: () => null, getDiffEditor: () => null,
    });
    const first = ui(a), second = ui(b);
    first.ensureLayoutObserver(); second.ensureLayoutObserver();
    assert.deepEqual(observed, [a.editor, b.editor]);
    const debug = mount => api.createEditorDebugRuntime({ getDebugElement: () => mount.debug, getEditor: () => null });
    const ad = debug(a), bd = debug(b);
    ad.updateDebug('primary-only'); const previous = a.debug.textContent;
    bd.updateDebug('secondary-only');
    assert.match(previous, /primary-only/);
    assert.equal(a.debug.textContent, previous);
    assert.match(b.debug.textContent, /secondary-only/);
    first.dispose(); second.dispose();
  } finally { restore(); win.happyDOM.abort(); }
});

test('breadcrumb rendering and path intents remain bound to the originating mount', async t => {
  t.mock.method(console, 'warn', () => {}); // Dynamic browser-only icon import is absent in Node.
  const win = new Window();
  const restore = installGlobals(win);
  try {
    const a = api.resolveWorkingEditorMount(host(win)), b = api.resolveWorkingEditorMount(host(win));
    const calls = [];
    const breadcrumb = (mount, path, name) => api.createEditorBreadcrumbRuntime({
      getDocument: () => win.document, getBreadcrumbElement: () => mount.breadcrumbs,
      getEditor: () => null, getModel: () => null, getCurrentPath: () => path,
      notifyEditorRpc: (method, payload) => { calls.push({ name, method, payload }); return true; },
    });
    const first = breadcrumb(a, '/project/first.ts', 'primary');
    const second = breadcrumb(b, '/other/second.ts', 'secondary');
    first.init(); second.init(); first.updatePath('/project/first.ts', true); second.updatePath('/other/second.ts', true);
    assert.match(a.breadcrumbs.textContent, /first.ts/); assert.doesNotMatch(a.breadcrumbs.textContent, /second.ts/);
    assert.match(b.breadcrumbs.textContent, /second.ts/); assert.doesNotMatch(b.breadcrumbs.textContent, /first.ts/);
    b.breadcrumbs.querySelector('.te2-bc-item').click();
    assert.equal(calls.length, 1); assert.equal(calls[0].name, 'secondary');
    await new Promise(resolve => setImmediate(resolve));
  } finally { restore(); win.happyDOM.abort(); }
});

test('production boot passes explicit parts and no longer creates or resolves fixed inner IDs', async () => {
  const hostSource = await readFile('monaco_editor/inline_host.ts', 'utf8');
  assert.match(hostSource, /mount: resolveWorkingEditorMount\(editorFrame\)/);
  assert.doesNotMatch(hostSource, /id="(?:fh-monaco|te2-breadcrumbs)"/);
  for (const path of ['editor_ui_editor_runtime', 'editor_breadcrumb_runtime', 'editor_debug_runtime']) {
    assert.doesNotMatch(await readFile(`monaco_editor/${path}.ts`, 'utf8'), /getElementById\(/);
  }
});
