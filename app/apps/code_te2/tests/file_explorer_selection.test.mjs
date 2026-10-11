import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { Window } from 'happy-dom';
import { selectPaths } from '../../../static/js/file_explorer_selection.mjs';
import { createListingFilter } from '../../../static/js/file_explorer_filter.mjs';
import { createItemContextMenu } from '../../../static/js/te_file_explorer_context.mjs';
import { build, transform } from '../../file_explorer/node_modules/esbuild/lib/main.js';

const root = path.resolve(import.meta.dirname, '../../../..');
const source = await readFile(path.join(root, 'app/apps/file_explorer/src/main.ts'), 'utf8');
const viewportSource = await readFile(path.join(root, 'app/apps/file_explorer/src/viewport.ts'), 'utf8');
const compiled = await build({ entryPoints: [path.join(root, 'app/apps/file_explorer/src/viewport.ts')], bundle: true, write: false, format: 'esm' });
const { createViewport } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);

function fixture() {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = '<main><input data-role="name-filter"><div data-role="name-filter-error"></div><div id="list"></div><div id="grid"></div><button id="clear"></button><span id="count"></span></main>';
  const container = document.querySelector('main');
  const entries = ['a.py', 'b.mjs', 'c.rs', 'd.md'].map(name => ({ name, path: '/' + name, type: 'file' }));
  const state = { entries, selectedPaths: new Set(), sortBy: 'name', sortAsc: true, currentPath: '/', view: 'list' };
  const ui = { listContainer: document.querySelector('#list'), gridContainer: document.querySelector('#grid'), clearSelection: document.querySelector('#clear'), selectionCount: document.querySelector('#count') };
  const opens = [];
  const directories = [], deletes = [];
  const icons = [];
  const context = { document, container, state, ui, selectPaths, console,
    filterInput: document.querySelector('[data-role="name-filter"]'),
    filterError: document.querySelector('[data-role="name-filter-error"]'),
    createListingFilter: callback => createListingFilter(callback, class {}),
    contextMenuReady: Promise.resolve({ close() {}, bind() {} }),
    updateActionButtons() {}, closeAllMenus() {}, isEditableFile: () => true, isArchive: () => false,
    modeToString: () => '', formatOwnership: () => '', formatSize: () => '', formatDate: () => '',
    renderIcon: (element, icon) => { element.dataset.icon = icon.codicon; },
    getIcon: async name => { icons.push(name); return { codicon: 'file-code' }; },
    openSelected: () => opens.push(state.selected?.path), loadDirectory: value => directories.push(value), followSymlink: () => {},
    parentPath: value => value.slice(0, value.lastIndexOf('/')) || '/',
    deleteSelected: () => deletes.push([...state.selectedPaths]),
  };
  // Controllers use the browser realm for target guards; install it while
  // synchronous DOM events execute in each fixture.
  globalThis.Element = window.Element;
  globalThis.HTMLElement = window.HTMLElement;
  const methods = createViewport(context);
  methods.renderEntries();
  const click = (node, options = {}, type = 'click') => node.dispatchEvent(new window.MouseEvent(type, { bubbles: true, ...options }));
  return { window, state, ui, methods, opens, icons, click, directories, deletes };
}

test('Backspace goes to parent; Delete uses selection; typing focuses regex without stealing Space', () => {
  const f = fixture();
  f.state.currentPath = '/project/subdir';
  const row = f.ui.listContainer.children[0];
  const key = value => row.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  key('Backspace');
  assert.deepEqual(f.directories, ['/project']);
  key('Delete');
  assert.deepEqual(f.deletes, [['/a.py']]);
  f.methods.selectAllItems(true);
  key('Delete');
  assert.equal(f.deletes[1].length, 4);
  key(' ');
  const input = f.window.document.querySelector('[data-role="name-filter"]');
  assert.equal(input.value, '');
  key('p');
  assert.equal(f.window.document.activeElement, input);
  assert.equal(input.value, 'p');
  f.methods.cancelFilter();
});

for (const view of ['listContainer', 'gridContainer']) test(`${view}: keyboard focus, selection and opening stay separate`, () => {
  const f = fixture();
  const rows = [...f.ui[view].children];
  for (const row of rows) row.scrollIntoView = () => {};
  const key = (node, value) => {
    const event = new f.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  };
  rows[0].focus();
  key(rows[0], 'ArrowDown');
  assert.equal(f.window.document.activeElement, rows[1]);
  assert.equal(f.state.selectedPaths.size, 0);
  key(rows[1], ' ');
  assert.deepEqual([...f.state.selectedPaths], ['/b.mjs']);
  key(rows[1], 'End');
  assert.equal(f.window.document.activeElement, rows[3]);
  key(rows[3], 'Enter');
  assert.deepEqual(f.opens, ['/d.md']);
  f.methods.renderEntries();
  assert.equal(f.window.document.activeElement.dataset.path, '/d.md');
});

for (const view of ['listContainer', 'gridContainer']) {
  test(`${view}: icon toggles, body selects, mirrored state survives rerender`, () => {
    const f = fixture();
    const rows = () => [...f.ui[view].children];
    f.click(rows()[0].querySelector('button'));
    f.click(rows()[1].querySelector('button'));
    assert.deepEqual([...f.state.selectedPaths], ['/a.py', '/b.mjs']);
    assert.equal(f.state.selected, null);
    assert.equal(f.ui.clearSelection.hidden, false);
    assert.equal(f.ui.listContainer.querySelectorAll('.selected').length, 2);
    assert.equal(f.ui.gridContainer.querySelectorAll('.selected').length, 2);
    f.methods.renderEntries();
    assert.equal(rows()[0].querySelector('button').getAttribute('aria-pressed'), 'true');
    f.click(rows()[0].querySelector('button'), {}, 'dblclick');
    assert.equal(f.opens.length, 0);
    f.click(rows()[2].querySelector('.fx-name-group, .fx-name-tile'));
    assert.deepEqual([...f.state.selectedPaths], ['/c.rs']);
    assert.equal(f.state.selected.path, '/c.rs');
    f.click(rows()[2], {}, 'dblclick');
    assert.deepEqual(f.opens, ['/c.rs']);
    f.methods.clearSelection();
    assert.equal(f.state.selected, null);
    assert.equal(f.ui.clearSelection.hidden, true);
  });
  test(`${view}: anchored ranges, additive ranges and modifier opening guard`, () => {
    const f = fixture();
    const rows = [...f.ui[view].children];
    f.click(rows[0]);
    f.click(rows[2], { shiftKey: true });
    assert.deepEqual([...f.state.selectedPaths], ['/a.py', '/b.mjs', '/c.rs']);
    f.click(rows[1], { ctrlKey: true });
    assert.deepEqual([...f.state.selectedPaths], ['/a.py', '/c.rs']);
    f.click(rows[3], { metaKey: true, shiftKey: true });
    assert.equal(f.state.selectedPaths.size, 4);
    f.click(rows[3], { shiftKey: true }, 'dblclick');
    assert.equal(f.opens.length, 0);
    f.methods.selectAllItems(true);
    assert.equal(f.state.selectedPaths.size, 4);
  });
}

test('range uses displayed order and absent anchors become single selections', () => {
  assert.deepEqual([...selectPaths(new Set(), ['c','b','a'], 'c', 'a', { shift: true }).selected], ['c','b','a']);
  assert.deepEqual([...selectPaths(new Set(['old']), ['a','b'], 'missing', 'b', { shift: true }).selected], ['b']);
});

test('context on a selected item preserves batch, unrelated item replaces it', async () => {
  const f = fixture();
  const start = source.indexOf('select: (entry, nodes) => {') + 'select: (entry, nodes) => {'.length;
  const end = source.indexOf('\n    } }));', start);
  const compiled = (await transform('(entry, nodes) => {' + source.slice(start, end) + '}', { loader: 'ts' })).code;
  const select = vm.runInNewContext(compiled, {
    state: f.state, closeAllMenus() {}, selectEntry: f.methods.selectEntry,
  });
  f.click(f.ui.listContainer.children[0].querySelector('button'));
  f.click(f.ui.listContainer.children[1].querySelector('button'));
  select(f.state.entries[0], {});
  assert.equal(f.state.selectedPaths.size, 2);
  select(f.state.entries[2], {});
  assert.deepEqual([...f.state.selectedPaths], ['/c.rs']);
});

test('file selection checkboxes are removed without removing settings checkboxes', async () => {
  const template = await readFile(path.join(root, 'app/apps/file_explorer/template.html'), 'utf8');
  assert.ok(!template.includes('fx-checkbox'));
  assert.ok(!source.includes('fx-checkbox'));
  assert.match(template, /data-action="clear-selection" hidden/);
  assert.ok(template.includes('type="checkbox" data-role="perm-owner-read"'));
  assert.match(viewportSource, /getIcon\(entry.name\)/);
});

test('Escape clears selection but leaves inputs and dialogs to their owners', async () => {
  const f = fixture();
  const start = source.indexOf('  const keydown =');
  const end = source.indexOf('\n  listenerCleanup.push(() => document.removeEventListener', start);
  const noop = () => {};
  const compiled = (await transform(source.slice(start, end), { loader: 'ts' })).code;
  vm.runInNewContext(compiled, { document: f.window.document, ui: f.ui, appLive: true, Element: f.window.Element,
    bookmarks: { editOpen: () => false, formOpen: () => false },
    usage: { isOpen: () => false, close() {} },
    menuGroups: [], clearSelection: f.methods.clearSelection, closeAllMenus: noop,
    closePropertiesModal: noop, closeEditBookmarksModal: noop, closeBookmarkFormModal: noop });
  f.methods.selectAllItems(true);
  const input = f.window.document.createElement('input');
  f.window.document.body.appendChild(input);
  input.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.state.selectedPaths.size, 4);
  f.ui.propertiesModal = { dataset: { open: 'true' } };
  f.window.document.body.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.state.selectedPaths.size, 4);
  f.ui.propertiesModal.dataset.open = 'false';
  f.window.document.body.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.state.selectedPaths.size, 0);
});

test('context menu targets body, not the selection icon', () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = '<main><div class="fx-menu-group" data-menu="file"><button data-command="file:copy">Copy</button></div><div id="item"><button data-role="selection-icon">icon</button><span>body</span></div></main>';
  const previous = { document: globalThis.document, window: globalThis.window, Element: globalThis.Element, Node: globalThis.Node };
  globalThis.document = document; globalThis.window = window; globalThis.Element = window.Element; globalThis.Node = window.Node;
  try {
    const selected = [];
    const menu = createItemContextMenu({ container: document.querySelector('main'), select: entry => selected.push(entry.path), dispatch() {} });
    const item = document.querySelector('#item');
    menu.bind(item, { path: '/file' }, {});
    item.querySelector('button').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
    assert.equal(selected.length, 0);
    item.querySelector('span').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
    assert.deepEqual(selected, ['/file']);
    assert.ok(document.querySelector('.fx-context-menu'));
    menu.close();
  } finally { Object.assign(globalThis, previous); window.happyDOM.abort(); }
});

test('context arrows navigate and Escape restores item focus without reaching page handlers', () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = '<main><div data-menu-panel="file"><button data-command="file:copy">Copy</button><button data-command="file:open">Open</button></div><div id="item" tabindex="0">file</div></main>';
  const previous = { document: globalThis.document, window: globalThis.window, Element: globalThis.Element, Node: globalThis.Node };
  globalThis.document = document; globalThis.window = window; globalThis.Element = window.Element; globalThis.Node = window.Node;
  try {
    const menu = createItemContextMenu({ container: document.querySelector('main'), select() {}, dispatch() {} });
    const item = document.querySelector('#item');
    menu.bind(item, { path: '/file' }, {});
    item.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
    const buttons = [...document.querySelectorAll('.fx-context-menu button')];
    buttons.forEach(button => { button.scrollIntoView = () => {}; });
    buttons[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    assert.equal(document.activeElement, buttons[1]);
    let escaped = false;
    document.addEventListener('keydown', () => { escaped = true; });
    buttons[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(escaped, false);
    assert.equal(document.querySelector('.fx-context-menu'), null);
    assert.equal(document.activeElement, item);
    menu.close();
  } finally { Object.assign(globalThis, previous); window.happyDOM.abort(); }
});
