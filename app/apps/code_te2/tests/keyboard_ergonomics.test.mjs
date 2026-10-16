import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
}
function dom() {
  const win = new Window();
  for (const name of ['document', 'Element', 'HTMLElement', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'MutationObserver']) globalThis[name] = win[name];
  globalThis.window = win;
  return win;
}
async function providers() {
  const source = await readFile('../../../scripts/monaco_quick_access.mjs', 'utf8');
  const registry = { goto: { prefix: ':' }, getQuickAccessProvider() { return this.goto; }, registerQuickAccessProvider(provider) { this.root = provider; } };
  class Help {
    constructor(service) { this.quickInputService = service; }
    getQuickAccessProviders() { return [{ prefix: ':', label: ':', description: 'Go to Line' }, { prefix: '>', label: '>', description: 'Commands' }]; }
  }
  Help.$di$dependencies = [{ index: 0 }];
  class Goto { parsePosition(_editor, value) { return { absolute: value }; } }
  Goto.$di$dependencies = [{ index: 0 }, { index: 1 }];
  const context = vm.createContext({ Registry: { as: () => registry }, Extensions: { Quickaccess: 'quick' }, HelpQuickAccessProvider: Help,
    StandaloneGotoLineQuickAccessProvider: Goto, DisposableStore: class { add() {} }, window, CustomEvent, Number });
  vm.runInContext(source.replace(/^import .*;$/gm, '').replace(/^export /gm, '') + '\ninstallTe2QuickAccess();', context);
  return registry;
}

test('relative jumps preserve absolute syntax, clamp logical lines/columns and reject incomplete directions', async () => {
  const win = dom();
  try {
    const registry = await providers();
    assert.equal(registry.goto.ctor.$di$dependencies.length, 2);
    assert.equal(registry.root.ctor.$di$dependencies.length, 1);
    const provider = new registry.goto.ctor();
    const editor = { getModel: () => ({ getLineCount: () => 30, getLineMaxColumn: () => 12 }), getPosition: () => ({ lineNumber: 20 }) };
    for (const [input, line, column] of [['8:k', 12, 1], ['8j:4', 28, 4], ['99:j:100', 30, 12], ['99:k:0', 1, 1]]) {
      const result = provider.parsePosition(editor, input);
      assert.equal(result.lineNumber, line); assert.equal(result.column, column);
    }
    assert.equal(provider.parsePosition(editor, '8:k:').lineNumber, undefined);
    assert.equal(provider.parsePosition(editor, '8:4').absolute, '8:4');
    assert.equal(provider.parsePosition(editor, ':25').absolute, ':25');
  } finally { win.happyDOM.abort(); }
});

test('root rn/e entries filter, show toggle state and activate only on accept', async () => {
  const win = dom();
  try {
    window.addEventListener('code-te2:relative-numbers-query', event => { event.detail.enabled = true; });
    const events = [];
    window.addEventListener('code-te2:palette-action', event => events.push(event.detail));
    const registry = await providers();
    const shown = [];
    const provider = new registry.root.ctor({ quickAccess: { show: prefix => shown.push(prefix) } });
    let accept, change;
    const picker = { value: '', selectedItems: [], hide() {}, onDidChangeValue(fn) { change = fn; }, onDidAccept(fn) { accept = fn; } };
    provider.provide(picker);
    assert.deepEqual(Array.from(picker.items, item => item.label), [':', '>', 'rn', 'e']);
    assert.match(picker.items.find(item => item.label === 'rn').description, /On/);
    picker.value = 'rn'; change();
    assert.equal(picker.items.length, 1); assert.equal(events.length, 0);
    picker.selectedItems = picker.items; accept();
    assert.deepEqual(events, ['relative-numbers']);
    picker.value = 'e'; change();
    assert.equal(picker.items.length, 1);
    picker.selectedItems = [picker.items.find(item => item.label === 'e')]; accept();
    assert.deepEqual(events, ['relative-numbers', 'explorer']);
    picker.value = ''; change(); picker.selectedItems = [picker.items.find(item => item.prefix === ':')]; accept();
    assert.deepEqual(shown, [':']);
  } finally { win.happyDOM.abort(); }
});

test('bundle transform preserves relative gutters without replacing go-to-line lifecycle', async () => {
  const { preserveRelativeGotoGutter } = await import('../../../../scripts/monaco_preserve_relative_gutter.mjs');
  const source = await readFile('../../static/vendor/monaco-editor-core/esm/vs/editor/contrib/quickAccess/browser/gotoLineQuickAccess.js', 'utf8');
  const transformed = preserveRelativeGotoGutter(source);
  const marker = '        // Adjust line number visibility as needed\n';
  const start = source.indexOf(marker), end = source.indexOf('        return disposables;', start);
  assert.equal(transformed, source.slice(0, start) + source.slice(end));
  assert.doesNotMatch(transformed, /updateOptions\(\{ lineNumbers:/);
  for (const preserved of ['picker.onDidAccept', 'picker.onDidChangeValue', 'this.gotoLocation', 'this.clearDecorations', 'return disposables;']) {
    assert.ok(transformed.includes(preserved), preserved);
  }
  assert.throws(() => preserveRelativeGotoGutter('changed upstream source'), /review before building/);
  assert.throws(() => preserveRelativeGotoGutter(source.replace("lineNumbers: 'on'", "lineNumbers: 'off'")), /refusing broad replacement/);
});

test('relative number preference uses common Monaco options including hidden gutters', async () => {
  const { buildMonacoOptionsFromPrefsState: options } = await load('monaco_editor/editor_monaco_options_utils.ts');
  assert.equal(options({ preferences: { editor: { relativeLineNumbers: true } } }, {}).lineNumbers, 'relative');
  assert.equal(options({ editor: { relativeLineNumbers: true, showLineNumbers: false } }, {}).lineNumbers, 'off');
  assert.equal(options({ editor: {} }, {}).lineNumbers, 'on');
});

test('diff gutter presentation uses absolute numbers without mutating relative preference or hidden gutters', async () => {
  const { withDiffLineNumbers } = await load('monaco_editor/editor_diff_line_numbers.ts');
  const { buildMonacoOptionsFromPrefsState: options } = await load('monaco_editor/editor_monaco_options_utils.ts');
  const preferences = { editor: { relativeLineNumbers: true } };
  const plain = options(preferences, {});
  assert.equal(withDiffLineNumbers(plain).lineNumbers, 'on');
  assert.equal(plain.lineNumbers, 'relative');
  assert.equal(preferences.editor.relativeLineNumbers, true);
  assert.equal(options(preferences, {}).lineNumbers, 'relative');
  assert.equal(withDiffLineNumbers({ lineNumbers: 'off' }).lineNumbers, 'off');
  const lifecycle = await readFile('monaco_editor/editor_editor_lifecycle.ts', 'utf8');
  const live = await readFile('monaco_editor/editor_socket_connection_runtime.ts', 'utf8');
  assert.match(lifecycle, /const options = withDiffLineNumbers\(deps\.buildMonacoOptionsFromPrefs/);
  assert.match(live, /diffEditor \? withDiffLineNumbers\(projectedOptions\) : projectedOptions/);
});

test('editor tab chords are physical-key and focus scoped; preference requests are serialized', async () => {
  const win = dom();
  try {
    const { installEditorKeyboardRuntime } = await load('monaco_editor/editor_keyboard_runtime.ts');
    let focused = true, focusCalls = 0, actions = 0;
    const updates = [], cycles = [];
    const editor = { focus() { focusCalls++; }, hasTextFocus: () => focused, addAction() { actions++; } };
    const runtime = installEditorKeyboardRuntime({ getEditor: () => editor, getPrefs: () => ({ editor: { relativeLineNumbers: false } }), updatePreference: async (...args) => updates.push(args) });
    runtime.bindEditor(); runtime.bindEditor(); assert.equal(actions, 1);
    window.addEventListener('code-te2:cycle-file-tab', event => cycles.push(event.detail));
    const key = (code, extras = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Comma' ? '<' : '>', ctrlKey: true, shiftKey: true, cancelable: true, ...extras }));
    key('Comma'); key('Period'); key('Period', { isComposing: true }); key('Comma', { repeat: true });
    focused = false; key('Comma'); assert.deepEqual(cycles, [-1, 1]);
    window.dispatchEvent(new CustomEvent('code-te2:palette-action', { detail: 'relative-numbers' }));
    window.dispatchEvent(new CustomEvent('code-te2:palette-action', { detail: 'relative-numbers' }));
    await Promise.resolve(); assert.deepEqual(updates, [['relativeLineNumbers', true]]);
    window.dispatchEvent(new Event('code-te2:focus-editor')); assert.equal(focusCalls, 1);
    window.dispatchEvent(new Event('pagehide')); focused = true; key('Comma'); assert.equal(cycles.length, 2);
  } finally { win.happyDOM.abort(); }
});

test('Explorer arrows/Space reuse clicks; search owns Ctrl+F and two-stage Escape', async () => {
  const win = dom();
  try {
    const { installExplorerKeyboard } = await load('src/explorer/tree/keyboard.ts');
    document.body.innerHTML = '<div id="drawer"><input class="fe-tree-search-input"><ul id="tree"><li class="fe-tree-node" data-kind="dir" data-rel="." data-open="true"><span class="fe-tree-text">root</span><ul><li class="fe-tree-node" data-kind="dir" data-rel="dir" data-open="false"><span class="fe-tree-text">dir</span></li><li class="fe-tree-node" data-kind="file" data-rel="file"><span class="fe-tree-text">file</span></li></ul></li></ul></div>';
    const drawer = document.getElementById('drawer'), tree = document.getElementById('tree');
    const rows = [...tree.querySelectorAll('.fe-tree-text')];
    for (const row of rows) { row.getClientRects = () => [{}]; row.scrollIntoView = () => {}; }
    let search = false, opened = 0, editorFocused = 0;
    const clicked = [];
    tree.addEventListener('click', event => clicked.push(event.target.textContent));
    window.addEventListener('code-te2:focus-editor', () => editorFocused++);
    const dispose = installExplorerKeyboard(tree, drawer, {
      openExplorer() { opened++; }, openSearch() { search = true; drawer.querySelector('input').focus(); }, closeSearch() { search = false; }, isSearchVisible: () => search,
    });
    const key = (key, extras = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extras }));
    window.dispatchEvent(new CustomEvent('code-te2:palette-action', { detail: 'explorer' }));
    assert.equal(opened, 1); assert.equal(document.activeElement, rows[0]);
    key('ArrowDown'); assert.equal(document.activeElement, rows[1]);
    key(' '); key('ArrowRight'); assert.deepEqual(clicked, ['dir', 'dir']);
    key('ArrowDown'); key('Enter'); assert.equal(clicked.at(-1), 'file');
    key('f', { ctrlKey: true }); assert.equal(search, true); assert.equal(document.activeElement.tagName, 'INPUT');
    key('Tab'); assert.equal(document.activeElement, rows[0]);
    key('Escape'); assert.equal(search, false); assert.equal(editorFocused, 0);
    key('Escape'); assert.equal(editorFocused, 1);
    key('Tab', { shiftKey: true }); assert.equal(document.activeElement.tagName, 'INPUT');
    dispose();
  } finally { win.happyDOM.abort(); }
});
