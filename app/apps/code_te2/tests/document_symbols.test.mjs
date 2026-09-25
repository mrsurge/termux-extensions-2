import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
async function source(path) {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { documentSymbolTree } = await source('src/code-inspector/document-symbols.ts');
const { createCodeInspectorPanel } = await source('main_page/frontend/ui/code-inspector.ts');
const { ensureTouchSelection } = await source('monaco_editor/editor_touch_menu_utils.ts');
const range = { startLineNumber: 8, startColumn: 6, endLineNumber: 8, endColumn: 10 };
test('touch symbol action closes the menu and requests the inspector mode', () => {
  const win = new Window(); globalThis.window = win;
  let options, closed = false, mode;
  win['monaco-touch-selection'] = { editorTouchSelectionHelp(_editor, value) { options = value; } };
  const dom = win.document.createElement('div');
  ensureTouchSelection('test', { getEditor: () => ({ getDomNode: () => dom }), inspectCode: value => { mode = value; }, updateDebug() {} });
  const tool = options.navigationTools({ closeMenu() { closed = true; } }).find(item => item.name === 'document symbols');
  assert.match(tool.innerHTML, /<svg/); tool.action();
  assert.equal(closed, true); assert.equal(mode, 'symbols');
  win.happyDOM.abort();
});
test('symbol normalization bounds malformed/huge trees and preserves source positions', () => {
  assert.equal(documentSymbolTree([{ name: 'bad' }], '/file').count, 0);
  const result = documentSymbolTree(Array.from({ length: 2001 }, () => ({ name: 'x', range })), '/file');
  assert.equal(result.count, 2000); assert.equal(result.truncated, true);
  const cyclic = { name: 'x', range }; cyclic.children = [cyclic];
  assert.equal(documentSymbolTree([cyclic], '/file').count, 32);
});
test('symbol row navigates without reloading; twisty independently expands children', () => {
  const win = new Window();
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, CustomEvent: win.CustomEvent });
  const ids = ['container', 'header', 'target', 'target-symbol', 'target-path', 'target-separator', 'direction', 'summary', 'tree', 'empty', 'clear-highlights', 'collapse'];
  for (const id of ids) { const el = document.createElement('div'); el.id = `code-inspector-${id}`; document.body.append(el); }
  const opens = [];
  const panel = createCodeInspectorPanel({ openDrawer() {}, closeDrawer() {}, requestCommand: async () => {}, openFile: async (...args) => opens.push(args) });
  try {
    const data = documentSymbolTree([{ name: 'Parent', kind: 4, range, children: [{ name: 'child', kind: 5, range }] }], '/workspace/file.py');
    panel.hydrate({ requestId: 'symbols1', status: 'ready', mode: 'symbols', target: { path: '/workspace/file.py' }, summary: { label: 'Document symbols', count: 2 }, tree: data.tree });
    const row = document.querySelector('.code-inspector-row');
    assert.ok(row.querySelector('.codicon-symbol-class'));
    row.querySelector('.code-inspector-twisty').click();
    assert.equal(opens.length, 0); assert.equal(document.querySelectorAll('.code-inspector-row').length, 2);
    document.querySelectorAll('.code-inspector-row')[1].click();
    assert.deepEqual(opens[0], ['/workspace/file.py', {
      forceRefresh: false,
      line: 8,
      column: 6,
      focus: false,
      scrollY: 'center',
      placeCursor: true,
      symbolRange: range,
    }]);
  } finally { panel.destroy(); win.happyDOM.abort(); }
});
