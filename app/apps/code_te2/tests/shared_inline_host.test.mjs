import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// Exercise the real host admission/assets/DOM wiring with a boundary runtime
// double. Provider/model/input implementations have their own paired-mount tests.
async function fixture() {
  const result = await build({ stdin: { contents: `
    export * from './monaco_editor/inline_host.ts';
    export { records } from './monaco_editor/m_editor_app.ts';
  `, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'esm',
    plugins: [{ name: 'runtime-boundary', setup(b) {
      b.onLoad({ filter: /m_editor_app\.ts$/ }, () => ({ loader: 'js', contents: `
        export const records = [];
        export function startWorkingEditorRuntime(options) {
          const record = { options, disposed: false, disposeCalls: 0 };
          records.push(record);
          const dispose = () => {
            if (record.disposed) return;
            record.disposed = true; record.disposeCalls++;
            options.signal.removeEventListener('abort', dispose);
          };
          options.signal.addEventListener('abort', dispose, { once: true });
          return { dispose, ready: options.bootSnapshot?.fail
            ? Promise.reject(new Error('fixture boot failure')) : Promise.resolve() };
        }
      ` }));
    } }],
  });
  const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
  const win = new Window({ url: 'http://localhost/' });
  const keys = ['window', 'document', 'HTMLElement', 'HTMLStyleElement', 'HTMLScriptElement'];
  const saved = new Map(keys.map(key => [key, globalThis[key]]));
  for (const key of keys) globalThis[key] = key === 'window' ? win : key === 'document' ? win.document : win[key];
  const script = win.document.createElement('script'); script.id = 'fe-inline-monaco-touch-selection-js';
  script.dataset.loaded = 'true'; win.document.head.append(script);
  return { api, win, root() { const root = win.document.createElement('section'); win.document.body.append(root); return root; },
    close() { for (const [key, value] of saved) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } win.happyDOM.abort(); },
  };
}
const primary = { clientInstanceId: 'client_aaaaaaaaaaaa', clientRole: 'primary' };
const secondary = { clientInstanceId: 'client_bbbbbbbbbbbb', mainPageClientInstanceId: primary.clientInstanceId, clientRole: 'secondary' };

test('one document hosts independent editor roots with shared assets and pinned identities', async () => {
  const f = await fixture();
  try {
    const a = f.root(), b = f.root();
    const first = f.api.bootInlineEditorHost(a, { rendererIdentity: primary });
    const alias = f.win.__te2InlineMonacoBoot;
    const second = f.api.bootInlineEditorHost(b, { rendererIdentity: secondary });
    await Promise.all([first, second]);
    assert.equal(f.win.__te2InlineMonacoBoot, alias);
    assert.equal(f.api.records.length, 2);
    assert.notEqual(f.api.records[0].options.mount.editor, f.api.records[1].options.mount.editor);
    assert.deepEqual(f.api.records.map(record => record.options.editorRole), ['primary', 'secondary']);
    assert.equal(f.win.document.querySelectorAll('#fe-inline-monaco-host-style').length, 1);
    assert.equal(f.win.document.querySelectorAll('[data-te2-working-editor-host]').length, 2);
    assert.doesNotMatch(f.win.document.querySelector('#fe-inline-monaco-host-style').textContent, /#editor-frame/);
    const duplicate = f.root(); duplicate.textContent = 'untouched';
    await assert.rejects(f.api.bootInlineEditorHost(duplicate, { rendererIdentity: secondary }), /already mounted/);
    assert.equal(duplicate.textContent, 'untouched');
    await f.api.mountInlineEditorHost(a, { rendererIdentity: primary });
    assert.equal(f.api.records.length, 2);
    f.api.disposeInlineEditorHost(b); f.api.disposeInlineEditorHost(b);
    assert.equal(f.api.records[1].disposeCalls, 1); assert.equal(b.children.length, 0);
    assert.equal(f.api.records[0].disposed, false); assert.ok(a.children.length);
    const replacement = f.root();
    await f.api.mountInlineEditorHost(replacement, { rendererIdentity: secondary });
    assert.equal(f.api.records.length, 3);
    f.api.disposeInlineEditorHost(a); f.api.disposeInlineEditorHost(replacement);
  } finally { f.close(); }
});

test('asset-wait cancellation and runtime boot failure cannot mutate a surviving root', async () => {
  const f = await fixture();
  try {
    const a = f.root(), b = f.root();
    await f.api.bootInlineEditorHost(a, { rendererIdentity: primary });
    let resume;
    const wait = new Promise(resolve => { resume = resolve; });
    const pending = f.api.bootInlineEditorHost(b, { rendererIdentity: secondary, ensureSocketIoLoaded: () => wait });
    await Promise.resolve(); f.api.disposeInlineEditorHost(b);
    await assert.rejects(pending, /disposed/); resume(); await wait; await Promise.resolve();
    assert.equal(b.children.length, 0); assert.equal(f.api.records.length, 1);
    const failed = f.root();
    await assert.rejects(f.api.mountInlineEditorHost(failed, { rendererIdentity: secondary, bootSnapshot: { fail: true } }), /fixture boot failure/);
    assert.equal(f.api.records[1].disposeCalls, 1); assert.equal(f.api.records[0].disposed, false);
    assert.ok(a.children.length); f.api.disposeInlineEditorHost(a); f.api.disposeInlineEditorHost(failed);
  } finally { f.close(); }
});
