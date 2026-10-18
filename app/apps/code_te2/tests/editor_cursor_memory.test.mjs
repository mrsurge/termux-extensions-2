import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({ stdin: { contents: `
  export { runEditorOpenTransaction } from './monaco_editor/editor_open_transaction_runner_main.ts';
  export { rememberOpenCursor, restoreOpenCursor } from './monaco_editor/editor_cursor_memory.ts';
  export { createEditorOpenTransactionStore } from './monaco_editor/editor_open_transaction_state.ts';
  export { resetDocumentRevisionRuntime } from './monaco_editor/editor_document_revision_runtime.ts';
  export { applyJumpToLine } from './monaco_editor/editor_jump_utils.ts';
  export { coercePositiveInt } from './monaco_editor/editor_open_contract.ts';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const runtime = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

function harness(userAgent) {
  runtime.resetDocumentRevisionRuntime();
  let path = null, model = null, position = { lineNumber: 1, column: 1 }, scroll = 0, focuses = 0;
  const store = runtime.createEditorOpenTransactionStore();
  const editor = {
    getPosition: () => position, setPosition: value => { position = value; },
    getModel: () => model, setModel: value => { model = value; position = { lineNumber: 1, column: 1 }; },
    focus: () => { focuses++; }, getScrollTop: () => scroll, setScrollTop: value => { scroll = value; },
    getTopForLineNumber: value => value * 10,
    revealLineNearTop: value => { scroll = value * 10; },
  };
  const values = {
    getWindow: () => ({ monaco: {}, navigator: { userAgent } }),
    getCurrentPath: () => path, setCurrentPath: value => { path = value; },
    getModel: () => model, setModel: value => { model = value; },
    getEditor: () => editor, getDiffEditor: () => null,
    openTransactionStore: store, coercePositiveInt: runtime.coercePositiveInt,
    prepareTextmateForDocument: async () => 'plaintext', languageFromPath: () => 'plaintext',
    monacoFileUri: (_monaco, value) => ({ toString: () => value }), absPathFromVscodeUri: value => value,
    createFileModel: (content, _language, value) => ({ uri: { toString: () => value }, getValue: () => content,
      getLineCount: () => 100, getLineMaxColumn: () => 80, dispose() {} }),
    applyJumpToLine: runtime.applyJumpToLine,
    openFileFlow: async () => {}, requestAgentEditDocumentState: async () => {},
    wbBumpGeneration: () => 1, wbCurrentGeneration: () => 1,
  };
  const deps = new Proxy(values, { get: (target, key) => key in target ? target[key] : () => undefined });
  return { editor, store, position: () => position, scroll: () => scroll, focuses: () => focuses,
    open: (target, extra = {}) => runtime.runEditorOpenTransaction(deps, { path: target, content: '', document_revision: 1, ...extra }),
  };
}

test('desktop opens restore per-file cursor without overriding viewport or explicit navigation', async t => {
  t.mock.method(console, 'log', () => {});
  const h = harness('Desktop');
  await h.open('/project/A', { scroll_line: 10 });
  assert.deepEqual(h.position(), { lineNumber: 10, column: 1 });
  h.editor.setPosition({ lineNumber: 35, column: 7 });
  await h.open('/project/B', { scroll_line: 20 });
  h.editor.setPosition({ lineNumber: 62, column: 9 });
  await h.open('/project/A', { scroll_line: 30 });
  assert.deepEqual(h.position(), { lineNumber: 35, column: 7 });
  assert.equal(h.scroll(), 300);
  await h.open('/project/B', { line: 8, column: 4 });
  assert.deepEqual(h.position(), { lineNumber: 8, column: 4 });
  h.editor.setPosition({ lineNumber: 9, column: 5 });
  await h.open('/project/B', { focus: true });
  assert.deepEqual(h.position(), { lineNumber: 9, column: 5 });
});

test('mobile touch opens keep cursor unfocused; keyboard focus intent restores remembered cursor', async t => {
  t.mock.method(console, 'log', () => {});
  const h = harness('Android Mobile');
  await h.open('/project/A', { scroll_line: 10, focus: false });
  assert.deepEqual(h.position(), { lineNumber: 1, column: 1 });
  assert.equal(h.focuses(), 0);
  h.editor.setPosition({ lineNumber: 45, column: 11 });
  await h.open('/project/B', { scroll_line: 20, focus: false });
  await h.open('/project/A', { scroll_line: 40, focus: true, place_cursor: true });
  assert.deepEqual(h.position(), { lineNumber: 45, column: 11 });
  assert.equal(h.scroll(), 400); assert.equal(h.focuses(), 1);
});

test('cursor memory is bounded and client-scoped; restoration clamps changed models', () => {
  const first = runtime.createEditorOpenTransactionStore(), second = runtime.createEditorOpenTransactionStore();
  for (let i = 0; i < 101; i++) runtime.rememberOpenCursor(first, `/file/${i}`, { lineNumber: 50, column: 30 });
  let position;
  const editor = { setPosition: value => { position = value; } };
  const model = { getLineCount: () => 12, getLineMaxColumn: () => 4 };
  runtime.restoreOpenCursor(first, '/file/100', editor, model, 2);
  assert.deepEqual(position, { lineNumber: 12, column: 4 });
  runtime.restoreOpenCursor(second, '/file/100', editor, model, 2);
  assert.deepEqual(position, { lineNumber: 2, column: 1 });
  runtime.restoreOpenCursor(first, '/file/0', editor, model, 3);
  assert.deepEqual(position, { lineNumber: 3, column: 1 });
});
